import { app, nativeImage } from 'electron'
import { findThrottle } from '../shared/throttle'
import { formatTextScale } from '../shared/textScale'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { TargetSource } from '../main/targetSource'
import { maxCssViewport, screenShape } from '../shared/calibration'
import { SCROLL_HOST_SCRIPT } from '../shared/scrollHost'
import type { StuckBar } from '../shared/stuckChrome'
import { boxDownsample, cropImage, rgbaToBgra, type RGBAImage } from '../shared/downsample'
import { DEFAULT_SETTINGS, SCREEN_PRESETS, findProfile } from '../shared/presets'
import { inspectReadout } from '../shared/inspectReadout'
import { profileToParams } from '../shared/panelSim'
import type { LoadError, Walked } from '../shared/types'
import type { AuditRect, AuditReport } from '../shared/audit'
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
import { auditFindings, auditListTruncationNote } from './audit'
import { lintFindings, listTruncationNote, slimGroups, unwalkedImageNote, type LintGroup } from './lint'
import { bgraToRgba, captureQuiescent, type CapturedFrame, stitchBands, type CaptureBand, type UnsettledReason } from './capture'
import { diffMetrics, inkRows } from './metrics'
import { applyPanelProfile } from './panel'
import { HEADLESS_WALK_BUDGET_MS, walkHeadless, type HeadlessWalkOutcome } from './walk'
import { EMPTY_GRACE_MS, awaitContent, emptyDocumentNote, isEmptyAuditReport, isEmptyLintReport, type AwaitContentOutcome } from '../shared/emptyDocument'
import { Deadline, httpStatusNote, measureTimeoutNote, navigatedAfterLoadNote, unansweredMeasureMessage } from '../shared/measureBudget'
import { callChrome, findStuckChrome } from './stuckProbe'
import { warningSink } from './warnings'
import { walkCoverageNote } from '../shared/walkCoverage'
import { layoutScale } from '../shared/layoutScale'
import { findingPlace, type FindingPlace, reportHtml, type ReportImage, type ReportProblems, type ReportScreen } from './reportHtml'

/** The worst findings featured on the report's full-page overview, per source (audit, lint): pins + crops. */
const REPORT_CROP_LIMIT = 6
/** The overview is downsampled to about this device-pixel width to keep the file small. */
const REPORT_OVERVIEW_WIDTH = 800
/** Padding around a finding's rect in the crop, in device px. */
const REPORT_CROP_PAD = 16
/** The overview is also kept under this many device px tall; a long page becomes a map, the crops carry the detail. */
const REPORT_OVERVIEW_MAX_HEIGHT = 3200
/**
 * A tiled full-page capture stops after this many bands — each one screenful,
 * so 9,600 CSS px on a phone, 9,216 on the 768 laptop; the report counts what
 * lies past them.
 */
const MAX_TILE_BANDS = 12

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
  /** With `tiled`: how many bands the page was captured in; absent when one surface held it. */
  bands?: number
  /** Chrome hidden for the bands after the first; absent when one surface held the page. */
  stuckChrome?: StuckBar[]
  /**
   * Time from the start of navigation to the page going paint-quiet, with
   * `--wait` taken back out; null when it never settled within the budget.
   * How the page *feels* on the screen, under `--throttle` or without.
   */
  settledMs: number | null
  /** The walk before the audit and lint, when they were asked for and `walk` was not false (see cli/walk.ts). */
  walked?: Walked
}

