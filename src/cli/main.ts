import { app, nativeImage } from 'electron'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { TargetSource } from '../main/targetSource'
import { maxCssViewport } from '../shared/calibration'
import { boxDownsample, rgbaToBgra, type RGBAImage } from '../shared/downsample'
import { findProfile } from '../shared/presets'
import type { LoadError } from '../shared/types'
import { ArgError, parseArgs, type DiffCommand, type RenderSpec, type SnapCommand } from './args'
import { bgraToRgba, captureQuiescent, type CapturedFrame } from './capture'
import { diffMetrics, inkRows } from './metrics'
import { applyPanelProfile } from './panel'

/**
 * Headless CLI entry (`bin/obsrv.js` spawns `electron out/main/cli.js -- …`).
 * Silent by design: no windows ever show, the macOS dock icon is hidden, all
 * human output goes to stderr and the only thing on stdout is machine JSON.
 * Exit codes: 0 success, 1 render/runtime failure, 2 usage error.
 */

/** The CLI's argv: everything after the `--` separator Chromium also honours. */
function cliArgv(): string[] {
  const sep = process.argv.indexOf('--')
  return sep >= 0 ? process.argv.slice(sep + 1) : process.argv.slice(2)
}

const human = (message: string): void => {
  process.stderr.write(`${message}\n`)
}

/** stdout is machine-only; await the flush so `app.exit` cannot truncate it. */
const machine = (json: unknown): Promise<void> =>
  new Promise(done => {
    process.stdout.write(`${JSON.stringify(json, null, 2)}\n`, () => done())
  })

const sleep = (ms: number): Promise<void> => new Promise(done => setTimeout(done, ms))

function encodePng(img: RGBAImage): Buffer {
  // Chromium's bitmap layout (BGRA on this stack — verified against a solid
  // red fixture decoded by an independent PNG reader in tests/e2e/cli.spec.ts)
  // is what createFromBitmap expects; alpha is opaque so premultiply is moot.
  const bgra = rgbaToBgra(img)
  const image = nativeImage.createFromBitmap(Buffer.from(bgra.buffer, bgra.byteOffset, bgra.byteLength), {
    width: img.width,
    height: img.height,
  })
  return image.toPNG()
}

interface RenderResult {
  frame: CapturedFrame
  /** Applied CSS viewport (after clamping / full-page growth). */
  cssWidth: number
  cssHeight: number
}

interface RenderOptions {
  fullPage: boolean
  waitMs: number
  timeoutMs: number
  /** False only for the diff reference: dense raster, desktop semantics. */
  mobileEmulation?: boolean
}

async function render(url: string, spec: RenderSpec, options: RenderOptions): Promise<RenderResult> {
  const target = new TargetSource(30, { mobileEmulation: options.mobileEmulation ?? true })
  try {
    // Boxed rather than a `let`: TS's flow analysis cannot see the listener
    // assignment, and would narrow a plain local back to null.
    const failure: { error: LoadError | null } = { error: null }
    target.on('load-error', e => {
      failure.error ??= e
    })
    const applied = target.setViewport(spec.cssWidth, spec.cssHeight, spec.deviceScaleFactor)

    // `load()` resolves on did-finish-load but a dead server can sit in
    // connect limbo far longer than the render budget; race it.
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`load did not finish within ${options.timeoutMs} ms: ${url}`)), options.timeoutMs)
    })
    try {
      await Promise.race([target.load(url), timeout])
    } finally {
      clearTimeout(timer)
    }
    if (failure.error) {
      throw new Error(`load failed: ${failure.error.description} (code ${failure.error.code}) — ${failure.error.url}`)
    }
    if (options.waitMs > 0) await sleep(options.waitMs)

    let frame = await captureQuiescent(target, { timeoutMs: options.timeoutMs, onWarn: human })
    let cssHeight = applied.height

    if (options.fullPage) {
      const scrollHeight = Math.ceil(
        (await target.webContents.executeJavaScript(
          'Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)',
        )) as number,
      )
      if (scrollHeight > cssHeight) {
        const limit = maxCssViewport(spec.deviceScaleFactor)
        const wanted = Math.min(scrollHeight, limit)
        if (scrollHeight > limit) {
          human(
            `warning: full page is ${scrollHeight} CSS px tall; clamped to ${wanted} ` +
              `(device pixels are capped at 4096 per axis)`,
          )
        }
        target.setViewport(applied.width, wanted, spec.deviceScaleFactor)
        frame = await captureQuiescent(target, { timeoutMs: options.timeoutMs, onWarn: human })
        cssHeight = wanted
      }
    }

    return { frame, cssWidth: applied.width, cssHeight }
  } finally {
    target.destroy()
  }
}

