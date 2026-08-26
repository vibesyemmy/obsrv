import { createHash, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'
import { parseRect } from './ipcPayloads'
import { PANEL_PROFILES, SCREEN_PRESETS } from './presets'

/**
 * The agent-control protocol shared by the main-process control server
 * (`src/main/controlServer.ts`) and the MCP discovery client
 * (`src/mcp/control.ts`): discovery-file shape, token comparison, command
 * names and payload validation. Pure node — no Electron, no I/O — so
 * everything here runs under plain node and is unit-tested in
 * tests/unit/control.test.ts.
 *
 * Renderer code imports *types* from this module only; the `node:crypto`
 * import never reaches a browser bundle.
 *
 * Security decisions (spec §14 "Live drive"):
 * - The server binds 127.0.0.1 only, on an ephemeral port.
 * - Every command — `status` included — carries the bearer token from the
 *   discovery file. The file is mode 0600 in the app's own userData dir, so
 *   possession already proves "same user"; a token-free status would only
 *   leak app state to other local users for no benefit.
 * - No command accepts file paths, JavaScript, or IPC channel names; every
 *   payload is validated against the same tables the app itself uses.
 */

/** Discovery file the app writes to `app.getPath('userData')` while agent control is on. */
export const CONTROL_FILE_NAME = 'control.json'

/** Bearer-token entropy; hex-encoded in the discovery file (64 chars). */
export const CONTROL_TOKEN_BYTES = 32

const TOKEN_RE = /^[0-9a-f]{64}$/

export interface ControlInfo {
  port: number
  token: string
}

/** How the target pane shows the render — mirrors the renderer store's ViewMode. */
export type AgentViewMode = '1:1' | 'fit'

/** The renderer-owned UI state main mirrors for the control server's `status`. */
export interface AgentUiState {
  presetId: string
  profileId: string
  viewMode: AgentViewMode
  mode: 'url' | 'image'
}

/**
 * The `IPC.uiState` wire report: the UI mirror plus the target pane's
 * window-relative bounds in CSS pixels, which `captureTarget` crops the
 * window capture to. Null (or absent) before the pane has mounted — the
 * capture then falls back to the full window with a warning, never errors.
 */
export interface AgentUiReport extends AgentUiState {
  targetBounds?: { x: number; y: number; width: number; height: number } | null
  /**
   * Where the rendered screen itself sits, in the same window-relative CSS
   * pixels — the canvas rect clipped to the pane. `captureTarget` crops to
   * this rather than to the pane, so a minified mobile preset comes back
   * phone-sized instead of phone-sized inside a mostly-empty rectangle.
   */
  canvasBounds?: { x: number; y: number; width: number; height: number } | null
}

/** What `status` returns: the UI mirror plus app version and the target's URL. */
export interface ControlStatus extends AgentUiState {
  version: string
  url: string
}

/** A validated `highlight` payload: a target-pixel rect plus its lifetime. */
export interface AgentHighlight {
  x: number
  y: number
  width: number
  height: number
  durationMs: number
}

/** A validated `click` payload: CSS-pixel coordinates within the target viewport. */
export interface AgentClick {
  x: number
  y: number
  button: 'left' | 'middle' | 'right'
}

/**
 * What the renderer-applied commands forward over `IPC.agentApply`. Every
 * field is optional; the renderer applies exactly the ones present with its
 * own store actions (`setPreset`, `setPixelExact`, …) or pane maths
 * (`panTo`, `highlight`).
 */
export interface AgentApplyPatch {
  presetId?: string
  profileId?: string
  viewMode?: AgentViewMode
  pixelExact?: boolean
  /** Centre this target pixel in the pane's 1:1 view (fit jumps to 1:1 there). */
  panTo?: { x: number; y: number }
  /** Draw a temporary neutral overlay over this target-pixel rect. */
  highlight?: AgentHighlight
}

export const CONTROL_COMMANDS = [
  'status',
  'navigate',
  'setPreset',
  'setProfile',
  'setViewMode',
  'captureVisible',
  // v0.5 drive controls (spec §14 "Drive controls").
  'scroll',
  'panTo',
  'click',
  'highlight',
  'back',
  'forward',
  'reload',
  'setPixelExact',
  'captureTarget',
  'focusWindow',
] as const

export type ControlCommand = (typeof CONTROL_COMMANDS)[number]

export function isControlCommand(v: unknown): v is ControlCommand {
  return typeof v === 'string' && (CONTROL_COMMANDS as readonly string[]).includes(v)
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/**
 * Parses a discovery file's contents. Strict: a malformed file (bad JSON,
 * out-of-range port, a token that is not 64 hex chars) yields null — the
 * client must treat the app as not reachable rather than send credentials
 * derived from a file something else may have written.
 */
export function parseControlFile(raw: string): ControlInfo | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const { port, token } = parsed
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return null
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null
  return { port, token }
}

/**
 * Whether a discovery file's permission bits are acceptable: no group or
 * other access on POSIX (the app writes it 0600). Windows has no POSIX mode
 * bits worth reading, so everything passes there.
 */
export function controlFileModeOk(mode: number, platform: NodeJS.Platform): boolean {
  if (platform === 'win32') return true
  return (mode & 0o077) === 0
}

/**
 * Constant-time bearer-token comparison. Both sides are hashed first so
 * `timingSafeEqual` always gets equal-length inputs — a length mismatch must
 * not throw or short-circuit into a timing signal.
 */
export function tokenEqual(expected: string, provided: unknown): boolean {
  if (typeof provided !== 'string') return false
  const a = createHash('sha256').update(expected).digest()
  const b = createHash('sha256').update(provided).digest()
  return timingSafeEqual(a, b)
}

/**
 * Where the app's discovery file lives for a given platform, derived the way
 * Electron derives `app.getPath('userData')` for productName "Obsrv" — the
 * MCP server runs under plain node and cannot ask Electron.
 */
export function defaultControlFilePath(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  home: string,
): string {
  const appDir =
    platform === 'darwin'
      ? join(home, 'Library', 'Application Support', 'Obsrv')
      : platform === 'win32'
        ? join(env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), 'Obsrv')
        : join(env['XDG_CONFIG_HOME'] ?? join(home, '.config'), 'Obsrv')
  return join(appDir, CONTROL_FILE_NAME)
}

