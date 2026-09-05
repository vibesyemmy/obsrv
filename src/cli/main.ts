import { app, nativeImage } from 'electron'
import { findThrottle } from '../shared/throttle'
import { formatTextScale } from '../shared/textScale'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { TargetSource } from '../main/targetSource'
import { maxCssViewport, screenShape } from '../shared/calibration'
import { boxDownsample, cropImage, rgbaToBgra, type RGBAImage } from '../shared/downsample'
import { DEFAULT_SETTINGS, SCREEN_PRESETS, findProfile } from '../shared/presets'
import { inspectReadout } from '../shared/inspectReadout'
import { profileToParams } from '../shared/panelSim'
import type { LoadError } from '../shared/types'
import type { AuditReport } from '../shared/audit'
import type { LintReport } from '../shared/lint'
import {
  ArgError,
  parseArgs,
  type AuditCommand,
  type DiffCommand,
  type InspectCommand,
  type LintCommand,
  type RenderSpec,
  type ReportCommand,
  type SnapCommand,
} from './args'
import { auditFindings } from './audit'
import { lintFindings, type LintGroup } from './lint'
import { bgraToRgba, captureQuiescent, type CapturedFrame, stitchBands, type CaptureBand, type UnsettledReason } from './capture'
import { diffMetrics, inkRows } from './metrics'
import { applyPanelProfile } from './panel'
import { reportHtml, type ReportImage, type ReportProblems, type ReportScreen } from './reportHtml'

/** The worst findings featured on the report's full-page overview, per source (audit, lint): pins + crops. */
const REPORT_CROP_LIMIT = 6
/** The overview is downsampled to about this device-pixel width to keep the file small. */
const REPORT_OVERVIEW_WIDTH = 800
/** Padding around a finding's rect in the crop, in device px. */
const REPORT_CROP_PAD = 16
/** The overview is also kept under this many device px tall; a long page becomes a map, the crops carry the detail. */
const REPORT_OVERVIEW_MAX_HEIGHT = 3200
/** A tiled full-page capture stops after this many bands; the report counts what lies past them. */
const MAX_TILE_BANDS = 8

/** One line under a lint group's crop: the rule, what the group shares, how many. */
function lintDetail(g: LintGroup): string {
  const f = g.exemplar
  const many = g.count > 1 ? ` · ×${g.count}` : ''
  // A switch, not an if-chain: two of the rules share one union member, and
  // only a switch on the discriminant narrows it away (as `groupKey` does).
  switch (f.rule) {
    case 'hairline':
      return `hairline ${f.kind} ${f.cssPx}px = ${f.devicePx} device px${many}`
    case 'thin-text':
      return `thin text ${f.fontWeight} at ${f.fontSizePx}px${many}`
    case 'contrast':
      return `contrast ${f.color} on ${f.background} ${f.asIs}:1${many}`
    case 'contrast-on-panel':
      return `on panel ${f.asIs}:1 → ${f.onPanel}:1${many}`
    case 'image-upscaled':
      return `upscaled ${f.factor}×${many}`
    case 'image-oversized':
      return `oversized ${f.factor}×${many}`
  }
}

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

/** The overview is a map, not evidence: JPEG at this quality is a fraction of the PNG. */
const REPORT_OVERVIEW_JPEG_QUALITY = 85

function encodeJpeg(img: RGBAImage, quality: number): Buffer {
  const bgra = rgbaToBgra(img)
  const image = nativeImage.createFromBitmap(Buffer.from(bgra.buffer, bgra.byteOffset, bgra.byteLength), { width: img.width, height: img.height })
  return image.toJPEG(quality)
}

interface RenderResult {
  frame: CapturedFrame
  /** Applied CSS viewport (after clamping / full-page growth). */
  cssWidth: number
  cssHeight: number
  /** Everything warned to stderr during this render, for the machine output. */
  warnings: string[]
  /** The audit walk, when asked for; null when the page did not answer. */
  auditReport?: AuditReport | null
  /** The lint walk, when asked for; null when the page did not answer. */
  lintReport?: LintReport | null
  /**
   * Time from the start of navigation to the page going paint-quiet, with
   * `--wait` taken back out; null when it never settled within the budget.
   * How the page *feels* on the screen, under `--throttle` or without.
   */
  settledMs: number | null
}