interface RenderOptions {
  fullPage: boolean
  /**
   * With `fullPage`: a page taller than the screen is captured a screenful
   * at a time — the viewport kept the screen's own, the page scrolled a band
   * at a time, each band captured quiescent and stitched into one raster —
   * instead of being clamped at one surface. The report asks for this so its
   * findings can be located anywhere on the page; `snap --full-page --tiled`
   * is the same capture on request.
   */
  tiled?: boolean
  /**
   * Keeps chrome stuck to the viewport in every band. Off by default: a stuck
   * bar is painted into each band, which both repeats it down the stitched
   * raster and hides the page rows behind it in every band but the first.
   */
  keepStuckChrome?: boolean
  /** Opts out of banding: one viewport as tall as the page, as `--full-page` used to be. */
  singleSurface?: boolean
  waitMs: number
  timeoutMs: number
  /** False only for the diff reference: dense raster, desktop semantics. */
  mobileEmulation?: boolean
  /** Also run the audit walk on the loaded page, so a report costs one load per screen. */
  audit?: boolean
  /** Also run the lint walk on the loaded page. */
  lint?: boolean
  /** Walk the page a screenful at a time before the audit and lint (default true); false measures it as it first shows. */
  walk?: boolean
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
/**
 * The sentence for a load that outran the budget. Under a throttle a slow
 * load is the point, and bbc.com under budget-phone settles at 70 s: the old
 * "load did not finish within 30000 ms" named neither the throttle nor the
 * flag that would have let it finish.
 */
function loadTimeoutMessage(timeoutMs: number, throttle: string | null, url: string): string {
  return (
    `load did not finish within ${timeoutMs} ms` +
    `${throttle !== null ? ` under --throttle ${throttle} (a slow load is what a throttle is for)` : ''}: ${url} — raise --timeout for the full load`
  )
}

/**
 * The sentence a measurement carries for a load the budget cut: the page was
 * measured as it stood. apnews.com behind its consent wall never fires
 * `load` — a partner's beacon never answers — at 30 s or at 60 s, and the
 * old refusal ("raise --timeout for the full load") could not help; the DOM
 * was there to measure, as the snap's capture already showed.
 */
function cutLoadMeasureNote(timeoutMs: number, throttle: string | null, url: string): string {
  return (
    `load did not finish within ${timeoutMs} ms${throttle !== null ? ` under --throttle ${throttle}` : ''}: ${url} — measured the page as it stood; ` +
    `a page still arriving shows more with a longer --timeout, a page whose load never completes (a beacon that never answers) does not`
  )
}

/**
 * After a load the budget cut short, how long the capture gives the page to
 * go quiet before taking the frame as it stands. Short: the budget is spent,
 * and the frame is what a user on that connection was looking at.
 */
const CUT_LOAD_CAPTURE_MS = 2_000

async function loadWithin(
  target: TargetSource,
  url: string,
  options: { waitMs: number; timeoutMs: number; throttle?: string | null },
  watch: ReturnType<typeof watchFailures>,
  /**
   * Takes the page as it stands when the load outruns the budget — a render
   * with settled false, a measurement with `cutLoadMeasureNote` — since the
   * frame is still what the screen showed and the DOM is still what is there.
   * Without it a cut load is an error, which the report's renders keep.
   */
  rescue = false,
): Promise<{ loaded: boolean; arrivedAt: string | null }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<false>(resolve => {
    timer = setTimeout(() => resolve(false), options.timeoutMs)
  })
  let loaded: boolean
  try {
    loaded = await Promise.race([target.load(url).then(() => true), timeout])
  } finally {
    clearTimeout(timer)
  }
  const error = watch.loadError()
  if (error) throw new Error(`load failed: ${error.description} (code ${error.code}) — ${error.url}`)
  if (!loaded) {
    if (!rescue) throw new Error(loadTimeoutMessage(options.timeoutMs, options.throttle ?? null, url))
    // The budget is spent, so the load is stopped: what has arrived stays,
    // and the page stops loading. Without this a page whose `load` never
    // fires — apnews.com behind its consent wall, a beacon that never
    // answers — held every script call after it, since Electron suspends
    // `executeJavaScript` "until web page stop loading", and the measurement
    // that followed answered nothing within its budget while the DOM sat
    // there. A capture needs no script and never noticed.
    target.webContents.stop()
    return { loaded: false, arrivedAt: null }
  }
  // A navigation that lands during the wait is the page that will be
  // measured: under a dev server that is HMR, an auth redirect or a router
  // replace, and run 13 measured revision 2 of a fixture while naming the
  // address of revision 0. `measureAfterLoad`'s own watch starts after this
  // wait, so the wait watches for itself and hands the arrival on.
  let arrivedAt: string | null = null
  const onNav = (url: string, inPage: boolean): void => {
    if (!inPage) arrivedAt = url
  }
  target.on('url-changed', onNav)
  try {
    if (options.waitMs > 0) {
      const until = Date.now() + options.waitMs
      while (Date.now() < until) {
        const err = watch.failed()
        if (err) throw err
        await sleep(Math.min(50, until - Date.now()))
      }
    }
  } finally {
    target.off('url-changed', onNav)
  }
  return { loaded: true, arrivedAt }
}

