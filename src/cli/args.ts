import { maxCssViewport } from '../shared/calibration'
import { MAX_SELECTOR_LENGTH } from '../shared/inspect'
import { isThrottleId, THROTTLE_IDS, THROTTLE_PROFILES } from '../shared/throttle'
import { DEFAULT_TEXT_SCALE, MAX_TEXT_SCALE, MIN_TEXT_SCALE } from '../shared/textScale'
import { DEFAULT_ORIENTATION, isOrientation, PANEL_PROFILES, SCREEN_PRESETS, findPreset, findProfile } from '../shared/presets'
import type { Orientation } from '../shared/types'

/**
 * Pure argv parsing for the headless CLI (`bin/obsrv.js` → `out/main/cli.js`).
 * No Electron imports: everything here is unit-testable under plain node.
 */

export class ArgError extends Error {}

export interface RenderSpec {
  /** Preset id, or `custom` for --width/--height runs. */
  presetId: string
  cssWidth: number
  cssHeight: number
  deviceScaleFactor: number
  diagonalInches: number | null
  /**
   * The rotation flag this spec was resolved with. Carried per spec rather
   * than per command because `--matrix` renders several presets in one run and
   * each reports its own shape — and for landscape-natural presets the flag
   * and the shape differ, so the reader needs both.
   */
  orientation: Orientation
  /**
   * Phone fidelity: mobile user agent and viewport semantics, as the app
   * gives its mobile presets. From the preset's group; custom dimensions are
   * a desktop window. Density says nothing about this — a Retina laptop is
   * dense and a desktop — so it is carried, not inferred from `deviceScaleFactor`.
   */
  mobile: boolean
  /**
   * Browser zoom as reflow, 1 = none: the page lays out in `cssWidth /
   * textScale` CSS px of its own at `deviceScaleFactor × textScale`. The
   * fields above describe the surface — the PNG is still `cssWidth ×
   * deviceScaleFactor` wide — and this says what the page saw of it.
   */
  textScale: number
  /**
   * Network and CPU conditions for the render (see shared/throttle.ts).
   * Null when `--throttle` was not given at all, which is what keeps the
   * flagless JSON the contract it always was: the `throttle` and
   * `settledMs` keys appear only when the flag was — `--throttle none`
   * included, so a baseline can be asked for by name.
   */
  throttle: string | null
}

export interface AuditCommand {
  command: 'audit'
  url: string
  spec: RenderSpec
  /** Findings thresholds, in millimetres on the target screen. */
  tapMm: number
  textMm: number
  waitMs: number
  timeoutMs: number
}

export interface InspectCommand {
  command: 'inspect'
  url: string
  spec: RenderSpec
  /** The panel the second contrast figure is measured on. */
  profileId: string
  /** Exactly one of the two: a point in CSS px of the target screen, or a CSS selector (first match). */
  at: { x: number; y: number } | null
  selector: string | null
  waitMs: number
  timeoutMs: number
}

export interface ReportCommand {
  command: 'report'
  url: string
  /** One per screen; the default matrix when none was named. */
  specs: RenderSpec[]
  profileId: string
  /** The HTML file. */
  out: string
  tapMm: number
  textMm: number
  waitMs: number
  timeoutMs: number
}

export interface SnapCommand {
  command: 'snap'
  url: string
  /** One per render; more than one only under --matrix. */
  specs: RenderSpec[]
  profileId: string
  /** Output file — or, under --matrix, a directory or a `{preset}` pattern. */
  out: string
  matrix: boolean
  fullPage: boolean
  waitMs: number
  timeoutMs: number
}

export interface DiffCommand {
  command: 'diff'
  url: string
  spec: RenderSpec
  profileId: string
  outDir: string | null
  waitMs: number
  timeoutMs: number
}

export interface HelpCommand {
  command: 'help'
  text: string
}

export type CliCommand = SnapCommand | DiffCommand | AuditCommand | ReportCommand | InspectCommand | HelpCommand