interface RenderOptions {
  fullPage: boolean
  /**
   * With `fullPage`: a page taller than the device-pixel cap is captured in
   * bands — the viewport held at the cap, the page scrolled a band at a time,
   * each band captured quiescent and stitched into one raster — instead of
   * being clamped. The report asks for this so its findings can be located
   * anywhere on the page; `snap --full-page` keeps its documented cap.
   */
  tiled?: boolean
  waitMs: number
  timeoutMs: number
  /** False only for the diff reference: dense raster, desktop semantics. */
  mobileEmulation?: boolean
  /** Also run the audit walk on the loaded page, so a report costs one load per screen. */
  audit?: boolean
  /** Also run the lint walk on the loaded page. */
  lint?: boolean
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
    // Before the load: `did-navigate` re-applies it, so the page lays out at
    // its scale from the first paint rather than reflowing after.
    target.setTextScale(spec.textScale)
    // Before the load, so the page fetches and runs under the conditions from
    // its first byte; a refusal is a warning, not a failure — the render is
    // still a render, and the JSON says the throttle was asked for.
    if (spec.throttle !== null) {
      const refused = await target.setThrottle(findThrottle(spec.throttle))
      if (refused) warn(`warning: ${refused}`)
    }
    const startedAt = Date.now()
    await loadWithin(target, url, options, watch)

    let cssHeight = applied.height
    let frame: CapturedFrame | null = null
    // Under a throttle the quiet moment is the measurement (`settledMs`), and
    // a page loading over 3G paints steadily too: no early exit there.
    const quiescent = (): Promise<CapturedFrame> =>
      captureQuiescent(target, { timeoutMs: options.timeoutMs, onWarn: warn, failure: failed, animationExit: spec.throttle === null })
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
      // The page measures itself in its own CSS px; under a text scale the
      // surface needs `textScale` times as many to hold it.
      const surfaceHeight = Math.ceil(scrollHeight * spec.textScale)
      if (surfaceHeight > cssHeight) {
        const limit = maxCssViewport(spec.deviceScaleFactor)
        if (surfaceHeight > limit && options.tiled) {
          // Taller than one surface: hold the viewport at the cap and capture
          // the page a band at a time, scrolling between captures. Each band
          // is its own quiescent capture, so an animating page pays its early
          // exit per band. A sticky header repeats at the top of every band —
          // which is what scrolling shows a person, too.
          target.setViewport(applied.width, limit, spec.deviceScaleFactor, spec.mobile)
          cssHeight = limit
          const bandPage = limit / spec.textScale
          const bandsWanted = Math.ceil(scrollHeight / bandPage)
          const bandCount = Math.min(bandsWanted, MAX_TILE_BANDS)
          const bands: CaptureBand[] = []
          let settled = true
          let unsettledReason: UnsettledReason | undefined
          for (let i = 0; i < bandCount; i++) {
            const wantY = Math.round(i * bandPage)
            const y = Math.round(
              (await target.webContents.executeJavaScript(
                `window.scrollTo({ top: ${wantY}, left: 0, behavior: 'instant' }); window.scrollY`,
              )) as number,
            )
            const f = await quiescent()
            if (!f.settled) {
              settled = false
              if (unsettledReason === undefined) unsettledReason = f.unsettledReason
            }
            bands.push({ y: Math.round(y * spec.textScale * spec.deviceScaleFactor), width: f.width, height: f.height, bgra: f.bgra })
            // The scroll clamped short of where the next band would start:
            // that was the bottom, and the band already covers it.
            if (y < wantY) break
          }
          const width = bands[0]!.width
          const height = Math.max(...bands.map(b => b.y + b.height))
          frame = { width, height, bgra: stitchBands(width, height, bands), settled, ...(unsettledReason !== undefined ? { unsettledReason } : {}) }
          if (bandsWanted > bandCount) {
            warn(
              `warning: full page is ${surfaceHeight} CSS px tall; captured the first ${bandCount} bands of ${limit} CSS px ` +
                `(${MAX_TILE_BANDS} at most) — what lies past them is not in the raster`,
            )
          } else {
            human(`full page is ${surfaceHeight} CSS px tall; captured in ${bands.length} band(s) of ${limit} CSS px`)
          }
        } else {
          const wanted = Math.min(surfaceHeight, limit)
          if (surfaceHeight > limit) {
            warn(
              `warning: full page is ${surfaceHeight} CSS px tall; clamped to ${wanted} ` +
                `(device pixels are capped at 4096 per axis)`,
            )
          }
          target.setViewport(applied.width, wanted, spec.deviceScaleFactor, spec.mobile)
          cssHeight = wanted
        }
      }
    }

    if (frame === null) frame = await quiescent()
    const settledMs = frame.settled ? Math.max(0, Date.now() - startedAt - options.waitMs) : null
    const auditReport = options.audit ? await target.auditPage() : undefined
    const lintReport = options.lint ? await target.lintPage(1 / (spec.deviceScaleFactor * spec.textScale)) : undefined
    return {
      frame,
      cssWidth: applied.width,
      cssHeight,
      warnings,
      settledMs,
      ...(auditReport !== undefined ? { auditReport } : {}),
      ...(lintReport !== undefined ? { lintReport } : {}),
    }
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
        `${r.cssWidth}×${r.cssHeight} CSS ${shape}, preset ${spec.presetId}, profile ${profile.id}` +
        `${spec.textScale !== 1 ? `, text ${formatTextScale(spec.textScale)}` : ''}` +
        `${spec.throttle !== null ? `, throttle ${spec.throttle}, ${r.settledMs === null ? 'not settled' : `settled in ${r.settledMs} ms`}` : ''})`,
    )
    results.push({
      out,
      preset: spec.presetId,
      cssWidth: r.cssWidth,
      cssHeight: r.cssHeight,
      deviceScaleFactor: spec.deviceScaleFactor,
      // Only when one was applied: at ×1 this object is the contract every
      // consumer already parses, and a run that asked for a scale is new code.
      ...(spec.textScale !== 1 ? { textScale: spec.textScale } : {}),
      // Same rule for the throttle, keyed on the flag rather than the value:
      // `--throttle none` is a baseline someone asked for by name.
      ...(spec.throttle !== null ? { throttle: spec.throttle, settledMs: r.settledMs } : {}),
      profile: profile.id,
      // False means a best-effort capture of a page that never went
      // paint-quiet (animation); machine consumers can gate on it, and the
      // reason says whether waiting longer could have helped.
      settled: r.frame.settled,
      ...(r.frame.settled ? {} : { unsettledReason: r.frame.unsettledReason }),
      warnings: r.warnings,
    })
  }
  await machine(cmd.matrix ? results : results[0])
}

