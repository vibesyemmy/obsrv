import { app, nativeImage } from 'electron'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { TargetSource } from '../main/targetSource'
import { maxCssViewport, screenShape } from '../shared/calibration'
import { boxDownsample, rgbaToBgra, type RGBAImage } from '../shared/downsample'
import { findProfile } from '../shared/presets'
import type { LoadError } from '../shared/types'
import { ArgError, parseArgs, type AuditCommand, type DiffCommand, type RenderSpec, type SnapCommand } from './args'
import { auditFindings } from './audit'
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
  /** Everything warned to stderr during this render, for the machine output. */
  warnings: string[]
}

interface RenderOptions {
  fullPage: boolean
  waitMs: number
  timeoutMs: number
  /** False only for the diff reference: dense raster, desktop semantics. */
  mobileEmulation?: boolean
}

/**
 * Watches a source for load failures. Boxed rather than a `let`: TS's flow
 * analysis cannot see the listener assignment, and would narrow a plain
 * local back to null. Renderer crashes surface here too (TargetSource
 * reports render-process-gone through the same load-error channel).
 */
function watchFailures(target: TargetSource): { failed: () => Error | null; loadError: () => LoadError | null } {
  const failure: { error: LoadError | null } = { error: null }
  target.on('load-error', e => {
    failure.error ??= e
  })
  return {
    failed: () =>
      failure.error
        ? new Error(`render failed: ${failure.error.description} (code ${failure.error.code}) — ${failure.error.url}`)
        : null,
    loadError: () => failure.error,
  }
}

/**
 * Loads the page within the budget, then sits out `--wait`. `load()` resolves
 * on did-finish-load but a dead server can sit in connect limbo far longer
 * than the render budget, so the load is raced; the wait is polled, not a
 * single sleep, because a renderer crash mid-wait must fail now, not after
 * the wait plus a doomed capture.
 */
async function loadWithin(
  target: TargetSource,
  url: string,
  options: { waitMs: number; timeoutMs: number },
  watch: ReturnType<typeof watchFailures>,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`load did not finish within ${options.timeoutMs} ms: ${url}`)), options.timeoutMs)
  })
  try {
    await Promise.race([target.load(url), timeout])
  } finally {
    clearTimeout(timer)
  }
  const error = watch.loadError()
  if (error) throw new Error(`load failed: ${error.description} (code ${error.code}) — ${error.url}`)
  if (options.waitMs > 0) {
    const until = Date.now() + options.waitMs
    while (Date.now() < until) {
      const err = watch.failed()
      if (err) throw err
      await sleep(Math.min(50, until - Date.now()))
    }
  }
}