/** The screens a report covers when none are named: two laptops-and-desktops, two phones. */
export const DEFAULT_REPORT_MATRIX = ['laptop-768', '1080p-24', 'android-65', 'iphone-61'] as const
export const DEFAULT_REPORT_OUT = 'obsrv-report.html'

export const DEFAULT_PRESET = '1080p-24'
export const DEFAULT_TIMEOUT_MS = 30_000
/** Provisional, and stated in every audit's output; see `cli/audit.ts`. */
export const DEFAULT_TAP_MM = 7
export const DEFAULT_TEXT_MM = 2

export function usage(): string {
  const presets = SCREEN_PRESETS.map(p => `      ${p.id.padEnd(14)} ${p.label}`).join('\n')
  const profiles = PANEL_PROFILES.map(p => p.id).join(' | ')
  return `obsrv — see your site the way 1x screens see it (headless CLI)

Usage:
  obsrv snap <url> [flags]   Render <url> on a target screen; write a PNG, print JSON.
  obsrv diff <url> [flags]   Render <url> at 1x and against a 2x reference; print JSON metrics.
  obsrv audit <url> [flags]  Measure tap targets and text on a target screen, in millimetres; print JSON findings.
  obsrv report <url> [flags] Render, audit and (for 1x screens) diff a matrix of screens into one HTML page.
  obsrv inspect <url> [flags] What is under a point, or what a selector names: font in millimetres, colours,
                             contrast as stated and on the panel; print JSON.
  obsrv mcp                  Serve the MCP server on stdio (for Claude Code and other clients).
  obsrv install-skill        Install the obsrv-screens skill for Claude Code (--help for flags).

Shared flags:
  --preset <id>        Screen preset (default ${DEFAULT_PRESET}):
${presets}
  --width <px> --height <px> [--dsf <factor>] [--diagonal <inches>]
                       Custom CSS viewport instead of --preset (dsf defaults to 1).
  --orientation <o>    portrait | landscape (default ${DEFAULT_ORIENTATION}). This names the
                       preset's *stored* orientation, not the shape you get:
                         portrait  = the preset exactly as the table above lists it
                         landscape = that rotated a quarter turn (width and height swap)
                       Every mobile preset is stored portrait, so for those the two
                       readings agree. The laptop and desktop presets are stored
                       landscape-natural, so --orientation landscape turns them into a
                       portrait screen — which is how you render a 1080p monitor stood on
                       end (1080p-24 becomes 1080x1920). Applies to custom --width/--height
                       dims too. The diagonal, raster density and physical size never
                       change: it is the same panel turned sideways. Each render's JSON
                       and log line name the resulting shape.
  --text-scale <f>     Browser zoom as reflow, e.g. 1.5 for a user at 150% (default 1;
                       ${MIN_TEXT_SCALE} to ${MAX_TEXT_SCALE}). The page lays out in 1/f of the screen's CSS
                       viewport at f times its density — what a larger-text setting or a
                       Windows panel at 150% does to a layout — and the PNG stays the
                       screen's size. The audit's millimetres grow with it.
  --throttle <id>      Network and CPU conditions, as Chrome DevTools presets them:
${THROTTLE_PROFILES.map(t => `                         ${t.id.padEnd(13)} ${t.summary}`).join('\n')}
                       Given, the JSON carries \`throttle\` and, for snap and report,
                       \`settledMs\`: the time from navigation to the page going paint-quiet
                       (a baseline: --throttle none). Absent, the JSON is unchanged.
  --profile <id>       Panel profile: ${profiles} (default reference).
  --wait <ms>          Extra settle time after load (default 0).
  --timeout <ms>       Per-render budget for load + paint quiescence (default ${DEFAULT_TIMEOUT_MS}).

snap flags:
  --out <file>         Output PNG (default ./obsrv-<preset>.png). Under --matrix: an
                       output directory, or a pattern containing {preset}.
  --full-page          Capture the full page height (device pixels capped at 4096).
  --matrix <id,id,…>   Render each listed preset in one run.

diff flags:
  --out-dir <dir>      Also write target.png and reference.png.
  --json               JSON metrics to stdout (already the default; accepted for clarity).

audit flags:
  --tap-mm <mm>        Flag interactive elements whose shorter side is under this (default ${DEFAULT_TAP_MM}).
  --text-mm <mm>       Flag text whose font size is under this (default ${DEFAULT_TEXT_MM}).
                       Both are provisional and stated in the output. Millimetres come from the
                       screen's diagonal, so custom dimensions need --diagonal to get any.
                       Measures layout, not pixels: --profile does not apply, and one preset per run.

inspect flags:
  --at <x,y>           A point in CSS px of the target screen: what is drawn there.
  --selector <css>     A CSS selector; its first match. Exactly one of --at / --selector.
                       --profile names the panel the second contrast figure is measured on;
                       the first is the pair as stated. WCAG AA is judged at 4.5:1, or 3:1 for
                       large text (24px, or 18.66px bold). Millimetres need the screen's diagonal.

report flags:
  --matrix <id,id,…>   Screens to cover (default ${DEFAULT_REPORT_MATRIX.join(',')}); or --preset for one.
  --out <file>         The HTML file (default ${DEFAULT_REPORT_OUT}). Self-contained: PNGs inline, no script.
  --tap-mm / --text-mm As for audit. --profile applies to the renders shown; the 1x-vs-2x
                       comparison is measured without it (it is about rasterisation, not the panel).
                       Each screen costs one render plus, for 1x screens, a 2x reference render.

Repeated flags: the last occurrence wins.
Machine output (JSON) goes to stdout; everything human goes to stderr.
Exit code 0 on success — diff findings are informational, never a failure.
snap's "settled" is true when the page went paint-quiet and every pixel
painted. False is a rescued capture, not a failure: a page that kept animating
(or whose repaint never completed) is written as-is, exit code 0, with a
warning naming what was missing. Only a render that painted nothing errors.`
}