async function runDiff(cmd: DiffCommand): Promise<void> {
  const profile = findProfile(cmd.profileId)

  // The target: the preset as configured, *without* the panel profile. The
  // comparison is about rasterisation — "this screen" vs "the screen you
  // develop on" — and a profile's brightness and black floor darken every
  // pixel past the ink threshold (white through budget-tn at the default
  // host lands at luminance 186, under INK_LUMINANCE's 200), which reported
  // 100% ink coverage and a "+90pp" band finding for every band. The
  // reference is unprofiled too, so like is compared with like.
  const t = await render(cmd.url, cmd.spec, { fullPage: false, waitMs: cmd.waitMs, timeoutMs: cmd.timeoutMs })
  const target = bgraToRgba(t.frame.bgra, t.frame.width, t.frame.height)

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
    ...(profile.id === 'reference'
      ? []
      : [`the panel profile (${profile.id}) is not applied to a diff: the comparison is about rasterisation and is measured without it`]),
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
/**
 * One element, measured: the inspector's report turned into millimetres and
 * contrast on the named panel — the footer readout, for a script. Nothing
 * found is not a failure: the JSON says `found: false` and exits 0, so an
 * agent can tell "not there" from "could not look".
 */
async function runInspect(cmd: InspectCommand): Promise<void> {
  const profile = findProfile(cmd.profileId)
  const target = new TargetSource(30, { mobileEmulation: true })
  try {
    const watch = watchFailures(target)
    const applied = target.setViewport(cmd.spec.cssWidth, cmd.spec.cssHeight, cmd.spec.deviceScaleFactor, cmd.spec.mobile)
    target.setTextScale(cmd.spec.textScale)
    if (cmd.spec.throttle !== null) {
      const refused = await target.setThrottle(findThrottle(cmd.spec.throttle))
      if (refused) human(`warning: ${refused}`)
    }
    await loadWithin(target, cmd.url, cmd, watch)
    const report = cmd.selector !== null ? await target.inspectSelector(cmd.selector) : await target.inspectAt(cmd.at!.x, cmd.at!.y)
    if (report === null) {
      const err = watch.failed()
      if (err) throw err
    }
    const where = cmd.selector !== null ? `selector ${JSON.stringify(cmd.selector)}` : `(${cmd.at!.x}, ${cmd.at!.y})`
    const readout =
      report === null
        ? null
        : inspectReadout(
            report,
            {
              cssWidth: applied.width,
              cssHeight: applied.height,
              deviceScaleFactor: cmd.spec.deviceScaleFactor,
              diagonalInches: cmd.spec.diagonalInches,
              textScale: cmd.spec.textScale,
            },
            { profileId: profile.id, profileLabel: profile.label, params: profileToParams(profile, DEFAULT_SETTINGS.hostNits) },
          )
    human(
      readout === null
        ? `inspect ${cmd.url} @ ${cmd.spec.presetId}: nothing at ${where}`
        : `inspect ${cmd.url} @ ${cmd.spec.presetId}: ${readout.element} · ${readout.font.px}px` +
            `${readout.font.mm !== null ? ` = ${readout.font.mm} mm` : ''} · ${readout.color} on ${readout.background ?? 'an image'}` +
            `${readout.contrast ? ` · ${readout.contrast.asIs}:1 here · ${readout.contrast.onPanel}:1 on ${profile.label}` : ''}`,
    )
    await machine({
      url: cmd.url,
      preset: cmd.spec.presetId,
      cssWidth: applied.width,
      cssHeight: applied.height,
      deviceScaleFactor: cmd.spec.deviceScaleFactor,
      profile: profile.id,
      ...(cmd.spec.textScale !== 1 ? { textScale: cmd.spec.textScale } : {}),
      ...(cmd.spec.throttle !== null ? { throttle: cmd.spec.throttle } : {}),
      found: readout !== null,
      readout,
    })
  } finally {
    target.destroy()
  }
}

async function runAudit(cmd: AuditCommand): Promise<void> {
  const target = new TargetSource(30, { mobileEmulation: true })
  try {
    const watch = watchFailures(target)
    const applied = target.setViewport(cmd.spec.cssWidth, cmd.spec.cssHeight, cmd.spec.deviceScaleFactor, cmd.spec.mobile)
    target.setTextScale(cmd.spec.textScale)
    if (cmd.spec.throttle !== null) {
      const refused = await target.setThrottle(findThrottle(cmd.spec.throttle))
      if (refused) human(`warning: ${refused}`)
    }
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
        textScale: cmd.spec.textScale,
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
      // Present only when a scale other than 1 was applied, as in `snap`.
      ...(cmd.spec.textScale !== 1 ? { textScale: cmd.spec.textScale } : {}),
      ...(cmd.spec.throttle !== null ? { throttle: cmd.spec.throttle } : {}),
      pageHeight: report.pageHeight,
      ...result,
    })
  } finally {
    target.destroy()
  }
}

