import { PANEL_PROFILES, SCREEN_PRESETS } from '../shared/presets'
import { THROTTLE_PROFILES } from '../shared/throttle'
import type { Orientation } from '../shared/types'

/**
 * Pure helpers for the MCP server (`src/mcp/server.ts`): tool-input → CLI
 * argv mapping, inline-image size gating, and the presets/profiles catalog.
 * No SDK, no child processes, no I/O — everything here runs under plain node
 * and is unit-tested in tests/unit/mcpLib.test.ts.
 */

/** A caller mistake (bad flag combination), as opposed to a render failure. */
export class UsageError extends Error {}

/** Inline-image budget: 1.5 MiB of PNG before we fall back to the file path. */
export const MAX_INLINE_IMAGE_BYTES = 1_572_864

/** How much CLI stderr a tool error carries back to the model. */
export const STDERR_TAIL_CHARS = 2000

export interface SnapToolInput {
  url: string
  preset?: string | undefined
  /** Rotates whatever screen the run resolves — preset or custom dims alike. */
  orientation?: Orientation | undefined
  width?: number | undefined
  height?: number | undefined
  deviceScaleFactor?: number | undefined
  diagonalInches?: number | undefined
  /** Browser zoom as reflow, 1 = none (`--text-scale`). */
  textScale?: number | undefined
  /** Network and CPU conditions (`--throttle`); see the catalog's `throttles`. */
  throttle?: string | undefined
  profile?: string | undefined
  fullPage?: boolean | undefined
  /** Accepted and ignored: banding is what fullPage does now. */
  tiled?: boolean | undefined
  /** With fullPage: one viewport as tall as the page, instead of bands. */
  singleSurface?: boolean | undefined
  keepStuckChrome?: boolean | undefined
  waitMs?: number | undefined
  timeoutMs?: number | undefined
  /** Live mode only: capture the whole app window (default) or just the target pane. */
  capture?: 'window' | 'pane' | 'raster' | undefined
}

export interface DiffToolInput {
  url: string
  preset?: string | undefined
  profile?: string | undefined
  waitMs?: number | undefined
  timeoutMs?: number | undefined
  throttle?: string | undefined
}

export interface AuditToolInput {
  url: string
  preset?: string | undefined
  orientation?: Orientation | undefined
  width?: number | undefined
  height?: number | undefined
  deviceScaleFactor?: number | undefined
  diagonalInches?: number | undefined
  textScale?: number | undefined
  /** Network and CPU conditions (`--throttle`); see the catalog's `throttles`. */
  throttle?: string | undefined
  tapMm?: number | undefined
  textMm?: number | undefined
  waitMs?: number | undefined
  timeoutMs?: number | undefined
}

export interface LintToolInput {
  url: string
  preset?: string | undefined
  orientation?: Orientation | undefined
  width?: number | undefined
  height?: number | undefined
  deviceScaleFactor?: number | undefined
  diagonalInches?: number | undefined
  textScale?: number | undefined
  throttle?: string | undefined
  /** The panel the contrast-on-panel rule is judged on. */
  profile?: string | undefined
  thinPx?: number | undefined
  waitMs?: number | undefined
  timeoutMs?: number | undefined
}

export interface InspectToolInput {
  /** Headless: required. Live: navigates the app there first when given. */
  url?: string | undefined
  /** A point in CSS px of the target screen; exactly one of `at` / `selector`. */
  at?: { x: number; y: number } | undefined
  selector?: string | undefined
  preset?: string | undefined
  orientation?: Orientation | undefined
  width?: number | undefined
  height?: number | undefined
  deviceScaleFactor?: number | undefined
  diagonalInches?: number | undefined
  textScale?: number | undefined
  throttle?: string | undefined
  profile?: string | undefined
  waitMs?: number | undefined
  timeoutMs?: number | undefined
}

export interface ReportToolInput {
  url: string
  /** Preset ids; the CLI's default matrix when omitted. */
  presets?: string[] | undefined
  orientation?: Orientation | undefined
  textScale?: number | undefined
  /** Network and CPU conditions (`--throttle`); see the catalog's `throttles`. */
  throttle?: string | undefined
  profile?: string | undefined
  tapMm?: number | undefined
  textMm?: number | undefined
  waitMs?: number | undefined
  timeoutMs?: number | undefined
}