/** Flags that take no value. */
const BOOLEAN_FLAGS = new Set(['full-page', 'json'])
/** Flags that consume the next token. */
const VALUE_FLAGS = new Set(['preset', 'profile', 'orientation', 'out', 'out-dir', 'wait', 'timeout', 'matrix', 'width', 'height', 'dsf', 'diagonal', 'tap-mm', 'text-mm', 'text-scale', 'throttle', 'at', 'selector'])
type Command = 'snap' | 'diff' | 'audit' | 'report' | 'inspect'
/** Flags every command takes. */
const SHARED_FLAGS = new Set(['preset', 'profile', 'orientation', 'wait', 'timeout', 'width', 'height', 'dsf', 'diagonal', 'text-scale', 'throttle'])
/**
 * The rest, per command. A flag outside a command's set is refused, and the
 * message names the first command (in this order) that takes it — so
 * `--out` given to diff is "a snap flag" even though report takes it too.
 */
const EXTRA_FLAGS: Record<Command, Set<string>> = {
  snap: new Set(['out', 'full-page', 'matrix']),
  diff: new Set(['out-dir', 'json']),
  audit: new Set(['tap-mm', 'text-mm']),
  report: new Set(['out', 'matrix', 'tap-mm', 'text-mm']),
  inspect: new Set(['at', 'selector']),
}

interface Parsed {
  url: string
  flags: Map<string, string | true>
}

function collect(command: Command, argv: string[]): Parsed {
  let url: string | null = null
  const flags = new Map<string, string | true>()
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!
    if (token.startsWith('--')) {
      const name = token.slice(2)
      if (BOOLEAN_FLAGS.has(name)) {
        flags.set(name, true)
      } else if (VALUE_FLAGS.has(name)) {
        const value = argv[++i]
        if (value === undefined || value.startsWith('--')) throw new ArgError(`--${name} requires a value`)
        flags.set(name, value)
      } else {
        throw new ArgError(`unknown flag: --${name}\n\n${usage()}`)
      }
    } else if (url === null) {
      url = token
    } else {
      throw new ArgError(`unexpected argument: ${token}`)
    }
  }
  if (url === null) throw new ArgError(`usage: obsrv ${command} <url> [flags] — run \`obsrv --help\` for the flag list`)
  const allowed = EXTRA_FLAGS[command]
  for (const name of flags.keys()) {
    if (SHARED_FLAGS.has(name) || allowed.has(name)) continue
    const owner = (Object.keys(EXTRA_FLAGS) as Command[]).find(c => EXTRA_FLAGS[c].has(name)) ?? command
    throw new ArgError(`--${name} is a${owner === 'audit' ? 'n' : ''} ${owner} flag; \`obsrv ${command}\` does not take it`)
  }
  // The audit measures layout, not pixels, so a panel profile would be a
  // flag that changed nothing — refused rather than silently ignored.
  if (command === 'audit' && flags.has('profile')) {
    throw new ArgError('--profile does not apply to `obsrv audit`: it measures layout in millimetres, not pixels')
  }
  return { url, flags }
}