async function render(url: string, spec: RenderSpec, options: RenderOptions): Promise<RenderResult> {
  const target = new TargetSource(30, { mobileEmulation: options.mobileEmulation ?? true })
  try {
    const watch = watchFailures(target)
    const failed = watch.failed
    const warnings: string[] = []
    const warn = (message: string): void => {
      warnings.push(message)
      human(message)
    }
    // `mobile` is the preset's, not the density's: a phone preset gets the
    // mobile UA and viewport semantics the app gives it, a Retina laptop does
    // not. (Dropped by mistake at 0.18.1, when the fourth argument arrived.)
    const applied = target.setViewport(spec.cssWidth, spec.cssHeight, spec.deviceScaleFactor, spec.mobile)
    await loadWithin(target, url, options, watch)

    let cssHeight = applied.height
    if (options.fullPage) {
      // Layout is final at did-finish-load (+ --wait for late movers), so the
      // page height needs no pixels: resize *before* the one and only capture
      // rather than capturing, growing, and paying for a second full raster —
      // at 1366×4096 the software rasteriser is slow enough that capturing
      // twice was observed to blow the render budget on a loaded machine.
      const scrollHeight = Math.ceil(
        (await target.webContents.executeJavaScript(
          'Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)',
        )) as number,
      )
      if (scrollHeight > cssHeight) {
        const limit = maxCssViewport(spec.deviceScaleFactor)
        const wanted = Math.min(scrollHeight, limit)
        if (scrollHeight > limit) {
          warn(
            `warning: full page is ${scrollHeight} CSS px tall; clamped to ${wanted} ` +
              `(device pixels are capped at 4096 per axis)`,
          )
        }
        target.setViewport(applied.width, wanted, spec.deviceScaleFactor, spec.mobile)
        cssHeight = wanted
      }
    }

    const frame = await captureQuiescent(target, { timeoutMs: options.timeoutMs, onWarn: warn, failure: failed })
    return { frame, cssWidth: applied.width, cssHeight, warnings }
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
    // The shape is named for the reader, never left to be inferred from the
    // digits: under `--matrix` one run prints several lines, and a single
    // `--orientation landscape` flips a landscape-natural preset into a
    // portrait screen, so the lines legitimately disagree with each other.
    //
    // Human output only. The JSON already carries `cssWidth`/`cssHeight`, from
    // which any consumer derives the shape exactly, and that object is a
    // published contract — adding a field to it is a breaking change for
    // everything parsing it, for something nothing has to parse.
    const shape = screenShape(r.cssWidth, r.cssHeight)
    human(
      `snap ${cmd.url} → ${out} (${r.frame.width}×${r.frame.height} device px, ` +
        `${r.cssWidth}×${r.cssHeight} CSS ${shape}, preset ${spec.presetId}, profile ${profile.id})`,
    )
    results.push({
      out,
      preset: spec.presetId,
      cssWidth: r.cssWidth,
      cssHeight: r.cssHeight,
      deviceScaleFactor: spec.deviceScaleFactor,
      profile: profile.id,
      // False means a best-effort capture of a page that never went
      // paint-quiet (animation); machine consumers can gate on it.
      settled: r.frame.settled,
      warnings: r.warnings,
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

  // Both captures must have gone quiet for the comparison to mean anything:
  // an animated page yields two different frames, and every band delta is then
  // frame-to-frame noise. The renders already know; diff used to discard it.
  const settled = t.frame.settled && r.frame.settled
  const warnings = [
    ...t.warnings.map(w => `target: ${w}`),
    ...r.warnings.map(w => `reference: ${w}`),
  ]
  const metrics = diffMetrics(target, reference, referenceDeviceRows, settled)

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
    `diff ${cmd.url} @ ${cmd.spec.presetId} ` +
      `(${cmd.spec.cssWidth}×${cmd.spec.cssHeight} CSS ${screenShape(cmd.spec.cssWidth, cmd.spec.cssHeight)}, ` +
      `profile ${profile.id}): ` +
      `ink ${pct(metrics.inkCoverage.target)} vs ${pct(metrics.inkCoverage.reference)} reference, ` +
      `rows ${metrics.rows.target}/${metrics.rows.reference} (ratio ${metrics.rows.ratio?.toFixed(2) ?? 'n/a'}), ` +
      `${metrics.findings.length} finding(s)${settled ? '' : ' — UNSETTLED, deltas are not rendering evidence'}`,
  )
  // Findings are informational — CI thresholds are the caller's job.
  await machine({
    url: cmd.url,
    preset: cmd.spec.presetId,
    profile: profile.id,
    ...(files ? { files } : {}),
    ...metrics,
    warnings,
  })
}

/**
 * The physical-units audit: every tap target and text element the page lays
 * out, measured in millimetres on the chosen screen. Layout only — no pixels
 * are captured — so a single load and the page's own answer are all it takes.
 * Rects are page coordinates, so the whole page is covered from one viewport.
 */
async function runAudit(cmd: AuditCommand): Promise<void> {
  const target = new TargetSource(30, { mobileEmulation: true })
  try {
    const watch = watchFailures(target)
    const applied = target.setViewport(cmd.spec.cssWidth, cmd.spec.cssHeight, cmd.spec.deviceScaleFactor, cmd.spec.mobile)
    await loadWithin(target, cmd.url, cmd, watch)
    const report = await target.auditPage()
    if (!report) {
      const err = watch.failed()
      if (err) throw err
      throw new Error('the page did not answer the audit (it may have navigated away, or thrown while being measured)')
    }
    const result = auditFindings(
      report,
      {
        cssWidth: applied.width,
        cssHeight: applied.height,
        deviceScaleFactor: cmd.spec.deviceScaleFactor,
        diagonalInches: cmd.spec.diagonalInches,
      },
      { tapMm: cmd.tapMm, textMm: cmd.textMm },
    )
    for (const w of result.warnings) human(`warning: ${w}`)
    const t = result.summary.targets
    const x = result.summary.text
    human(
      `audit ${cmd.url} @ ${cmd.spec.presetId} ` +
        `(${applied.width}×${applied.height} CSS ${screenShape(applied.width, applied.height)}` +
        `${result.ppi !== null ? `, ${result.ppi} ppi` : ''}): ` +
        `${t.count} targets${t.under !== null ? ` (${t.under} under ${cmd.tapMm} mm)` : ''}, ` +
        `${x.count} text elements${x.under !== null ? ` (${x.under} under ${cmd.textMm} mm)` : ''}, ` +
        `${result.findings.length} finding(s) listed`,
    )
    // Findings are informational — CI thresholds are the caller's job.
    await machine({
      url: cmd.url,
      preset: cmd.spec.presetId,
      cssWidth: applied.width,
      cssHeight: applied.height,
      deviceScaleFactor: cmd.spec.deviceScaleFactor,
      pageHeight: report.pageHeight,
      ...result,
    })
  } finally {
    target.destroy()
  }
}

// --- boot --------------------------------------------------------------------

// A throwaway user-data dir: the CLI must never share (or pollute) the GUI
// app's profile, and parallel CLI runs must not fight over one. bin/obsrv.js
// creates and *deletes* it (OBSRV_CLI_USER_DATA): Chromium flushes profile
// files after the last main-process JS runs, so only a parent that outlives
// Chromium can remove it reliably. The in-process cleanups below remain as
// best effort for direct `electron out/main/cli.js` invocations.
const userData = process.env.OBSRV_CLI_USER_DATA ?? mkdtempSync(join(tmpdir(), 'obsrv-cli-'))
app.setPath('userData', userData)
const cleanupUserData = (): void => {
  try {
    rmSync(userData, { recursive: true, force: true })
  } catch {
    // Best-effort cleanup of a tmp dir.
  }
}
// Twice on purpose: once before `app.exit` (below), and once on 'quit' —
// the last JS to run — because Chromium flushes profile files (Session
// Storage, Local State) during shutdown and was observed to recreate the
// dir after a single pre-exit removal.
app.on('quit', cleanupUserData)

// The offscreen windows come and go (dsf changes recreate them); the CLI owns
// its exit explicitly, so "all windows closed" must never quit underneath it.
app.on('window-all-closed', () => {})

// bin/obsrv.js forwards SIGINT/SIGTERM here; exit promptly and leak-free.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    cleanupUserData()
    app.exit(1)
  })
}

void app.whenReady().then(async () => {
  app.dock?.hide()
  let code = 0
  try {
    const cmd = parseArgs(cliArgv())
    if (cmd.command === 'help') {
      await new Promise<void>(done => process.stdout.write(`${cmd.text}\n`, () => done()))
    } else if (cmd.command === 'snap') {
      await runSnap(cmd)
    } else if (cmd.command === 'audit') {
      await runAudit(cmd)
    } else {
      await runDiff(cmd)
    }
  } catch (e) {
    code = e instanceof ArgError ? 2 : 1
    human(`obsrv: ${e instanceof Error ? e.message : String(e)}`)
  }
  cleanupUserData()
  app.exit(code)
})
