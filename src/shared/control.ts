import { createHash, timingSafeEqual } from 'node:crypto'
import { DEFAULT_THROTTLE, isThrottleId, THROTTLE_IDS } from './throttle'
import { DEFAULT_ONION_SKIN, isOnionSkin } from './onionSkin'
import { isVisionType, VISION_TYPES, type VisionType } from './vision'
import { join } from 'node:path'
import { parseRect } from './ipcPayloads'
import { screenShape } from './calibration'
import { DEFAULT_ORIENTATION, isOrientation, PANEL_PROFILES, SCREEN_PRESETS } from './presets'
import { DEFAULT_TEXT_SCALE, isTextScale, MAX_TEXT_SCALE, MIN_TEXT_SCALE } from './textScale'
import type { Orientation } from './types'

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
  /** The process that wrote the file; absent from an app older than the stamp. */
  pid?: number
  /** When that process came up, ISO 8601; absent likewise. */
  startedAt?: string
}

/** How the target pane shows the render — mirrors the renderer store's ViewMode. */
export type AgentViewMode = '1:1' | 'fit'

/** Whether the native pane shares the window — mirrors the renderer store's Panes. */
export type AgentPanes = 'both' | 'target'

/** The renderer-owned UI state main mirrors for the control server's `status`. */
export interface AgentUiState {
  presetId: string
  profileId: string
  viewMode: AgentViewMode
  panes: AgentPanes
  /** Which way round the tab's screen is held — mirrors the store's `orientation`. */
  orientation: Orientation
  /** Browser zoom as reflow on the target, 1 = none — mirrors the store's `textScale`. */
  textScale: number
  /** Network and CPU conditions on the target, a preset id, `none` = as the host — mirrors the store's `throttle`. */
  throttle: string
  /** The onion skin's opacity, 0 = off — mirrors the store's `onionSkin` (see shared/onionSkin.ts). */
  onionSkin: number
  mode: 'url' | 'image'
  /** The viewer simulation, so a capture is never silently colour-shifted. */
  visionType: VisionType
  /** 0..1. Meaningless when the type is `none`, and reported anyway. */
  visionSeverity: number
}

/**
 * The `IPC.uiState` wire report: the UI mirror plus the target pane's
 * window-relative bounds in CSS pixels, which `captureTarget` crops the
 * window capture to. Null (or absent) before the pane has mounted — the
 * capture then falls back to the full window with a warning, never errors.
 */
export interface AgentUiReport extends AgentUiState {
  /**
   * Which tab the report describes. The renderer holds one store per tab and
   * reports whichever is in front, so a report can be in flight while the user
   * switches — and main, which mirrors it for `status`, would then attribute
   * the outgoing tab's preset to the incoming one. Naming the tab lets main
   * drop a report that no longer describes the tab it is about to write.
   */
  tabId: string
  targetBounds?: { x: number; y: number; width: number; height: number } | null
  /**
   * Where the rendered screen itself sits, in the same window-relative CSS
   * pixels — the canvas rect clipped to the pane. `captureTarget` crops to
   * this rather than to the pane, so a minified mobile preset comes back
   * phone-sized instead of phone-sized inside a mostly-empty rectangle.
   */
  canvasBounds?: { x: number; y: number; width: number; height: number } | null
}

/**
 * What `status` returns: the UI mirror plus app version, the target's URL, and
 * the tab all of it describes.
 */