/** Exactly one of `at` / `selector`; the message names both. */
export function inspectWhereError(input: Pick<InspectToolInput, 'at' | 'selector'>): string | null {
  const hasAt = input.at !== undefined
  const hasSelector = input.selector !== undefined && input.selector.trim().length > 0
  if (hasAt === hasSelector) return 'obsrv_inspect needs exactly one of `at` ({ x, y } in CSS px of the target screen) or `selector` (a CSS selector; its first match).'
  return null
}

/** Maps `obsrv_inspect` input to `obsrv inspect` argv (headless). Needs a url. */
export function buildInspectArgs(input: InspectToolInput): string[] {
  if (input.url === undefined || input.url.trim().length === 0) {
    throw new UsageError('headless obsrv_inspect needs `url`; without one it can only inspect a running Obsrv with agent control on (mode: live).')
  }
  const where = inspectWhereError(input)
  if (where) throw new UsageError(where)
  const custom =
    input.width !== undefined ||
    input.height !== undefined ||
    input.deviceScaleFactor !== undefined ||
    input.diagonalInches !== undefined
  if (input.preset !== undefined && custom) {
    throw new UsageError('`preset` and custom dimensions are mutually exclusive — pass either `preset`, or `width` + `height`.')
  }
  if (custom && (input.width === undefined || input.height === undefined)) {
    throw new UsageError('custom dimensions need both `width` and `height` — or pass `preset` instead.')
  }
  const args = ['inspect', input.url.trim()]
  if (input.at !== undefined) args.push('--at', `${input.at.x},${input.at.y}`)
  else args.push('--selector', input.selector!.trim())
  if (input.preset !== undefined) args.push('--preset', input.preset)
  if (input.orientation !== undefined) args.push('--orientation', input.orientation)
  if (custom) {
    args.push('--width', String(input.width), '--height', String(input.height))
    if (input.deviceScaleFactor !== undefined) args.push('--dsf', String(input.deviceScaleFactor))
    if (input.diagonalInches !== undefined) args.push('--diagonal', String(input.diagonalInches))
  }
  if (input.textScale !== undefined) args.push('--text-scale', String(input.textScale))
  if (input.throttle !== undefined) args.push('--throttle', input.throttle)
  if (input.profile !== undefined) args.push('--profile', input.profile)
  if (input.waitMs !== undefined) args.push('--wait', String(input.waitMs))
  if (input.timeoutMs !== undefined) args.push('--timeout', String(input.timeoutMs))
  return args
}

/** Maps `obsrv_report` input to CLI argv; the HTML always lands at `outPath`. */
export function buildReportArgs(input: ReportToolInput, outPath: string): string[] {
  const args = ['report', input.url]
  if (input.presets !== undefined) {
    if (input.presets.length === 0) throw new UsageError('`presets` must name at least one preset id, or be omitted for the default matrix.')
    args.push('--matrix', input.presets.join(','))
  }
  if (input.orientation !== undefined) args.push('--orientation', input.orientation)
  if (input.textScale !== undefined) args.push('--text-scale', String(input.textScale))
  if (input.throttle !== undefined) args.push('--throttle', input.throttle)
  if (input.profile !== undefined) args.push('--profile', input.profile)
  if (input.tapMm !== undefined) args.push('--tap-mm', String(input.tapMm))
  if (input.textMm !== undefined) args.push('--text-mm', String(input.textMm))
  if (input.waitMs !== undefined) args.push('--wait', String(input.waitMs))
  if (input.timeoutMs !== undefined) args.push('--timeout', String(input.timeoutMs))
  args.push('--out', outPath)
  return args
}