function snapOutputPath(cmd: SnapCommand, spec: RenderSpec): string {
  if (!cmd.matrix) return resolve(cmd.out)
  if (cmd.out.includes('{preset}')) return resolve(cmd.out.replaceAll('{preset}', spec.presetId))
  return resolve(cmd.out, `obsrv-${spec.presetId}.png`)
}

async function runSnap(cmd: SnapCommand): Promise<void> {
  const profile = findProfile(cmd.profileId)
  const results: object[] = []
  for (const spec of cmd.specs) {
    const out = snapOutputPath(cmd, spec)
    const r = await render(cmd.url, spec, cmd)
    const img = applyPanelProfile(bgraToRgba(r.frame.bgra, r.frame.width, r.frame.height), profile)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, encodePng(img))
    human(
      `snap ${cmd.url} → ${out} (${r.frame.width}×${r.frame.height} device px, ` +
        `preset ${spec.presetId}, profile ${profile.id})`,
    )
    results.push({
      out,
      preset: spec.presetId,
      cssWidth: r.cssWidth,
      cssHeight: r.cssHeight,
      deviceScaleFactor: spec.deviceScaleFactor,
      profile: profile.id,
    })
  }
  await machine(cmd.matrix ? results : results[0])
}

async function runDiff(cmd: DiffCommand): Promise<void> {
  const profile = findProfile(cmd.profileId)

  // The target: the preset as configured, panel profile applied — the point
  // of the comparison is "this screen" vs "the screen you develop on".
  const t = await render(cmd.url, cmd.spec, { fullPage: false, waitMs: cmd.waitMs, timeoutMs: cmd.timeoutMs })
  const target = applyPanelProfile(bgraToRgba(t.frame.bgra, t.frame.width, t.frame.height), profile)

  // The reference: the same CSS viewport at dsf 2 (what a HiDPI dev sees) —
  // desktop UA and viewport semantics, only the raster density differs — then
  // box-downsampled onto the target's 1x grid. No panel profile.
  const refSpec: RenderSpec = { ...cmd.spec, deviceScaleFactor: 2 }
  const r = await render(cmd.url, refSpec, {
    fullPage: false,
    waitMs: cmd.waitMs,
    timeoutMs: cmd.timeoutMs,
    mobileEmulation: false,
  })
  const referenceFull = bgraToRgba(r.frame.bgra, r.frame.width, r.frame.height)
  const referenceDeviceRows = inkRows(referenceFull)
  const reference = boxDownsample(referenceFull, 2)

  const metrics = diffMetrics(target, reference, referenceDeviceRows)

  let files: { target: string; reference: string } | undefined
  if (cmd.outDir) {
    const dir = resolve(cmd.outDir)
    mkdirSync(dir, { recursive: true })
    files = { target: join(dir, 'target.png'), reference: join(dir, 'reference.png') }
    writeFileSync(files.target, encodePng(target))
    writeFileSync(files.reference, encodePng(reference))
  }

  const pct = (v: number): string => `${(v * 100).toFixed(2)}%`
  human(
    `diff ${cmd.url} @ ${cmd.spec.presetId} (profile ${profile.id}): ` +
      `ink ${pct(metrics.inkCoverage.target)} vs ${pct(metrics.inkCoverage.reference)} reference, ` +
      `rows ${metrics.rows.target}/${metrics.rows.reference} (ratio ${metrics.rows.ratio?.toFixed(2) ?? 'n/a'}), ` +
      `${metrics.findings.length} finding(s)`,
  )
  // Findings are informational — CI thresholds are the caller's job.
  await machine({
    url: cmd.url,
    preset: cmd.spec.presetId,
    profile: profile.id,
    ...(files ? { files } : {}),
    ...metrics,
  })
}

// --- boot --------------------------------------------------------------------

// A throwaway user-data dir: the CLI must never share (or pollute) the GUI
// app's profile, and parallel CLI runs must not fight over one.
const userData = mkdtempSync(join(tmpdir(), 'obsrv-cli-'))
app.setPath('userData', userData)
process.on('exit', () => {
  try {
    rmSync(userData, { recursive: true, force: true })
  } catch {
    // Best-effort cleanup of a tmp dir.
  }
})

// The offscreen windows come and go (dsf changes recreate them); the CLI owns
// its exit explicitly, so "all windows closed" must never quit underneath it.
app.on('window-all-closed', () => {})

void app.whenReady().then(async () => {
  app.dock?.hide()
  let code = 0
  try {
    const cmd = parseArgs(cliArgv())
    if (cmd.command === 'help') {
      await new Promise<void>(done => process.stdout.write(`${cmd.text}\n`, () => done()))
    } else if (cmd.command === 'snap') {
      await runSnap(cmd)
    } else {
      await runDiff(cmd)
    }
  } catch (e) {
    code = e instanceof ArgError ? 2 : 1
    human(`obsrv: ${e instanceof Error ? e.message : String(e)}`)
  }
  app.exit(code)
})