export interface ControlStatus extends AgentUiState {
  version: string
  url: string
  /**
   * Which tab the agent is acting on. Every command resolves the active tab
   * when it arrives rather than binding one at drive start, so this is the
   * answer to "where did that land" — an agent that cares whether the user
   * moved compares it across calls.
   *
   * Main owns tab identity (a tab *is* the pair of Chromium renderers it
   * built), so these two come from the tab manager, never from the renderer
   * mirror the fields above come from. `''` and `0` when the app predates
   * tabs — see `parseControlStatus`.
   */
  tabId: string
  /** The tab's position in the strip, 0-based. */
  tabIndex: number
  /**
   * The CSS viewport the target is actually rendering at — already rotated,
   * because it is read from the offscreen surface rather than from the preset
   * table. `0` from an app that predates these fields.
   */
  cssWidth: number
  cssHeight: number
  /** Whether the target is loading a document. `false` from an app that predates the field. */
  loading: boolean
  /**
   * The shape those dimensions actually have. `orientation` above is the
   * rotation *flag* — "the preset as its table stores it" vs "turned a quarter
   * turn" — and for a landscape-natural monitor preset the two diverge: a
   * fresh 1080p-24 tab is `orientation: 'portrait'` on a 1920x1080 landscape
   * screen. The app's own UI has always labelled from the derived shape rather
   * than the flag (see `selectScreenShape` and the pane footer); an agent gets
   * the same courtesy here instead of being handed a word it cannot correct
   * without the preset table.
   */
  screenShape: Orientation
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
  panes?: AgentPanes
  orientation?: Orientation
  textScale?: number
  throttle?: string
  onionSkin?: number
  pixelExact?: boolean
  visionType?: VisionType
  visionSeverity?: number
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
  'setPanes',
  'setVision',
  'setOrientation',
  'setTextScale',
  'setOnionSkin',
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
  'captureRaster',
  'focusWindow',
  // v0.24 — the inspector for agents: a point or a selector, a readout back.
  'inspect',
  // v0.29 — the physical-units audit on the page in front, as `obsrv audit` measures a headless load.
  'audit',
  // v0.30 — the lint on the page in front, as `obsrv lint` judges a headless load.
  'lint',
  // v0.25 — throttling on the live target.
  'setThrottle',
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
  // The owner stamp is optional (an older app writes none) but, when
  // present, must be well-formed: a stamp that cannot be trusted is worse
  // than no stamp, since a reader would act on it.
  const { pid, startedAt } = parsed
  if (pid !== undefined && (typeof pid !== 'number' || !Number.isInteger(pid) || pid < 1)) return null
  if (startedAt !== undefined && (typeof startedAt !== 'string' || Number.isNaN(Date.parse(startedAt)))) return null
  return { port, token, ...(pid !== undefined ? { pid } : {}), ...(startedAt !== undefined ? { startedAt } : {}) }
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

/**
 * Validates a `setOrientation` payload. Unlike a preset id there is no table to
 * miss, so the message just names the two words rather than listing anything.
 */
export function orientationApplyError(v: unknown): string | null {
  return isOrientation(v) ? null : `setOrientation payload must be { orientation: 'portrait' | 'landscape' }`
}

/** Validates a `setTextScale` payload: a finite number within the range the app renders. */
export function textScaleApplyError(v: unknown): string | null {
  return isTextScale(v) ? null : `setTextScale payload must be { textScale: number } with ${MIN_TEXT_SCALE} <= textScale <= ${MAX_TEXT_SCALE}`
}

/** Validates a `setThrottle` payload: one of the preset ids. */
export function throttleApplyError(v: unknown): string | null {
  return isThrottleId(v) ? null : `setThrottle payload must be { throttle: id } with id one of ${THROTTLE_IDS.join(', ')}`
}

/** Validates a `setOnionSkin` payload: an opacity, 0 for off. */
export function onionSkinApplyError(v: unknown): string | null {
  return isOnionSkin(v) ? null : 'setOnionSkin payload must be { onionSkin: number } with 0 <= onionSkin <= 1 (0 is off)'
}

export function panesApplyError(v: unknown): string | null {
  return v === 'both' || v === 'target' ? null : `setPanes payload must be { panes: 'both' | 'target' }`
}

/**
 * Validates a `setVision` payload. Severity is accepted alongside the type
 * because they are one decision — "deutan" without a severity is ambiguous
 * between the common partial case and the rare complete one.
 */
export function visionApplyError(type: unknown, severity: unknown): string | null {
  if (!isVisionType(type)) {
    return `setVision payload must be { type: ${VISION_TYPES.map(t => `'${t.id}'`).join(' | ')}, severity?: 0..1 }`
  }
  if (severity === undefined) return null
  if (typeof severity !== 'number' || !(severity >= 0 && severity <= 1)) {
    return 'setVision severity must be a number from 0 to 1'
  }
  return null
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
/** Which space a highlight rect is given in: the pane's device pixels (default), or the page's own CSS px. */
export type HighlightSpace = 'pane' | 'page'

/**
 * A `highlight` payload as it arrives: the rect in `space`. `page` is the
 * space an audit finding's `rect` and the inspector's `pageRect` are in —
 * page CSS px, scroll included — and the control server maps it onto the
 * pane through the target's scroll, text scale and density, so an agent can
 * mark a finding without reading the scroll back and doing the arithmetic.
 */
export function parseHighlight(raw: unknown): (AgentHighlight & { space: HighlightSpace }) | string {
  const rect = parseRect(raw)
  if (!rect) return 'highlight payload must be { x, y, width, height, durationMs?, space? } with finite, non-negative bounds'
  if (rect.width < 1 || rect.height < 1) return 'highlight rect must be at least 1x1 pixels'
  const r = raw as Record<string, unknown>
  const space = r.space ?? 'pane'
  if (space !== 'pane' && space !== 'page') return "highlight space must be 'pane' (target-pane device px, the default) or 'page' (page CSS px)"
  const d = r.durationMs
  if (d === undefined) return { ...rect, durationMs: HIGHLIGHT_DURATION_DEFAULT_MS, space }
  if (typeof d !== 'number' || !Number.isFinite(d)) return 'highlight durationMs must be a finite number of milliseconds'
  return {
    ...rect,
    durationMs: Math.min(Math.max(Math.round(d), HIGHLIGHT_DURATION_MIN_MS), HIGHLIGHT_DURATION_MAX_MS),
    space,
  }
}

/** What a page-space rect is mapped through: the target's scroll (page CSS px), text scale and density. */
export interface TargetView {
  scrollX: number
  scrollY: number
  textScale: number
  dsf: number
  /** The viewport, in the pane's device pixels. */
  paneWidth: number
  paneHeight: number
}

/**
 * A page rect (CSS px, scroll included) onto the pane's device pixels, cut
 * to the viewport; null when none of it is on screen at the current scroll.
 * A page CSS px is `textScale` surface CSS px (the page lays out in
 * `1/textScale` of the surface), and a surface CSS px is `dsf` device px.
 */
export function pageRectToPane(
  rect: { x: number; y: number; width: number; height: number },
  view: TargetView,
): { x: number; y: number; width: number; height: number } | null {
  const k = view.textScale * view.dsf
  const x0 = Math.max(0, Math.round((rect.x - view.scrollX) * k))
  const y0 = Math.max(0, Math.round((rect.y - view.scrollY) * k))
  const x1 = Math.min(view.paneWidth, Math.round((rect.x + rect.width - view.scrollX) * k))
  const y1 = Math.min(view.paneHeight, Math.round((rect.y + rect.height - view.scrollY) * k))
  if (x1 - x0 < 1 || y1 - y0 < 1) return null
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/**
 * The shape to report when the app did not name one. Dimensions settle it
 * outright when they are there. Without them the app predates rotation, which
 * means it is showing the preset unrotated — so the preset's own natural shape
 * is exact rather than a guess. Only a custom screen on such an app falls all
 * the way through to the flag.
 */
function inferScreenShape(
  cssWidth: number,
  cssHeight: number,
  presetId: string,
  orientation: Orientation,
): Orientation {
  if (cssWidth > 0 && cssHeight > 0) return screenShape(cssWidth, cssHeight)
  const preset = SCREEN_PRESETS.find(p => p.id === presetId)
  return preset ? screenShape(preset.width, preset.height) : orientation
}

/** Validates a control server `status` response on the client side. */
export function parseControlStatus(raw: unknown): ControlStatus | null {
  if (!isRecord(raw)) return null
  const { version, url, presetId, profileId, viewMode, mode } = raw
  if (typeof version !== 'string' || typeof url !== 'string') return null
  if (typeof presetId !== 'string' || typeof profileId !== 'string') return null
  if (viewMode !== '1:1' && viewMode !== 'fit') return null
  if (mode !== 'url' && mode !== 'image') return null
  // An app older than this field is common — the MCP server ships on npm and
  // the app ships as a DMG, so they update independently. Absent defaults;
  // present-but-wrong is still a malformed status.
  const panes = raw.panes ?? 'both'
  if (panes !== 'both' && panes !== 'target') return null
  // The same skew, one release later. An app that predates tabs has exactly
  // one session — it is the tab at index 0, and it has no id to name — so the
  // defaults describe that app truthfully rather than papering over it. An
  // agent polling one sees an unchanging `tabId`, which is correct: there is
  // no other tab for the user to switch to. Returning null instead would take
  // out drive and live snap wholesale against every app older than tabs.
  const tabId = raw.tabId ?? ''
  if (typeof tabId !== 'string') return null
  const tabIndex = raw.tabIndex ?? 0
  if (typeof tabIndex !== 'number' || !Number.isInteger(tabIndex) || tabIndex < 0) return null
  // And the same skew again, one release later still. The npm MCP server
  // routinely talks to a DMG app older than itself, and an app that predates
  // rotation shows every screen unrotated — which is exactly what the default
  // says. Returning null instead would take out drive and live snap wholesale
  // against every app older than this feature, which is the bug this repo has
  // already been bitten by twice.
  const orientation = raw.orientation ?? DEFAULT_ORIENTATION
  if (!isOrientation(orientation)) return null
  // Same skew once more: an app that predates text scale renders at ×1.
  const textScale = raw.textScale ?? DEFAULT_TEXT_SCALE
  if (!isTextScale(textScale)) return null
  // And the throttle: an app older than it runs the target as the host.
  const throttle = raw.throttle ?? DEFAULT_THROTTLE
  if (!isThrottleId(throttle)) return null
  // And the onion skin: an app older than it draws none.
  const onionSkin = raw.onionSkin ?? DEFAULT_ONION_SKIN
  if (!isOnionSkin(onionSkin)) return null
  // And once more for the dimensions and the derived shape. `0` means "the app
  // did not say", which is the truthful answer for one that predates them —
  // inventing a size would be worse than admitting the gap.
  const loading = raw.loading ?? false
  if (typeof loading !== 'boolean') return null
  const cssWidth = raw.cssWidth ?? 0
  if (typeof cssWidth !== 'number' || !Number.isFinite(cssWidth) || cssWidth < 0) return null
  const cssHeight = raw.cssHeight ?? 0
  if (typeof cssHeight !== 'number' || !Number.isFinite(cssHeight) || cssHeight < 0) return null
  const reported = raw.screenShape
  if (reported !== undefined && !isOrientation(reported)) return null
  // And the same version skew once more. An app that predates the vision
  // simulation is not simulating anything, so `none` describes it exactly.
  const visionType = raw.visionType ?? 'none'
  if (!isVisionType(visionType)) return null
  const visionSeverity = raw.visionSeverity ?? 1
  if (typeof visionSeverity !== 'number' || !(visionSeverity >= 0 && visionSeverity <= 1)) return null
  return {
    version,
    url,
    presetId,
    profileId,
    viewMode,
    panes,
    orientation,
    textScale,
    throttle,
    onionSkin,
    mode,
    visionType,
    visionSeverity,
    tabId,
    tabIndex,
    cssWidth,
    cssHeight,
    loading,
    screenShape: reported ?? inferScreenShape(cssWidth, cssHeight, presetId, orientation),
  }
}