/** Maps `obsrv_audit` input to CLI argv; the preset-XOR-custom rule is snap's. */
export function buildLintArgs(input: LintToolInput): string[] {
  const custom =
    input.width !== undefined ||
    input.height !== undefined ||
    input.deviceScaleFactor !== undefined ||
    input.diagonalInches !== undefined
  if (input.preset !== undefined && custom) {
    throw new UsageError(
      '`preset` and custom dimensions are mutually exclusive — pass either `preset`, or `width` + `height`. Use obsrv_presets to list the preset ids.',
    )
  }
  if (custom && (input.width === undefined || input.height === undefined)) {
    throw new UsageError('custom dimensions need both `width` and `height` — or pass `preset` instead.')
  }
  const args = ['lint', input.url]
  if (input.preset !== undefined) args.push('--preset', input.preset)
  if (input.orientation !== undefined) args.push('--orientation', input.orientation)
  if (custom) {
    args.push('--width', String(input.width), '--height', String(input.height))
    if (input.deviceScaleFactor !== undefined) args.push('--dsf', String(input.deviceScaleFactor))
    if (input.diagonalInches !== undefined) args.push('--diagonal', String(input.diagonalInches))
  }
  if (input.textScale !== undefined) args.push('--text-scale', String(input.textScale))
  if (input.throttle !== undefined) args.push('--throttle', input.throttle)
  if (input.profile !== undefined) args.push('--profile', input.profile)
  if (input.thinPx !== undefined) args.push('--thin-px', String(input.thinPx))
  if (input.waitMs !== undefined) args.push('--wait', String(input.waitMs))
  if (input.timeoutMs !== undefined) args.push('--timeout', String(input.timeoutMs))
  return args
}

export function buildAuditArgs(input: AuditToolInput): string[] {
  const custom =
    input.width !== undefined ||
    input.height !== undefined ||
    input.deviceScaleFactor !== undefined ||
    input.diagonalInches !== undefined
  if (input.preset !== undefined && custom) {
    throw new UsageError(
      '`preset` and custom dimensions are mutually exclusive — pass either `preset`, ' +
        'or `width` + `height` (with `diagonalInches`, without which there are no millimetres). ' +
        'Use obsrv_presets to list the preset ids.',
    )
  }
  if (custom && (input.width === undefined || input.height === undefined)) {
    throw new UsageError('custom dimensions need both `width` and `height` — or pass `preset` instead.')
  }
  const args = ['audit', input.url]
  if (input.preset !== undefined) args.push('--preset', input.preset)
  if (input.orientation !== undefined) args.push('--orientation', input.orientation)
  if (custom) {
    args.push('--width', String(input.width), '--height', String(input.height))
    if (input.deviceScaleFactor !== undefined) args.push('--dsf', String(input.deviceScaleFactor))
    if (input.diagonalInches !== undefined) args.push('--diagonal', String(input.diagonalInches))
  }
  if (input.textScale !== undefined) args.push('--text-scale', String(input.textScale))
  if (input.throttle !== undefined) args.push('--throttle', input.throttle)
  if (input.tapMm !== undefined) args.push('--tap-mm', String(input.tapMm))
  if (input.textMm !== undefined) args.push('--text-mm', String(input.textMm))
  if (input.waitMs !== undefined) args.push('--wait', String(input.waitMs))
  if (input.timeoutMs !== undefined) args.push('--timeout', String(input.timeoutMs))
  return args
}

/**
 * Maps `obsrv_snap` input to `bin/obsrv.js` argv. Enforces the preset-XOR-
 * custom-dims rule up front so the model gets one actionable message instead
 * of the CLI's exit-2 round trip.
 */