async function render(url: string, spec: RenderSpec, options: RenderOptions): Promise<RenderResult> {
  const target = new TargetSource(30, { mobileEmulation: options.mobileEmulation ?? true })
  try {
    const watch = watchFailures(target)
    const failed = watch.failed
    // Said once each: a banded capture meets the same animation on every band.
    const { warnings, warn } = warningSink(human)
    const exec = (code: string): Promise<unknown> => target.webContents.executeJavaScript(code)
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
    const load = await loadWithin(target, url, { ...options, throttle: spec.throttle }, watch, true)
    if (!load.loaded) {
      warn(`warning: ${loadTimeoutMessage(options.timeoutMs, spec.throttle, url)}; capturing the page as it stands — settled false, settledMs null`)
    }

    let cssHeight = applied.height
    let frame: CapturedFrame | null = null
    let bandsCaptured: number | undefined
    let stuckChrome: StuckBar[] | undefined
    // Under a throttle the quiet moment is the measurement (`settledMs`), and
    // a page loading over 3G paints steadily too: no early exit there. After
    // a load the budget cut short, the capture gets a short budget of its own
    // and takes the frame as it stands; its "kept painting (animation?)" line
    // would explain what the load warning above already has.
    const quiescent = (): Promise<CapturedFrame> =>
      captureQuiescent(target, {
        timeoutMs: load.loaded ? options.timeoutMs : CUT_LOAD_CAPTURE_MS,
        onWarn: load.loaded ? warn : m => (/kept painting/.test(m) ? undefined : warn(m)),
        failure: failed,
        animationExit: spec.throttle === null,
      })
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
      // An app shell (`html, body { overflow: hidden }` with an inner
      // `overflow-y: auto` container — dashboards, editors, most web apps)
      // reports a document exactly as tall as the viewport however much
      // content it holds, so scrolling the window gets the first screen and
      // nothing else. Find the element the page really scrolls, using the same
      // walk the live scroll uses (shared/scrollHost.ts), and leave it on the
      // page for the band loop below to drive.
      const shell = (await target.webContents.executeJavaScript(`${SCROLL_HOST_SCRIPT}
        ;(() => {
          const root = document.scrollingElement
          const rootScrolls = !!root && root.scrollHeight > root.clientHeight + 1
          const el = rootScrolls ? null : findScroller()
          window.__obsrvScrollHost = el
          // A page that hides the root's overflow has said it manages its own
          // scrolling. If nothing in its light DOM scrolls either, whatever it
          // shows past this screen is somewhere the capture cannot go. The
          // walks ask the same question: overflowHidden, in shared/scrollHost.
          const hidden = overflowHidden()
          if (!el) return { rootScrolls, found: false, hidden, top: 0, height: 0, scrollHeight: 0 }
          const r = el.getBoundingClientRect()
          return {
            rootScrolls,
            found: true,
            hidden,
            top: Math.round(r.top + window.scrollY),
            height: el.clientHeight,
            scrollHeight: Math.ceil(el.scrollHeight),
          }
        })()`)) as { rootScrolls: boolean; found: boolean; hidden: boolean; top: number; height: number; scrollHeight: number }
      // Banding is what a full-page capture does now: a single tall surface
      // either lays a viewport-sized page out differently or clamps at the
      // device-pixel cap, and neither is the page. `--single-surface` asks for
      // the old behaviour back.
      const banding = !options.singleSurface
      const shellBands = banding && shell.found && shell.scrollHeight > shell.height + 1
      if (shellBands) {
        // The page scrolls an element, so the bands do too. Each band is a
        // full-width capture of the viewport; the first carries the chrome
        // above the scroller, and every later one contributes just the
        // scroller's own rows, placed where that scroll position puts them.
        // The stitched raster is therefore laid out in the page's own
        // coordinates — chrome at the top, content below it — which is the
        // space the walks report their rects in, so the report's pins need no
        // conversion.
        const step = shell.height
        const bandsWanted = Math.ceil(shell.scrollHeight / step)
        const bandCount = Math.min(bandsWanted, MAX_TILE_BANDS)
        const bands: CaptureBand[] = []
        let settled = true
        let unsettledReason: UnsettledReason | undefined
        const k = spec.deviceScaleFactor * spec.textScale
        const scrollShellTo = async (top: number): Promise<number> =>
          Math.round(
            (await target.webContents.executeJavaScript(
              `(() => { const el = window.__obsrvScrollHost; if (!el) return 0; el.scrollTop = ${top}; return el.scrollTop })()`,
            )) as number,
          )
        // The scroller's own stuck chrome — a sticky toolbar or table header
        // inside it — repeats exactly as a page's header does, and hides the
        // rows behind it in every band but the first. The app's chrome outside
        // the scroller needs no help: the slice below already leaves it out.
        // `installStuckChrome` frames all of this against `__obsrvScrollHost`,
        // which the shell probe above has already left on the page.
        const stuck =
          bandCount > 1 && !options.keepStuckChrome ? await findStuckChrome({ exec, scrollTo: scrollShellTo, sleep }, step, warn) : []
        try {
          for (let i = 0; i < bandCount; i++) {
            const wantTop = i * step
            const top = await scrollShellTo(wantTop)
            if (i === 1 && stuck.length > 0) await callChrome(exec, 'hide')
            const f = await quiescent()
            if (!f.settled) {
              settled = false
              if (unsettledReason === undefined) unsettledReason = f.unsettledReason
            }
            if (i === 0) {
              bands.push({ y: 0, width: f.width, height: f.height, bgra: f.bgra })
            } else {
              // Just the scroller's rows out of the viewport capture. Bands are
              // full width, so this is a contiguous slice.
              const from = Math.max(0, Math.round(shell.top * k))
              const to = Math.min(f.height, Math.round((shell.top + shell.height) * k))
              if (to > from) {
                bands.push({
                  y: Math.round((shell.top + top) * k),
                  width: f.width,
                  height: to - from,
                  bgra: f.bgra.subarray(from * f.width * 4, to * f.width * 4),
                })
              }
            }
            // The scroll clamped short of where the next band would start: that
            // was the bottom, and this band already covers it.
            if (top < wantTop) break
          }
        } finally {
          if (stuck.length > 0) {
            await callChrome(exec, 'restore').catch(() => undefined)
          }
        }
        if (stuck.length > 0) {
          stuckChrome = stuck
          const what = stuck.map(b => `${b.element} (${b.position}, ${b.height} px)`).join(', ')
          human(`hid chrome stuck inside the scroller for the bands after the first: ${what}`)
        }
        // Put the page back where the walks expect it: their rects are
        // measured against a scroller at the top, and audit and lint run after
        // this capture.
        await target.webContents.executeJavaScript(
          '(() => { const el = window.__obsrvScrollHost; if (el) el.scrollTop = 0; return 0 })()',
        )
        const width = bands[0]!.width
        const height = Math.round((shell.top + shell.scrollHeight) * k)
        frame = { width, height, bgra: stitchBands(width, height, bands), settled, ...(unsettledReason !== undefined ? { unsettledReason } : {}) }
        bandsCaptured = bands.length
        if (bandsWanted > bandCount) {
          warn(
            `warning: the page scrolls an inner container ${shell.scrollHeight} CSS px tall; captured the first ${bandCount} ` +
              `bands of ${step} CSS px (${MAX_TILE_BANDS} at most) — what lies past them is not in the raster`,
          )
        } else {
          human(`the page scrolls an inner container; captured in ${bands.length} band(s) of ${step} CSS px, the scroller's own height`)
        }
      } else if (!shell.rootScrolls && !shell.found && shell.hidden) {
        // Measured on play.tailwindcss.com: root and body both `overflow:
        // hidden`, and not one light-DOM element with `overflow-y: auto` that
        // overflows — a virtualised editor that scrolls by transform, and a
        // preview in an iframe. The walk is right to find nothing, and the
        // capture is genuinely one screen; saying so is the honest part.
        warn(
          `warning: this page hides the document's overflow and scrolls nothing the capture can reach — no ` +
            `scrollable container in its light DOM. Content in an iframe, in a shadow root, or in a container ` +
            `that scrolls by transform (a virtualised list or editor) is past this one screen and not in the PNG`,
        )
      } else if (!shell.rootScrolls && shell.found && shell.scrollHeight > shell.height + 1) {
        // Same page, but without --tiled there is nothing to scroll: say what
        // is missing rather than returning the first screen quietly.
        warn(
          `warning: the document itself does not scroll — this page keeps its content in an inner scroller ` +
            `${shell.scrollHeight} CSS px tall (an app shell). A full-page capture on one surface scrolls the window, ` +
            `which this page ignores, so the PNG is the first screen only; add --tiled to capture the scroller itself. ` +
            `The audit and lint walks see the whole page either way`,
        )
      }
      if (!shellBands && surfaceHeight > cssHeight) {
        const limit = maxCssViewport(spec.deviceScaleFactor)
        if (banding) {
          // Taller than the screen: keep the viewport the screen's own and
          // capture the page a screenful at a time, scrolling between
          // captures. Not a taller viewport: a page laid out for one is a
          // different page — `100vh` sections grow with it (measured: a hero
          // 800 px tall on the phone came out 2048 when the viewport was held
          // at the cap), and the audit and lint walks that follow would
          // measure that page, not the screen's. Each band is its own
          // quiescent capture, so an animating page pays its early exit per
          // band. Chrome stuck to the viewport is painted into every band, so
          // it is hidden for the bands after the first (`hideStuckChrome`
          // below); `--keep-stuck-chrome` leaves it.
          const bandPage = applied.height / spec.textScale
          const bandsWanted = Math.ceil(scrollHeight / bandPage)
          const bandCount = Math.min(bandsWanted, MAX_TILE_BANDS)
          const bands: CaptureBand[] = []
          let settled = true
          let unsettledReason: UnsettledReason | undefined
          const scrollBandTo = async (y: number): Promise<number> =>
            Math.round(
              (await target.webContents.executeJavaScript(
                `window.scrollTo({ top: ${y}, left: 0, behavior: 'instant' }); window.scrollY`,
              )) as number,
            )
          const stuck =
            bandCount > 1 && !options.keepStuckChrome ? await findStuckChrome({ exec, scrollTo: scrollBandTo, sleep }, bandPage, warn) : []
          try {
            for (let i = 0; i < bandCount; i++) {
              const wantY = Math.round(i * bandPage)
              const y = await scrollBandTo(wantY)
              // Hidden from the second band on: the first is the page as it
              // first shows, chrome and all.
              if (i === 1 && stuck.length > 0) await callChrome(exec, 'hide')
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
          } finally {
            // The walks run on this page after the capture, and an agent
            // driving the app keeps looking at it: whatever was hidden goes
            // back even if a band threw.
            if (stuck.length > 0) {
              await callChrome(exec, 'restore').catch(() => undefined)
            }
          }
          if (stuck.length > 0) {
            stuckChrome = stuck
            const what = stuck.map(b => `${b.element} (${b.position}, ${b.height} px)`).join(', ')
            human(`hid chrome stuck to the viewport for the bands after the first: ${what}`)
          }
          const width = bands[0]!.width
          const height = Math.max(...bands.map(b => b.y + b.height))
          frame = { width, height, bgra: stitchBands(width, height, bands), settled, ...(unsettledReason !== undefined ? { unsettledReason } : {}) }
          bandsCaptured = bands.length
          if (bandsWanted > bandCount) {
            warn(
              `warning: full page is ${surfaceHeight} CSS px tall; captured the first ${bandCount} bands of ${applied.height} CSS px ` +
                `(${MAX_TILE_BANDS} at most) — what lies past them is not in the raster`,
            )
          } else {
            human(`full page is ${surfaceHeight} CSS px tall; captured in ${bands.length} band(s) of ${applied.height} CSS px, the screen's own height`)
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
          // One surface means a viewport as tall as the page, and a page that
          // sizes anything against the viewport is then a different page: a
          // `100vh` hero is the screen's height on the screen and the whole
          // surface's height here. Measured rather than assumed — the page is
          // asked again, and only a page that actually moved is warned about.
          const grownHeight = Math.ceil(
            (await target.webContents.executeJavaScript(
              'Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)',
            )) as number,
          )
          if (grownHeight > scrollHeight + Math.max(8, scrollHeight * 0.02)) {
            warn(
              `warning: this page lays out against the viewport height — on a surface ${wanted} CSS px tall it is ` +
                `${grownHeight} CSS px, against ${scrollHeight} on the screen itself; the capture is that taller ` +
                `layout, not what the screen shows. Add --tiled to capture the page a screenful at a time instead`,
            )
          }
        }
      }
    }

    if (frame === null) frame = await quiescent()
    // A frame taken after a cut load can be paint-quiet — a page waiting on
    // its network is — but it is not the settled page: measured on bbc.com
    // under budget-phone, the capture said settled with settledMs 30,413
    // beside the warning that said the load never finished.
    if (!load.loaded) frame = { ...frame, settled: false, unsettledReason: 'loading' }
    const settledMs = frame.settled ? Math.max(0, Date.now() - startedAt - options.waitMs) : null
    // The measurements see the page a user who scrolled it would: walked to
    // the end and back first, so lazy images have loaded and late sections
    // mounted (cli/walk.ts). `--no-walk` measures it as it first shows.
    let walked: Walked | undefined
    let documentLocked: boolean | undefined
    if ((options.audit || options.lint) && options.walk !== false) {
      const w = await walkHeadless(target)
      for (const n of w.notes) warn(`warning: ${n}`)
      walked = w.walked
      documentLocked = w.documentLocked
    }
    const auditReport = options.audit ? await target.auditPage() : undefined
    const lintReport = options.lint ? await target.lintPage(1 / (spec.deviceScaleFactor * spec.textScale)) : undefined
    // The walk may have seen the end of a page it never crossed — a consent
    // layer that fixes the body, a page that grew after the walk: say so.
    // Both heights in the screen's px: a page laid out wider than the screen
    // and drawn to fit reports its height in its own, larger, px.
    const scale = layoutScale(applied.width, spec.textScale, auditReport?.viewport.width ?? lintReport?.viewport.width ?? 0)
    const coverage = walkCoverageNote(walked, applied.height / spec.textScale, Math.max(auditReport?.pageHeight ?? 0, lintReport?.pageHeight ?? 0) * scale, {
      documentLocked,
    })
    if (coverage !== null) warn(`warning: ${coverage}`)
    return {
      frame,
      cssWidth: applied.width,
      cssHeight,
      warnings,
      settledMs,
      ...(auditReport !== undefined ? { auditReport } : {}),
      ...(lintReport !== undefined ? { lintReport } : {}),
      ...(walked !== undefined ? { walked } : {}),
      ...(bandsCaptured !== undefined ? { bands: bandsCaptured } : {}),
      ...(stuckChrome !== undefined ? { stuckChrome } : {}),
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
      // Only under --full-page: the flagless JSON is a contract. `tiled` says
      // the page was captured in bands, which is now the default, so it is
      // false only when --single-surface asked for one viewport.
      ...(cmd.fullPage ? { tiled: !cmd.singleSurface, bands: r.bands ?? 1, stuckChrome: r.stuckChrome ?? [] } : {}),
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
/**
 * The measurement phase, within a budget of its own (`shared/measureBudget`):
 * the walk, the wait for a document with nothing in it, and the page asks.
 * The budget is `--timeout`, the same figure as the load's, counted from the
 * load's end. A page that navigates itself after `load` — a bot challenge
 * that solved and reloaded, an interstitial that moved on, a redirect by
 * script — is given the rest of the budget to arrive, then walked and
 * measured where it arrived, and the outcome names where that was.
 */
interface MeasureOutcome<T> {
  report: T | null
  walk: HeadlessWalkOutcome
  /** The page never answered within the budget: the caller answers with nothing, and says so. */
  timedOut: boolean
  /** The grace ran out on a document with nothing in it. */
  stillEmpty: boolean
  waitedMs: number
  /** Where the page navigated to after `load`, when it did. */
  arrivedAt: string | null
}

async function measureAfterLoad<T>(
  target: TargetSource,
  watch: ReturnType<typeof watchFailures>,
  cmd: { walk: boolean; timeoutMs: number },
  ask: (budgetMs: number) => Promise<T | null>,
  isEmpty: (report: T) => boolean,
  /** Where the page had already gone during the load's wait, when it did. */
  arrivedDuringWait: string | null = null,
): Promise<MeasureOutcome<T>> {
  const deadline = new Deadline(cmd.timeoutMs)
  // A holder rather than a `let`: the listener assigns it from a closure, which narrowing does not see.
  const nav: { arrivedAt: string | null } = { arrivedAt: arrivedDuringWait }
  const onNav = (url: string, inPage: boolean): void => {
    if (!inPage) nav.arrivedAt = url
  }
  target.on('url-changed', onNav)
  const walkWithin = (): Promise<HeadlessWalkOutcome> =>
    cmd.walk ? walkHeadless(target, Math.min(HEADLESS_WALK_BUDGET_MS, deadline.remaining())) : Promise.resolve({ notes: [] })
  // A page that navigated under the measurement gets the rest of the budget to finish loading.
  const settle = async (): Promise<void> => {
    while (nav.arrivedAt !== null && !deadline.passed() && target.webContents.isLoading()) {
      const err = watch.failed()
      if (err) throw err
      await sleep(50)
    }
  }
  try {
    let walk: HeadlessWalkOutcome = { notes: [] }
    let held: AwaitContentOutcome<T> = { report: null, waitedMs: 0, stillEmpty: false, arrived: false }
    for (let attempt = 0; attempt < 3; attempt++) {
      const seen: string | null = nav.arrivedAt
      await settle()
      walk = await walkWithin()
      held = await awaitContent(() => ask(deadline.remaining()), isEmpty, { graceMs: Math.min(EMPTY_GRACE_MS, deadline.remaining()) })
      if (held.arrived && cmd.walk) {
        // The walk saw an empty page: walk the one that filled, and measure that.
        walk = await walkWithin()
        held = { ...held, report: (await ask(deadline.remaining())) ?? held.report }
      }
      if (held.report !== null) break
      if (target.askOutcome() === 'timeout' || deadline.passed()) break
      // The ask failed for another reason — a navigation under it, most
      // likely; when the page moved, go again on the page it arrived at.
      if (nav.arrivedAt === seen) break
    }
    return {
      report: held.report,
      walk,
      timedOut: held.report === null && (target.askOutcome() === 'timeout' || deadline.passed()),
      stillEmpty: held.stillEmpty,
      waitedMs: held.waitedMs,
      arrivedAt: nav.arrivedAt,
    }
  } finally {
    target.off('url-changed', onNav)
  }
}

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
    const load = await loadWithin(target, cmd.url, { waitMs: cmd.waitMs, timeoutMs: cmd.timeoutMs, throttle: cmd.spec.throttle }, watch)
    // The one page ask, within the same budget as the load (`shared/measureBudget`).
    const report =
      cmd.selector !== null ? await target.inspectSelector(cmd.selector, cmd.timeoutMs) : await target.inspectAt(cmd.at!.x, cmd.at!.y, cmd.timeoutMs)
    const timedOut = report === null && target.askOutcome() === 'timeout'
    if (report === null && !timedOut) {
      const err = watch.failed()
      if (err) throw err
    }
    const notes = timedOut ? [measureTimeoutNote('inspect', cmd.timeoutMs)] : []
    // The element was read on the page that is there now, which is not always
    // the page that was asked for: it may have moved under the wait, and it
    // may be the server's error page.
    if (load.arrivedAt !== null) notes.push(navigatedAfterLoadNote(cmd.url, load.arrivedAt))
    const inspectStatus = target.httpStatus()
    const inspectStatusNote = httpStatusNote(inspectStatus.code, inspectStatus.text, inspectStatus.url)
    if (inspectStatusNote !== null) notes.push(inspectStatusNote)
    for (const n of notes) human(`warning: ${n}`)
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
      // Both: the call's own notes (a measurement that ran out of budget) and
      // the readout's (the layout scale, when it is not 1). A reader of
      // `notes` is looking for everything worth knowing about this answer, and
      // a page drawn at 0.37x because it has no viewport meta tag is the most
      // important thing about the millimetres above it. The readout keeps its
      // copy for a caller that reads only that.
      notes: [...notes, ...(readout === null ? [] : readout.notes)],
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
    const notes: string[] = []
    const load = await loadWithin(target, cmd.url, { waitMs: cmd.waitMs, timeoutMs: cmd.timeoutMs, throttle: cmd.spec.throttle }, watch, true)
    if (!load.loaded) notes.push(cutLoadMeasureNote(cmd.timeoutMs, cmd.spec.throttle, cmd.url))
    const m = await measureAfterLoad(target, watch, cmd, budget => target.auditPage(budget), isEmptyAuditReport, load.arrivedAt)
    // A 4xx or 5xx page is measured like any other page, so say which one
    // these figures are of: a mistyped route, a stale dev server or the wrong
    // port all answer with a page, and run 13's 404 was silent.
    const status = target.httpStatus()
    const statusNote = httpStatusNote(status.code, status.text, status.url)
    const walk = m.walk
    for (const n of walk.notes) human(`warning: ${n}`)
    let report = m.report
    if (report === null && !load.loaded && !m.timedOut) {
      // The cut came before the navigation even committed — under a throttle
      // the first byte can take longer than the budget — so there is no page
      // to ask; the figures are of nothing, and the cut-load warning says so.
      report = { viewport: { width: applied.width, height: applied.height }, pageHeight: applied.height, targets: [], text: [], truncated: { targets: 0, text: 0 } }
    } else if (report === null) {
      if (!m.timedOut) {
        const err = watch.failed()
        if (err) throw err
        throw new Error(unansweredMeasureMessage('audit', target.askOutcome()))
      }
      // The page never answered within the budget: the figures are of nothing, and the note says so.
      notes.push(measureTimeoutNote('audit', cmd.timeoutMs, m.arrivedAt === null ? undefined : { from: cmd.url, to: m.arrivedAt }))
      if (statusNote !== null) notes.push(statusNote)
      report = { viewport: { width: applied.width, height: applied.height }, pageHeight: applied.height, targets: [], text: [], truncated: { targets: 0, text: 0 } }
    } else {
      if (m.arrivedAt !== null) notes.push(navigatedAfterLoadNote(cmd.url, m.arrivedAt))
      // After the arrival, which names the page, and before anything about
      // what was in it: an error status says the page is not the one asked
      // for, so every sentence after it is about a page the reader did not
      // choose. Read the other way round — measured on the merge of this and
      // the shadow-root work, 2026-09-12 — a paragraph about the error page's
      // web components arrives first and reads as being about the page asked
      // for, and the 404 only lands at the end.
      if (statusNote !== null) notes.push(statusNote)
      if (m.stillEmpty) notes.push(emptyDocumentNote('audit', m.waitedMs, report.frames, report.shadow))
    }
    for (const n of notes) human(`warning: ${n}`)
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
    // The list's cap is said by whoever prints the list; with --groups-only there is none.
    const listed = cmd.groupsOnly ? null : auditListTruncationNote(result.truncated.findings)
    if (listed !== null) human(`warning: ${listed}`)
    // The page's height is in its own px; the screen's are what the walk counted in.
    const coverage = walkCoverageNote(walk.walked, applied.height / cmd.spec.textScale, report.pageHeight * result.layoutScale, {
      documentLocked: walk.documentLocked,
    })
    if (coverage !== null) human(`warning: ${coverage}`)
    const t = result.summary.targets
    const x = result.summary.text
    human(
      `audit ${cmd.url} @ ${cmd.spec.presetId} ` +
        `(${applied.width}×${applied.height} CSS ${screenShape(applied.width, applied.height)}` +
        `${result.ppi !== null ? `, ${result.ppi} ppi` : ''}): ` +
        `${t.count} targets${t.under !== null ? ` (${t.under} under ${cmd.tapMm} mm)` : ''}, ` +
        `${x.count} text elements${x.under !== null ? ` (${x.under} under ${cmd.textMm} mm)` : ''}, ` +
        `${cmd.groupsOnly ? `${result.groups.length} group(s), the list left out` : `${result.findings.length} finding(s) listed`}`,
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
      ...(walk.walked !== undefined ? { walked: walk.walked } : {}),
      ...result,
      findings: cmd.groupsOnly ? [] : result.findings,
      // With no list there is nothing cut from it; the summary counts everything.
      ...(cmd.groupsOnly ? { truncated: { ...result.truncated, findings: 0 } } : {}),
      warnings: [...notes, ...result.warnings, ...(listed === null ? [] : [listed]), ...walk.notes, ...(coverage === null ? [] : [coverage])],
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
    const notes: string[] = []
    const load = await loadWithin(target, cmd.url, { waitMs: cmd.waitMs, timeoutMs: cmd.timeoutMs, throttle: cmd.spec.throttle }, watch, true)
    if (!load.loaded) notes.push(cutLoadMeasureNote(cmd.timeoutMs, cmd.spec.throttle, cmd.url))
    // One device pixel on this screen, in the page's CSS px: the walk
    // brings back only the edges thinner than that.
    const m = await measureAfterLoad(
      target,
      watch,
      cmd,
      (budget): Promise<LintReport | null> => target.lintPage(1 / (cmd.spec.deviceScaleFactor * cmd.spec.textScale), budget),
      isEmptyLintReport,
      load.arrivedAt,
    )
    const lintStatus = target.httpStatus()
    const lintStatusNote = httpStatusNote(lintStatus.code, lintStatus.text, lintStatus.url)
    const walk = m.walk
    for (const n of walk.notes) human(`warning: ${n}`)
    let report = m.report
    if (report === null && !load.loaded && !m.timedOut) {
      // No page yet: the cut came before the navigation committed (see the audit).
      report = {
        viewport: { width: applied.width, height: applied.height },
        pageHeight: applied.height,
        text: [],
        edges: [],
        images: [],
        truncated: { text: 0, edges: 0, images: 0 },
        spacers: 0,
      }
    } else if (report === null) {
      if (!m.timedOut) {
        const err = watch.failed()
        if (err) throw err
        throw new Error(unansweredMeasureMessage('lint', target.askOutcome()))
      }
      notes.push(measureTimeoutNote('lint', cmd.timeoutMs, m.arrivedAt === null ? undefined : { from: cmd.url, to: m.arrivedAt }))
      if (lintStatusNote !== null) notes.push(lintStatusNote)
      report = {
        viewport: { width: applied.width, height: applied.height },
        pageHeight: applied.height,
        text: [],
        edges: [],
        images: [],
        truncated: { text: 0, edges: 0, images: 0 },
        spacers: 0,
      }
    } else {
      if (m.arrivedAt !== null) notes.push(navigatedAfterLoadNote(cmd.url, m.arrivedAt))
      // The arrival, then the status, then what was in it — see the audit.
      if (lintStatusNote !== null) notes.push(lintStatusNote)
      if (m.stillEmpty) notes.push(emptyDocumentNote('lint', m.waitedMs, report.frames, report.shadow))
    }
    for (const n of notes) human(`warning: ${n}`)
    const result = lintFindings(
      report,
      { cssWidth: applied.width, cssHeight: applied.height, deviceScaleFactor: cmd.spec.deviceScaleFactor, textScale: cmd.spec.textScale },
      { profileId: profile.id, profileLabel: profile.label, params: profileToParams(profile, DEFAULT_SETTINGS.hostNits) },
      { thinPx: cmd.thinPx },
    )
    for (const w of result.warnings) human(`warning: ${w}`)
    // The list is this output's to print, so the sentence about its cap is
    // this output's to add — and neither goes out under --groups-only.
    const listed = cmd.groupsOnly ? null : listTruncationNote(result.truncated.findings)
    if (listed !== null) human(`warning: ${listed}`)
    // A walk that ran out of budget leaves the page below its last screenful
    // as it first shipped; an image finding down there may be a placeholder.
    const unwalked =
      walk.walked !== undefined && !walk.walked.atEnd
        ? unwalkedImageNote(result.findings, (walk.walked.screenfuls + 1) * (applied.height / cmd.spec.textScale))
        : null
    if (unwalked !== null) human(`warning: ${unwalked}`)
    const coverage = walkCoverageNote(walk.walked, applied.height / cmd.spec.textScale, report.pageHeight * result.layoutScale, {
      documentLocked: walk.documentLocked,
    })
    if (coverage !== null) human(`warning: ${coverage}`)
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
      ...(walk.walked !== undefined ? { walked: walk.walked } : {}),
      ...result,
      findings: cmd.groupsOnly ? [] : result.findings,
      ...(cmd.groupsOnly ? { truncated: { ...result.truncated, findings: 0 } } : {}),
      groups: slimGroups(result.groups),
      warnings: [
        ...notes,
        ...result.warnings,
        ...walk.notes,
        ...(listed === null ? [] : [listed]),
        ...(unwalked === null ? [] : [unwalked]),
        ...(coverage === null ? [] : [coverage]),
      ],
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
    const r = await render(cmd.url, spec, { fullPage: false, waitMs: cmd.waitMs, timeoutMs: cmd.timeoutMs, audit: true, lint: true, walk: cmd.walk })
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
    if (lint && r.walked !== undefined && !r.walked.atEnd) {
      const unwalked = unwalkedImageNote(lint.findings, (r.walked.screenfuls + 1) * (r.cssHeight / spec.textScale))
      if (unwalked !== null) lint.warnings.push(unwalked)
    }

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
      type Candidate = { rect: AuditRect; element: string; detail: string }
      const place = (c: Candidate): FindingPlace => findingPlace(c.rect, capturedCssHeight)
      const within = (c: Candidate): boolean => place(c) === 'page'
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
      // Two ways a finding cannot be pinned, kept apart because the reader
      // acts on them differently. `below` is the page outrunning the capture;
      // `panel` is a finding inside a scroller the capture never drives, which
      // no amount of extra bands would reach.
      const candidates = [...fromAudit, ...fromLint]
      const belowCapture = candidates.filter(c => place(c) === 'below').length
      const inPanel = candidates.filter(c => place(c) === 'panel').length
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
          inPanel,
        }
      }
      // Outside the branch above on purpose: when nothing could be located,
      // the reason is exactly what the reader needs. It used to be discarded
      // here, so an app shell — whose findings all sit below a capture that
      // is one screen — produced no located section and said nothing at all.
      warnings.push(...full.warnings.map(w => `full page: ${w}`))
      if (featured.length === 0 && belowCapture + inPanel > 0) {
        const where =
          inPanel === 0
            ? 'lie below what the full-page capture could reach'
            : belowCapture === 0
              ? 'sit inside a panel with its own scrollbar, which a capture of the page never shows'
              : `lie below what the full-page capture could reach (${belowCapture}) or inside a panel with its own scrollbar (${inPanel})`
        const n = belowCapture + inPanel
        warnings.push(
          `the ${n} finding${n === 1 ? '' : 's'} worth featuring all ${where}, so this screen has no ` +
            `"where the problems are" section; the findings themselves are listed above`,
        )
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
      ...(r.walked !== undefined ? { walked: r.walked } : {}),
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
      ...(s.walked !== undefined ? { walked: s.walked } : {}),
      audit: s.audit ? { summary: s.audit.summary, findings: s.audit.findings.length, groups: s.audit.groups.length, truncated: s.audit.truncated.findings } : null,
      lint: s.lint ? { summary: s.lint.summary, findings: s.lint.findings.length, groups: s.lint.groups.length, skipped: s.lint.skipped } : null,
      diff: s.diff
        ? { settled: s.diff.metrics.settled, inkCoverage: s.diff.metrics.inkCoverage, rows: s.diff.metrics.rows, findings: s.diff.metrics.findings }
        : null,
      diffSkipped: s.diffSkipped,
      ...(s.problems
        ? { problems: { featured: s.problems.features.length, belowCapture: s.problems.belowCapture, inPanel: s.problems.inPanel } }
        : {}),
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