function integer(flags: Map<string, string | true>, name: string, fallback: number, min: number): number {
  const raw = flags.get(name)
  if (raw === undefined) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new ArgError(`--${name}: expected a number, got "${String(raw)}"`)
  if (!Number.isInteger(n)) throw new ArgError(`--${name}: expected an integer, got "${String(raw)}"`)
  if (n < min) throw new ArgError(`--${name}: must be >= ${min}`)
  return n
}

function float(flags: Map<string, string | true>, name: string, fallback: number, min: number): number {
  const raw = flags.get(name)
  if (raw === undefined) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < min) throw new ArgError(`--${name}: expected a number >= ${min}, got "${String(raw)}"`)
  return n
}

function presetSpec(id: string): RenderSpec {
  let preset
  try {
    preset = findPreset(id)
  } catch {
    throw new ArgError(`unknown preset: ${id} (valid: ${SCREEN_PRESETS.map(p => p.id).join(', ')})`)
  }
  return {
    presetId: preset.id,
    cssWidth: preset.width,
    cssHeight: preset.height,
    deviceScaleFactor: preset.deviceScaleFactor,
    diagonalInches: preset.diagonalInches,
    orientation: DEFAULT_ORIENTATION,
    mobile: preset.group === 'mobile',
    textScale: DEFAULT_TEXT_SCALE,
    throttle: null,
  }
}

/** Null when the flag is absent (see `RenderSpec.throttle`); an unknown id names the valid ones. */
function resolveThrottle(flags: Map<string, string | true>): string | null {
  const raw = flags.get('throttle')
  if (raw === undefined) return null
  if (!isThrottleId(raw)) throw new ArgError(`--throttle: expected one of ${THROTTLE_IDS.join(', ')}, got "${String(raw)}"`)
  return raw
}

function resolveTextScale(flags: Map<string, string | true>): number {
  const scale = float(flags, 'text-scale', DEFAULT_TEXT_SCALE, MIN_TEXT_SCALE)
  if (scale > MAX_TEXT_SCALE) throw new ArgError(`--text-scale: expected a number <= ${MAX_TEXT_SCALE}, got "${scale}"`)
  return scale
}

function resolveOrientation(flags: Map<string, string | true>): Orientation {
  const raw = flags.get('orientation')
  if (raw === undefined) return DEFAULT_ORIENTATION
  if (!isOrientation(raw)) throw new ArgError(`--orientation: expected portrait or landscape, got "${String(raw)}"`)
  return raw
}

/**
 * Rotation swaps the CSS axes and nothing else — the diagonal and the raster
 * density are orientation-independent, so the render is the same screen turned
 * sideways rather than a different one. Applied here, before the diff bounds
 * are checked, so those check the viewport that will actually be rendered.
 */
function orientSpec(spec: RenderSpec, orientation: Orientation): RenderSpec {
  if (orientation !== 'landscape') return { ...spec, orientation }
  return { ...spec, orientation, cssWidth: spec.cssHeight, cssHeight: spec.cssWidth }
}

/**
 * The screens a run covers, each at the run's orientation and text scale.
 * The scale is applied last and to every spec alike: it changes nothing
 * about the screen — not its axes, its density or its diff bounds — only
 * what the page is told about it.
 */