export function buildSnapArgs(input: SnapToolInput, outPath: string): string[] {
  const custom =
    input.width !== undefined ||
    input.height !== undefined ||
    input.deviceScaleFactor !== undefined ||
    input.diagonalInches !== undefined
  if (input.preset !== undefined && custom) {
    throw new UsageError(
      '`preset` and custom dimensions are mutually exclusive — pass either `preset`, ' +
        'or `width` + `height` (with optional `deviceScaleFactor` / `diagonalInches`). ' +
        'Use obsrv_presets to list the preset ids.',
    )
  }
  if (custom && (input.width === undefined || input.height === undefined)) {
    throw new UsageError(
      'custom dimensions need both `width` and `height` (`deviceScaleFactor` and ' +
        '`diagonalInches` only refine them) — or pass `preset` instead.',
    )
  }

  const args = ['snap', input.url]
  if (input.preset !== undefined) args.push('--preset', input.preset)
  if (input.orientation !== undefined) args.push('--orientation', input.orientation)
  if (custom) {
    args.push('--width', String(input.width), '--height', String(input.height))
    if (input.deviceScaleFactor !== undefined) args.push('--dsf', String(input.deviceScaleFactor))
    if (input.diagonalInches !== undefined) args.push('--diagonal', String(input.diagonalInches))
  }
  if (input.textScale !== undefined) args.push('--text-scale', String(input.textScale))
  if (input.throttle !== undefined) args.push('--throttle', input.throttle)
  if (input.profile !== undefined) args.push('--profile', input.profile)
  if (input.tiled && !input.fullPage) throw new UsageError('`tiled` goes with `fullPage` (and is now its default, so it does nothing).')
  if (input.singleSurface && !input.fullPage) throw new UsageError('`singleSurface` goes with `fullPage`: it is how the whole page is captured.')
  if (input.keepStuckChrome && !input.fullPage)
    throw new UsageError('`keepStuckChrome` goes with `fullPage`: only a banded capture hides anything.')
  if (input.fullPage) args.push('--full-page')
  if (input.singleSurface) args.push('--single-surface')
  if (input.keepStuckChrome) args.push('--keep-stuck-chrome')
  if (input.waitMs !== undefined) args.push('--wait', String(input.waitMs))
  if (input.timeoutMs !== undefined) args.push('--timeout', String(input.timeoutMs))
  args.push('--out', outPath)
  return args
}

/** Maps `obsrv_diff` input to CLI argv; target/reference PNGs always land in `outDir`. */
export function buildDiffArgs(input: DiffToolInput, outDir: string): string[] {
  const args = ['diff', input.url]
  if (input.preset !== undefined) args.push('--preset', input.preset)
  if (input.profile !== undefined) args.push('--profile', input.profile)
  if (input.throttle !== undefined) args.push('--throttle', input.throttle)
  if (input.waitMs !== undefined) args.push('--wait', String(input.waitMs))
  if (input.timeoutMs !== undefined) args.push('--timeout', String(input.timeoutMs))
  args.push('--out-dir', outDir)
  return args
}

/** Whether a PNG of this size goes into the response as an inline image block. */
export function shouldInlineImage(byteLength: number): boolean {
  return byteLength <= MAX_INLINE_IMAGE_BYTES
}

/**
 * Outer kill budget for one CLI invocation: the CLI polices each render with
 * its own --timeout, so the server only guards against a wedged Electron —
 * (per-render budget + settle wait) × renders, plus boot/encode headroom.
 * --wait counts per render (a diff waits in both the target and reference
 * renders), so a healthy long-wait run is never killed mid-flight.
 */
export function killBudgetMs(renders: number, timeoutMs: number, waitMs: number = 0): number {
  return renders * (timeoutMs + waitMs) + 60_000
}

/** The tail of the CLI's stderr, trimmed and capped for a tool-error message. */
export function stderrTail(stderr: string, max: number = STDERR_TAIL_CHARS): string {
  const trimmed = stderr.trim()
  return trimmed.length <= max ? trimmed : `…${trimmed.slice(-max)}`
}

// The scheme allowlist lives in shared/url.ts so the agent-control server
// applies the identical check; re-exported so existing importers (and their
// unit tests) keep their path.
export { ALLOWED_URL_SCHEMES, urlSchemeError } from '../shared/url'

// --- live drive --------------------------------------------------------------

export type SnapMode = 'auto' | 'headless' | 'live'

/** Why a call went headless. Named in every result so an agent can say so. */
export type HeadlessWhy = 'requested' | 'headless-only' | 'no-display' | 'declined' | 'launch-timeout'

export interface LivePlan {
  path: 'live'
  /** Inputs that are ignored on the live path, one note each. */
  notes: string[]
}
export interface HeadlessPlan {
  path: 'headless'
  why: HeadlessWhy
  notes: string[]
}

/** How long a launched app gets to come up before the call goes headless. */
export const LAUNCH_TIMEOUT_MS = 12_000

export const DECLINED_NOTE =
  'the user turned agent control off in Obsrv, so this ran headlessly; ask them to enable it (the AGENT chip or Settings → Agent control) if you need the live app.'