async function runLint(cmd: LintCommand): Promise<void> {
  const profile = findProfile(cmd.profileId)
  const target = new TargetSource(30, { mobileEmulation: true })
  try {
    const watch = watchFailures(target)
    const applied = target.setViewport(cmd.spec.cssWidth, cmd.spec.cssHeight, cmd.spec.deviceScaleFactor, cmd.spec.mobile)
    target.setTextScale(cmd.spec.textScale)
    if (cmd.spec.throttle !== null) {
      const refused = await target.setThrottle(findThrottle(cmd.spec.throttle))
      if (refused) human(`warning: ${refused}`)
    }
    await loadWithin(target, cmd.url, cmd, watch)
    // One device pixel on this screen, in the page's CSS px: the walk
    // brings back only the edges thinner than that.
    const report = await target.lintPage(1 / (cmd.spec.deviceScaleFactor * cmd.spec.textScale))
    if (!report) {
      const err = watch.failed()
      if (err) throw err
      throw new Error('the page did not answer the lint (it may have navigated away, or thrown while being measured)')
    }
    const result = lintFindings(
      report,
      { cssWidth: applied.width, cssHeight: applied.height, deviceScaleFactor: cmd.spec.deviceScaleFactor, textScale: cmd.spec.textScale },
      { profileId: profile.id, profileLabel: profile.label, params: profileToParams(profile, DEFAULT_SETTINGS.hostNits) },
      { thinPx: cmd.thinPx },
    )
    for (const w of result.warnings) human(`warning: ${w}`)
    const s = result.summary
    const total = Object.values(s).reduce((a, b) => a + b, 0)
    human(
      `lint ${cmd.url} @ ${cmd.spec.presetId} ` +
        `(${applied.width}×${applied.height} CSS ${screenShape(applied.width, applied.height)} ×${cmd.spec.deviceScaleFactor}` +
        `${cmd.spec.textScale !== 1 ? `, text ${formatTextScale(cmd.spec.textScale)}` : ''}, ${profile.label}): ` +
        `${total} finding(s): ${s.hairline} hairline, ${s['thin-text']} thin text, ${s.contrast} contrast, ` +
        `${s['contrast-on-panel']} contrast on panel, ${s['image-upscaled']} upscaled, ${s['image-oversized']} oversized` +
        ` in ${result.groups.length} group(s)`,
    )
    // Findings are informational — CI thresholds are the caller's job.
    await machine({
      url: cmd.url,
      preset: cmd.spec.presetId,
      cssWidth: applied.width,
      cssHeight: applied.height,
      deviceScaleFactor: cmd.spec.deviceScaleFactor,
      ...(cmd.spec.textScale !== 1 ? { textScale: cmd.spec.textScale } : {}),
      ...(cmd.spec.throttle !== null ? { throttle: cmd.spec.throttle } : {}),
      pageHeight: report.pageHeight,
      ...result,
    })
  } finally {
    target.destroy()
  }
}