const idList = (ids: readonly string[]): string => ids.join(', ')

/**
 * Validates a `setPreset` payload id. The custom preset is refused: it is
 * defined by the renderer's own width/height/diagonal fields, so "apply
 * custom" from outside would apply whatever happened to be typed there.
 */
export function presetApplyError(id: unknown): string | null {
  if (typeof id !== 'string') return 'setPreset payload must be { id: string }'
  if (id === 'custom') {
    return 'the custom preset cannot be applied remotely — it is defined by the fields in the app; pick a preset id'
  }
  if (!SCREEN_PRESETS.some(p => p.id === id)) {
    return `unknown preset "${id}" — valid ids: ${idList(SCREEN_PRESETS.map(p => p.id))}`
  }
  return null
}

export function profileApplyError(id: unknown): string | null {
  if (typeof id !== 'string') return 'setProfile payload must be { id: string }'
  if (!PANEL_PROFILES.some(p => p.id === id)) {
    return `unknown profile "${id}" — valid ids: ${idList(PANEL_PROFILES.map(p => p.id))}`
  }
  return null
}

export function viewModeApplyError(v: unknown): string | null {
  return v === '1:1' || v === 'fit' ? null : `setViewMode payload must be { mode: '1:1' | 'fit' }`
}

export function pixelExactApplyError(v: unknown): string | null {
  return typeof v === 'boolean' ? null : 'setPixelExact payload must be { on: boolean }'
}

/**
 * Validates a `click` payload against the target's *current* CSS viewport:
 * `sendInputEvent` takes CSS coordinates, and a click past the viewport edge
 * would land on nothing (or, worse, on whatever the page scrolled there),
 * so it is refused rather than clamped. The coordinate space is
 * `[0, width) × [0, height)` — pixel row `height` is the first one *outside*
 * a `height`-pixel viewport. The button defaults to left. Returns the
 * validated click, or the error message.
 */
export function parseClick(raw: unknown, viewport: { width: number; height: number }): AgentClick | string {
  const shape = 'click payload must be { x, y, button? } with finite CSS-pixel coordinates'
  if (!isRecord(raw)) return shape
  const { x, y } = raw
  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) return shape
  if (x < 0 || y < 0 || x >= viewport.width || y >= viewport.height) {
    return `click (${x}, ${y}) is outside the current CSS viewport ${viewport.width}x${viewport.height}`
  }
  const button = raw.button ?? 'left'
  if (button !== 'left' && button !== 'middle' && button !== 'right') {
    return 'click button must be left, middle or right'
  }
  return { x, y, button }
}

/** How long a highlight overlay stays up when the payload does not say. */
export const HIGHLIGHT_DURATION_DEFAULT_MS = 2_000
/** Shorter would flash imperceptibly; the payload is clamped, not refused. */
export const HIGHLIGHT_DURATION_MIN_MS = 250
/** Longer would squat on the pixels under inspection; clamped likewise. */
export const HIGHLIGHT_DURATION_MAX_MS = 10_000

/**
 * Validates a `highlight` payload: the rect is checked exactly like a pane
 * rect (`parseRect` — finite, non-negative, bounded, rounded) and must be at
 * least 1×1 after rounding (an invisible highlight answering ok would lie).
 * `durationMs` defaults and clamps rather than erroring — the exact lifetime
 * is presentation, not correctness — but a non-numeric one is refused, never
 * guessed. Returns the validated highlight, or the error message.
 */
export function parseHighlight(raw: unknown): AgentHighlight | string {
  const rect = parseRect(raw)
  if (!rect) return 'highlight payload must be { x, y, width, height, durationMs? } with finite, non-negative target-pixel bounds'
  if (rect.width < 1 || rect.height < 1) return 'highlight rect must be at least 1x1 target pixels'
  const d = (raw as Record<string, unknown>).durationMs
  if (d === undefined) return { ...rect, durationMs: HIGHLIGHT_DURATION_DEFAULT_MS }
  if (typeof d !== 'number' || !Number.isFinite(d)) return 'highlight durationMs must be a finite number of milliseconds'
  return {
    ...rect,
    durationMs: Math.min(Math.max(Math.round(d), HIGHLIGHT_DURATION_MIN_MS), HIGHLIGHT_DURATION_MAX_MS),
  }
}

/** Validates a control server `status` response on the client side. */
export function parseControlStatus(raw: unknown): ControlStatus | null {
  if (!isRecord(raw)) return null
  const { version, url, presetId, profileId, viewMode, mode } = raw
  if (typeof version !== 'string' || typeof url !== 'string') return null
  if (typeof presetId !== 'string' || typeof profileId !== 'string') return null
  if (viewMode !== '1:1' && viewMode !== 'fit') return null
  if (mode !== 'url' && mode !== 'image') return null
  return { version, url, presetId, profileId, viewMode, mode }
}