export const PANE_CAPTURE_HEADLESS_NOTE =
  "capture: 'pane' applies to live mode only; the headless render is the page raster itself, so the option was ignored."

/**
 * Whether a launch attempt could ever put a window on screen. This gates
 * *launching* an app that is not already running — never driving one that
 * is already up and reachable. A launch where no window could appear would
 * hang on a missing display and burn the whole timeout to learn nothing.
 * `OBSRV_TEST=1` belongs here for a second, independent reason: under the
 * e2e harness the MCP must never launch a real Obsrv against the
 * developer's own profile, even on a machine where a window could
 * technically appear.
 *
 * Consulted only by `ensureLive` (Task 5), and only on the branch where it
 * is about to launch — never by `planLive`, which must not refuse an
 * already-reachable, already-visible app just because the calling shell
 * happens to be over SSH or running under the test harness.
 */
export function cannotLaunchReason(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | null {
  if (env.OBSRV_TEST === '1') return 'OBSRV_TEST=1 is set (the e2e harness must never launch a real Obsrv)'
  if (env.SSH_CONNECTION !== undefined && env.SSH_CONNECTION !== '') return 'this is an SSH session'
  if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) return 'neither DISPLAY nor WAYLAND_DISPLAY is set'
  return null
}

/**
 * The reasons not to try the live path that are knowable up front, checked
 * in order: an explicit request for headless, an operation that cannot be
 * done live at all, and `OBSRV_HEADLESS=1` — the user's own "never touch
 * the app" opt-out, which must win before anything discovers whether the
 * app is reachable. `HeadlessWhy` has five members in total; `declined` and
 * `launch-timeout` are runtime outcomes only `ensureLive` can produce, once
 * it has actually tried to reach or launch the app, so this pure function
 * never returns them. Conditions that only say "a window cannot be
 * *launched* here" (SSH, no DISPLAY/WAYLAND_DISPLAY, OBSRV_TEST) live in
 * `cannotLaunchReason` instead, so they never block driving an app that is
 * already open and reachable.
 */
export function planLive(
  mode: SnapMode,
  headlessOnly: string[],
  liveNotes: string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): LivePlan | HeadlessPlan {
  if (mode === 'headless') return { path: 'headless', why: 'requested', notes: [] }
  if (headlessOnly.length > 0) return { path: 'headless', why: 'headless-only', notes: headlessOnly }
  if (env.OBSRV_HEADLESS === '1') {
    return { path: 'headless', why: 'no-display', notes: ['no display: OBSRV_HEADLESS=1 is set; rendered headlessly.'] }
  }
  return { path: 'live', notes: liveNotes }
}

/**
 * Decides whether an `obsrv_snap` call drives the visible app or renders
 * headlessly (spec §14 "Live drive"). Pure — it does not know whether an app
 * is actually reachable; the caller reconciles `path: 'live'` against that.
 * Documented calls, exercised in tests/unit/mcpLib.test.ts:
 *
 * - custom dims (width/height/dsf/diagonal) always render headlessly — the
 *   live path drives the app's preset table only — with a note, even under
 *   an explicit `mode: 'live'`.
 * - `fullPage` always renders headlessly (the visible window cannot show a
 *   full page), with a note.
 * - `waitMs` is honoured headlessly; on the live path it is ignored with a
 *   note (the live capture settles on the app's own committed navigation).
 * - `capture: 'pane'` shapes the live capture only; any headless outcome
 *   notes that it was ignored.
 */
export function planSnapPath(
  input: Pick<SnapToolInput, 'width' | 'height' | 'deviceScaleFactor' | 'diagonalInches' | 'fullPage' | 'waitMs' | 'capture'>,
  mode: SnapMode,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): LivePlan | HeadlessPlan {
  const headlessOnly: string[] = []
  const custom =
    input.width !== undefined ||
    input.height !== undefined ||
    input.deviceScaleFactor !== undefined ||
    input.diagonalInches !== undefined
  if (custom) headlessOnly.push('custom dimensions are headless-only (live mode drives the preset table); rendered headlessly.')
  if (input.fullPage) headlessOnly.push('fullPage is headless-only; rendered headlessly instead of driving the app.')
  const liveNotes = input.waitMs !== undefined ? ['waitMs is headless-only and was ignored in live mode.'] : []
  const plan = planLive(mode, headlessOnly, liveNotes, env, platform)
  if (plan.path === 'headless' && input.capture === 'pane') plan.notes.push(PANE_CAPTURE_HEADLESS_NOTE)
  return plan
}