function resolveSpecs(flags: Map<string, string | true>): { specs: RenderSpec[]; matrix: boolean } {
  const textScale = resolveTextScale(flags)
  const throttle = resolveThrottle(flags)
  const { specs, matrix } = resolveScreens(flags)
  return { specs: specs.map(s => ({ ...s, textScale, throttle })), matrix }
}

function resolveScreens(flags: Map<string, string | true>): { specs: RenderSpec[]; matrix: boolean } {
  const orientation = resolveOrientation(flags)
  const custom = ['width', 'height', 'dsf', 'diagonal'].some(f => flags.has(f))
  if (custom && flags.has('preset')) throw new ArgError('--preset and --width/--height are mutually exclusive')
  if (custom && flags.has('matrix')) throw new ArgError('--matrix lists presets; it cannot be combined with custom --width/--height dims')
  if (flags.has('matrix') && flags.has('preset')) throw new ArgError('--matrix already lists presets; drop --preset')

  if (custom) {
    if (!flags.has('width') || !flags.has('height')) {
      throw new ArgError('custom dims need both --width and --height (with optional --dsf and --diagonal)')
    }
    const cssWidth = integer(flags, 'width', 0, 1)
    const cssHeight = integer(flags, 'height', 0, 1)
    const deviceScaleFactor = float(flags, 'dsf', 1, 1)
    const max = maxCssViewport(deviceScaleFactor)
    if (cssWidth > max || cssHeight > max) {
      throw new ArgError(`viewport exceeds the 4096-device-pixel budget: at dsf ${deviceScaleFactor} the CSS limit is ${max}`)
    }
    const diagonal = flags.has('diagonal') ? float(flags, 'diagonal', 0, 0.1) : null
    const spec = {
      presetId: 'custom',
      cssWidth,
      cssHeight,
      deviceScaleFactor,
      diagonalInches: diagonal,
      orientation: DEFAULT_ORIENTATION,
      mobile: false,
      textScale: DEFAULT_TEXT_SCALE,
      throttle: null,
    }
    return { specs: [orientSpec(spec, orientation)], matrix: false }
  }

  const matrixRaw = flags.get('matrix')
  if (typeof matrixRaw === 'string') {
    const ids = matrixRaw.split(',').map(s => s.trim()).filter(s => s.length > 0)
    if (ids.length === 0) throw new ArgError('--matrix: expected a comma-separated list of preset ids')
    return { specs: ids.map(id => orientSpec(presetSpec(id), orientation)), matrix: true }
  }

  const id = typeof flags.get('preset') === 'string' ? (flags.get('preset') as string) : DEFAULT_PRESET
  return { specs: [orientSpec(presetSpec(id), orientation)], matrix: false }
}

function resolveProfile(flags: Map<string, string | true>): string {
  const raw = flags.get('profile')
  if (raw === undefined) return 'reference'
  try {
    return findProfile(raw as string).id
  } catch {
    throw new ArgError(`unknown profile: ${String(raw)} (valid: ${PANEL_PROFILES.map(p => p.id).join(', ')})`)
  }
}

