import { PANEL_PROFILES, SCREEN_PRESETS } from '../shared/presets'

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
  width?: number | undefined
  height?: number | undefined
  deviceScaleFactor?: number | undefined
  diagonalInches?: number | undefined
  profile?: string | undefined
  fullPage?: boolean | undefined
  waitMs?: number | undefined
  timeoutMs?: number | undefined
  /** Live mode only: capture the whole app window (default) or just the target pane. */
  capture?: 'window' | 'pane' | undefined
}

export interface DiffToolInput {
  url: string
  preset?: string | undefined
  profile?: string | undefined
  waitMs?: number | undefined
  timeoutMs?: number | undefined
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
  if (custom) {
    args.push('--width', String(input.width), '--height', String(input.height))
    if (input.deviceScaleFactor !== undefined) args.push('--dsf', String(input.deviceScaleFactor))
    if (input.diagonalInches !== undefined) args.push('--diagonal', String(input.diagonalInches))
  }
  if (input.profile !== undefined) args.push('--profile', input.profile)
  if (input.fullPage) args.push('--full-page')
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

export interface SnapPathPlan {
  path: 'live' | 'headless'
  /** Human notes about inputs that changed the path or were ignored on it. */
  notes: string[]
}

export const APP_NOT_REACHABLE =
  'The Obsrv app is not reachable. Open the Obsrv desktop app and enable "Agent control" in the toolbar ' +
  '(or pass mode: "headless" to render without it).'

export const PANE_CAPTURE_HEADLESS_NOTE =
  "capture: 'pane' applies to live mode only; the headless render is the page raster itself, so the option was ignored."

/**
 * Decides whether an `obsrv_snap` call drives the visible app or renders
 * headlessly (spec §14 "Live drive"), given whether a control-enabled app
 * answered discovery. Documented calls, exercised in tests/unit/mcpLib.test.ts:
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
 * - `mode: 'live'` with no reachable app is an error, never a silent
 *   headless fallback — the caller asked to watch.
 */
export function planSnapPath(
  input: Pick<SnapToolInput, 'width' | 'height' | 'deviceScaleFactor' | 'diagonalInches' | 'fullPage' | 'waitMs' | 'capture'>,
  mode: SnapMode,
  liveReachable: boolean,
): SnapPathPlan | { error: string } {
  const paneNote = input.capture === 'pane' ? [PANE_CAPTURE_HEADLESS_NOTE] : []
  if (mode === 'headless') return { path: 'headless', notes: paneNote }
  if (!liveReachable) {
    if (mode === 'live') return { error: APP_NOT_REACHABLE }
    return { path: 'headless', notes: paneNote }
  }
  const notes: string[] = []
  const custom =
    input.width !== undefined ||
    input.height !== undefined ||
    input.deviceScaleFactor !== undefined ||
    input.diagonalInches !== undefined
  if (custom) notes.push('custom dimensions are headless-only (live mode drives the preset table); rendered headlessly.')
  if (input.fullPage) notes.push('fullPage is headless-only; rendered headlessly instead of driving the app.')
  if (notes.length > 0) return { path: 'headless', notes: [...notes, ...paneNote] }
  if (input.waitMs !== undefined) notes.push('waitMs is headless-only and was ignored in live mode.')
  return { path: 'live', notes }
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

export interface Catalog {
  presets: PresetEntry[]
  profiles: ProfileEntry[]
}

/** The `obsrv_presets` payload, straight from src/shared/presets.ts — no spawn. */
export function listCatalog(): Catalog {
  return {
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