/**
 * Parses the CLI's machine output: the trailing JSON object on stdout.
 * Tolerant of stray runtime noise ahead of it (e.g. Chromium warnings that
 * escape onto stdout) by scanning line-start `{` candidates until one parses
 * to the end.
 */
export function extractTrailingJson(stdout: string): Record<string, unknown> | null {
  const text = stdout.trim()
  for (let i = text.indexOf('{'); i >= 0; i = text.indexOf('{', i + 1)) {
    if (i > 0 && text[i - 1] !== '\n') continue
    try {
      const parsed: unknown = JSON.parse(text.slice(i))
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // Not JSON from here; keep scanning.
    }
  }
  return null
}

export interface PresetEntry {
  id: string
  label: string
  group: string
  cssWidth: number
  cssHeight: number
  deviceScaleFactor: number
  diagonalInches: number
  /** Physical pixel density of the simulated panel (device px per inch). */
  ppi: number
}

/**
 * What `obsrv_presets` says about rotation. Stated once here rather than
 * repeated per entry: it is true of every preset in the table, and a field
 * saying "rotatable: true" fourteen times would carry less than one sentence.
 */
export const ORIENTATION_NOTE =
  'cssWidth/cssHeight are each preset\'s natural orientation — portrait for every mobile preset, ' +
  'landscape for the monitor and laptop ones. Every preset rotates: pass orientation: "landscape" ' +
  'to obsrv_snap or obsrv_drive to swap the two axes a quarter turn. Rotation changes nothing else — ' +
  'the diagonal, deviceScaleFactor, ppi and physical size are all orientation-independent, so a ' +
  'rotated screen is the same panel turned sideways rather than a different one.'

export interface ProfileEntry {
  id: string
  label: string
  contrastRatio: number | null
  gamutCoverage: number
  bits: number
  frc: boolean
  nits: number | null
  /** One-line human description of what the profile simulates. */
  summary: string
}

export interface ThrottleEntry {
  id: string
  label: string
  network: { downloadBps: number; uploadBps: number; latencyMs: number } | null
  cpuRate: number
  summary: string
}

export interface Catalog {
  presets: PresetEntry[]
  profiles: ProfileEntry[]
  /** The `throttle` values snap, diff, audit and report take: DevTools' presets. */
  throttles: ThrottleEntry[]
  /** See ORIENTATION_NOTE — how the dimensions above relate to rotation. */
  orientation: string
}

/** The `obsrv_presets` payload, straight from src/shared/presets.ts — no spawn. */
export function listCatalog(): Catalog {
  return {
    orientation: ORIENTATION_NOTE,
    throttles: THROTTLE_PROFILES.map(t => ({ id: t.id, label: t.label, network: t.network, cpuRate: t.cpuRate, summary: t.summary })),
    presets: SCREEN_PRESETS.map(p => ({
      id: p.id,
      label: p.label,
      group: p.group,
      cssWidth: p.width,
      cssHeight: p.height,
      deviceScaleFactor: p.deviceScaleFactor,
      diagonalInches: p.diagonalInches,
      ppi: Math.round(
        Math.hypot(p.width * p.deviceScaleFactor, p.height * p.deviceScaleFactor) / p.diagonalInches,
      ),
    })),
    profiles: PANEL_PROFILES.map(p => ({
      id: p.id,
      label: p.label,
      contrastRatio: p.contrastRatio,
      gamutCoverage: p.gamutCoverage,
      bits: p.bits,
      frc: p.frc,
      nits: p.nits,
      summary:
        p.contrastRatio === null
          ? 'no panel simulation (pass-through)'
          : `contrast ${p.contrastRatio}:1, ${Math.round(p.gamutCoverage * 100)}% sRGB, ` +
            `${p.bits}-bit${p.frc ? '+FRC' : ''}, ${p.nits} nits`,
    })),
  }
}