export function parseArgs(argv: string[]): CliCommand {
  const [command, ...rest] = argv
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    return { command: 'help', text: usage() }
  }
  if (command !== 'snap' && command !== 'diff' && command !== 'audit' && command !== 'report' && command !== 'inspect') {
    throw new ArgError(`unknown command: ${command}\n\n${usage()}`)
  }

  const { url, flags } = collect(command, rest)
  const { specs, matrix } = resolveSpecs(flags)
  const profileId = resolveProfile(flags)
  const waitMs = integer(flags, 'wait', 0, 0)
  const timeoutMs = integer(flags, 'timeout', DEFAULT_TIMEOUT_MS, 1)

  if (command === 'snap') {
    const out = typeof flags.get('out') === 'string' ? (flags.get('out') as string) : matrix ? '.' : `obsrv-${specs[0]!.presetId}.png`
    return { command, url, specs, profileId, out, matrix, fullPage: flags.has('full-page'), waitMs, timeoutMs }
  }

  if (command === 'audit') {
    if (matrix) throw new ArgError('`obsrv audit` measures one screen per run; --matrix is a snap flag')
    const tapMm = float(flags, 'tap-mm', DEFAULT_TAP_MM, 0)
    const textMm = float(flags, 'text-mm', DEFAULT_TEXT_MM, 0)
    return { command, url, spec: specs[0]!, tapMm, textMm, waitMs, timeoutMs }
  }

  if (command === 'report') {
    // Nothing named means the default matrix, not the default preset.
    const named = flags.has('preset') || flags.has('matrix') || ['width', 'height', 'dsf', 'diagonal'].some(f => flags.has(f))
    const orientation = resolveOrientation(flags)
    const textScale = resolveTextScale(flags)
    const throttle = resolveThrottle(flags)
    const reportSpecs = named ? specs : DEFAULT_REPORT_MATRIX.map(id => ({ ...orientSpec(presetSpec(id), orientation), textScale, throttle }))
    const out = typeof flags.get('out') === 'string' ? (flags.get('out') as string) : DEFAULT_REPORT_OUT
    return {
      command,
      url,
      specs: reportSpecs,
      profileId,
      out,
      tapMm: float(flags, 'tap-mm', DEFAULT_TAP_MM, 0),
      textMm: float(flags, 'text-mm', DEFAULT_TEXT_MM, 0),
      waitMs,
      timeoutMs,
    }
  }

  if (command === 'inspect') {
    if (matrix) throw new ArgError('`obsrv inspect` looks at one screen per run; --matrix is a snap flag')
    const atRaw = flags.get('at')
    const selectorRaw = flags.get('selector')
    if ((atRaw === undefined) === (selectorRaw === undefined)) {
      throw new ArgError('inspect needs exactly one of --at <x,y> or --selector <css>')
    }
    let at: { x: number; y: number } | null = null
    if (atRaw !== undefined) {
      const m = /^\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*$/.exec(String(atRaw))
      if (!m) throw new ArgError(`--at: expected x,y in CSS px of the target screen, got "${String(atRaw)}"`)
      at = { x: Number(m[1]), y: Number(m[2]) }
    }
    const selector = selectorRaw === undefined ? null : String(selectorRaw).trim()
    if (selector !== null && (selector.length === 0 || selector.length > MAX_SELECTOR_LENGTH)) {
      throw new ArgError(`--selector: expected 1 to ${MAX_SELECTOR_LENGTH} characters`)
    }
    return { command, url, spec: specs[0]!, profileId, at, selector, waitMs, timeoutMs }
  }

  const spec = specs[0]!
  if (spec.deviceScaleFactor !== 1) {
    throw new ArgError(
      `diff compares the target against a 2x reference downsampled onto the target's 1x grid, ` +
        `so it only supports 1x targets in v1 — "${spec.presetId}" renders at ${spec.deviceScaleFactor}x. ` +
        `Use a 1x preset (e.g. laptop-768, 1080p-24) or plain \`obsrv snap\` for dense presets.`,
    )
  }
  const referenceMax = maxCssViewport(2)
  if (spec.cssWidth > referenceMax || spec.cssHeight > referenceMax) {
    // Named as rendered, not as stored: the dims here are post-rotation, and
    // attributing them to the bare preset id would print "1440p-27 is
    // 1440×2560" — a shape that id never has. The bound itself is per-axis
    // symmetric, so rotation can never sneak a too-large viewport past it;
    // this is the message telling the truth about which one it measured.
    const as = spec.orientation === 'landscape' ? ' rotated a quarter turn' : ''
    throw new ArgError(
      `diff renders a 2x reference, so the CSS viewport must fit ${referenceMax}px per axis ` +
        `(4096 device px at 2x) — "${spec.presetId}"${as} is ${spec.cssWidth}×${spec.cssHeight}. ` +
        `Use \`obsrv snap\` for this preset instead.`,
    )
  }
  const outDir = typeof flags.get('out-dir') === 'string' ? (flags.get('out-dir') as string) : null
  return { command, url, spec, profileId, outDir, waitMs, timeoutMs }
}