/** The package version: two levels above out/main, the same file inside app.asar. */
function cliVersion(): string {
  try {
    return (JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as { version?: string }).version ?? app.getVersion()
  } catch {
    return app.getVersion()
  }
}

const toImage = (bytes: Buffer, width: number, height: number, mime: 'image/png' | 'image/jpeg' = 'image/png'): ReportImage => ({
  base64: bytes.toString('base64'),
  width,
  height,
  ...(mime === 'image/png' ? {} : { mime }),
})

/**
 * The report: one self-contained HTML page for a matrix of screens. Each
 * screen is one render with the audit walk on the same loaded page; 1x
 * screens that fit a 2x reference also get the diff, so the page shows this
 * screen next to the one the page was designed on. The same pieces `snap`,
 * `audit` and `diff` are made of, on one page.
 */
async function runReport(cmd: ReportCommand): Promise<void> {
  const profile = findProfile(cmd.profileId)
  const thresholds = { tapMm: cmd.tapMm, textMm: cmd.textMm }
  const screens: ReportScreen[] = []
  const referenceMax = maxCssViewport(2)

  for (const spec of cmd.specs) {
    const r = await render(cmd.url, spec, { fullPage: false, waitMs: cmd.waitMs, timeoutMs: cmd.timeoutMs, audit: true, lint: true })
    const raw = bgraToRgba(r.frame.bgra, r.frame.width, r.frame.height)
    const profiled = profile.id !== 'reference'
    const img = profiled ? applyPanelProfile(raw, profile) : raw
    const warnings = [...r.warnings]
    const audit =
      r.auditReport === null || r.auditReport === undefined
        ? null
        : auditFindings(
            r.auditReport,
            { cssWidth: r.cssWidth, cssHeight: r.cssHeight, deviceScaleFactor: spec.deviceScaleFactor, diagonalInches: spec.diagonalInches, textScale: spec.textScale },
            thresholds,
          )

    const lint =
      r.lintReport === null || r.lintReport === undefined
        ? null
        : lintFindings(
            r.lintReport,
            { cssWidth: r.cssWidth, cssHeight: r.cssHeight, deviceScaleFactor: spec.deviceScaleFactor, textScale: spec.textScale },
            { profileId: profile.id, profileLabel: profile.label, params: profileToParams(profile, DEFAULT_SETTINGS.hostNits) },
            { thinPx: cmd.thinPx },
          )

    // The full page with the worst findings located on it: one extra render,
    // taken only when there is something to point at. Candidates come from
    // both walks — the audit's smallest first, then one exemplar per lint
    // group in rule order — a few of each within the captured height, pinned
    // on a downsampled overview and cropped at the render's own pixels.
    let problems: ReportProblems | undefined
    const lintGroups = lint ? lint.groups : []
    if ((audit && audit.findings.length > 0) || lintGroups.length > 0) {
      const full = await render(cmd.url, spec, { fullPage: true, tiled: true, waitMs: cmd.waitMs, timeoutMs: cmd.timeoutMs })
      const fullRaw = bgraToRgba(full.frame.bgra, full.frame.width, full.frame.height)
      const fullImg = profiled ? applyPanelProfile(fullRaw, profile) : fullRaw
      // Device px per page CSS px, read from the raster's own width so it holds
      // whatever the density and text scale did to it.
      const k = fullImg.width / r.cssWidth
      const capturedCssHeight = fullImg.height / k
      type Candidate = { rect: { x: number; y: number; width: number; height: number }; element: string; detail: string }
      const within = (c: Candidate): boolean => c.rect.y + c.rect.height / 2 <= capturedCssHeight
      const fromAudit: Candidate[] = (audit?.findings ?? []).map(f => ({
        rect: f.rect,
        element: f.element,
        detail:
          f.kind === 'small-target'
            ? `target ${Math.round(f.cssWidth)}×${Math.round(f.cssHeight)} px · ${f.mm.toFixed(2)} mm`
            : `text ${Math.round(f.fontSizePx)} px · ${f.mm.toFixed(2)} mm`,
      }))
      const fromLint: Candidate[] = lintGroups.map(g => ({ rect: g.exemplar.rect, element: g.exemplar.element, detail: lintDetail(g) }))
      const featured = [...fromAudit.filter(within).slice(0, REPORT_CROP_LIMIT), ...fromLint.filter(within).slice(0, REPORT_CROP_LIMIT)]
      const belowCapture = fromAudit.filter(c => !within(c)).length + fromLint.filter(c => !within(c)).length
      if (featured.length > 0) {
        const overviewFactor = Math.max(1, Math.round(fullImg.width / REPORT_OVERVIEW_WIDTH), Math.ceil(fullImg.height / REPORT_OVERVIEW_MAX_HEIGHT))
        const overview = boxDownsample(fullImg, overviewFactor)
        const features = featured.map((c, i) => {
          let cr = cropImage(fullImg, c.rect.x * k - REPORT_CROP_PAD, c.rect.y * k - REPORT_CROP_PAD, c.rect.width * k + REPORT_CROP_PAD * 2, c.rect.height * k + REPORT_CROP_PAD * 2)
          const cropFactor = Math.max(1, Math.ceil(Math.max(cr.width / 560, cr.height / 420)))
          if (cropFactor > 1) cr = boxDownsample(cr, cropFactor)
          return {
            n: i + 1,
            xFrac: (c.rect.x + c.rect.width / 2) / r.cssWidth,
            yFrac: (c.rect.y + c.rect.height / 2) / capturedCssHeight,
            crop: toImage(encodePng(cr), cr.width, cr.height),
            element: c.element,
            detail: c.detail,
          }
        })
        problems = {
          overview: toImage(encodeJpeg(overview, REPORT_OVERVIEW_JPEG_QUALITY), overview.width, overview.height, 'image/jpeg'),
          features,
          belowCapture,
        }
        warnings.push(...full.warnings.map(w => `full page: ${w}`))
      }
    }

    let diff: ReportScreen['diff'] = null
    let diffSkipped: string | null = null
    if (spec.deviceScaleFactor !== 1) {
      diffSkipped = 'a dense screen has no 1x-vs-2x comparison; the render itself is the evidence'
    } else if (r.cssWidth > referenceMax || r.cssHeight > referenceMax) {
      diffSkipped = `the CSS viewport exceeds ${referenceMax}px per axis, so a 2x reference would exceed the 4096-device-pixel cap`
    } else {
      const ref = await render(
        cmd.url,
        { ...spec, deviceScaleFactor: 2 },
        { fullPage: false, waitMs: cmd.waitMs, timeoutMs: cmd.timeoutMs, mobileEmulation: false },
      )
      const referenceFull = bgraToRgba(ref.frame.bgra, ref.frame.width, ref.frame.height)
      const referenceDeviceRows = inkRows(referenceFull)
      const reference = boxDownsample(referenceFull, 2)
      // Measured on the unprofiled render: the comparison is about
      // rasterisation, and a panel profile's brightness and black floor
      // would darken every pixel past the ink threshold (measured: 100%
      // coverage under budget-tn, every band "+90pp"). The reference is
      // unprofiled too, so like is compared with like.
      const metrics = diffMetrics(raw, reference, referenceDeviceRows, r.frame.settled && ref.frame.settled)
      diff = {
        metrics,
        target: profiled ? toImage(encodePng(raw), raw.width, raw.height) : null,
        reference: toImage(encodePng(reference), reference.width, reference.height),
      }
      warnings.push(...ref.warnings.map(w => `reference: ${w}`))
    }

    const ppi = audit?.ppi ?? null
    const preset = SCREEN_PRESETS.find(p => p.id === spec.presetId)
    const label = preset ? preset.label : `Custom ${spec.cssWidth}×${spec.cssHeight}${spec.deviceScaleFactor !== 1 ? ` @${spec.deviceScaleFactor}x` : ''}`
    screens.push({
      presetId: spec.presetId,
      label,
      cssWidth: r.cssWidth,
      cssHeight: r.cssHeight,
      deviceScaleFactor: spec.deviceScaleFactor,
      textScale: spec.textScale,
      diagonalInches: spec.diagonalInches,
      ppi,
      physicalMm:
        ppi === null
          ? null
          : { width: (r.cssWidth * spec.deviceScaleFactor * 25.4) / ppi, height: (r.cssHeight * spec.deviceScaleFactor * 25.4) / ppi },
      orientation: screenShape(r.cssWidth, r.cssHeight),
      png: toImage(encodePng(img), img.width, img.height),
      settled: r.frame.settled,
      unsettledReason: r.frame.unsettledReason,
      settledMs: r.settledMs,
      audit,
      lint,
      diff,
      diffSkipped,
      ...(problems ? { problems } : {}),
      warnings,
    })
    human(
      `report ${spec.presetId}: ${r.cssWidth}×${r.cssHeight} CSS, ` +
        `${audit ? `${audit.findings.length} audit finding(s)` : 'no audit answer'}, ` +
        `${diff ? `${diff.metrics.findings.length} diff finding(s)` : 'no diff'}`,
    )
  }

  const generatedAt = new Date().toISOString()
  const version = cliVersion()
  const out = resolve(cmd.out)
  mkdirSync(dirname(out), { recursive: true })
  const throttleId = cmd.specs[0]?.throttle ?? null
  const throttle = throttleId === null ? null : findThrottle(throttleId)
  const html = reportHtml({
    url: cmd.url,
    generatedAt,
    version,
    profile: { id: profile.id, label: profile.label },
    thresholds,
    screens,
    ...(throttle ? { throttle: { id: throttle.id, label: throttle.label, summary: throttle.summary } } : {}),
  })
  writeFileSync(out, html)
  human(`report ${cmd.url} → ${out} (${screens.length} screen(s), ${Math.round(html.length / 1024)} KiB)`)

  await machine({
    url: cmd.url,
    out,
    htmlBytes: Buffer.byteLength(html),
    generatedAt,
    profile: profile.id,
    thresholds,
    ...(throttleId !== null ? { throttle: throttleId } : {}),
    screens: screens.map(s => ({
      preset: s.presetId,
      cssWidth: s.cssWidth,
      cssHeight: s.cssHeight,
      deviceScaleFactor: s.deviceScaleFactor,
      ...(s.textScale !== 1 ? { textScale: s.textScale } : {}),
      ppi: s.ppi,
      settled: s.settled,
      ...(s.settled ? {} : { unsettledReason: s.unsettledReason }),
      ...(throttleId !== null ? { settledMs: s.settledMs } : {}),
      audit: s.audit ? { summary: s.audit.summary, findings: s.audit.findings.length, truncated: s.audit.truncated.findings } : null,
      lint: s.lint ? { summary: s.lint.summary, findings: s.lint.findings.length, groups: s.lint.groups.length, skipped: s.lint.skipped } : null,
      diff: s.diff
        ? { settled: s.diff.metrics.settled, inkCoverage: s.diff.metrics.inkCoverage, rows: s.diff.metrics.rows, findings: s.diff.metrics.findings }
        : null,
      diffSkipped: s.diffSkipped,
      ...(s.problems ? { problems: { featured: s.problems.features.length, belowCapture: s.problems.belowCapture } } : {}),
      warnings: s.warnings,
    })),
  })
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
// As in the app: Chrome's user agent without Electron's added token, which
// sites that refuse embedded browsers key on. A headless render of a page
// that serves an Electron UA a different page would be a render of the
// wrong page.
app.userAgentFallback = app.userAgentFallback.replace(/ Electron\/\S+/, '')
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
    } else if (cmd.command === 'report') {
      await runReport(cmd)
    } else if (cmd.command === 'inspect') {
      await runInspect(cmd)
    } else if (cmd.command === 'lint') {
      await runLint(cmd)
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
