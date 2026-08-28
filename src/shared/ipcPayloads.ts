import type { Rect } from './api'
import type { AgentUiReport } from './control'
import { DEFAULT_SETTINGS, MAX_TABS_MAX, MAX_TABS_MIN, SPLIT_MAX, SPLIT_MIN } from './presets'
import { MAX_SCROLL_SELECTOR, type InputModifier, type ScrollPos, type ScrollReport, type ScrollRequest, type Settings, type TargetInputEvent } from './types'

/**
 * Parsers for everything the renderer sends main over IPC. Each returns a
 * fresh, fully-typed value or `null`; nothing from the wire is passed through
 * by reference, so unknown keys never reach Electron, disk or `getSettings`.
 * Main must never crash on a renderer message — every handler drops a `null`
 * silently (or, for request/response channels, rejects the call).
 */

/** Largest coordinate or size a pane rect may carry; far beyond any real window. */
export const MAX_RECT = 16384

/** Most warnings a pane's scroll reply may carry; the preload sends at most one. */
const MAX_SCROLL_WARNINGS = 4

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

export function parseRect(raw: unknown): Rect | null {
  if (!isRecord(raw)) return null
  const { x, y, width, height } = raw
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) return null
  const r = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
  for (const v of [r.x, r.y, r.width, r.height]) if (v < 0 || v > MAX_RECT) return null
  return r
}

const MODIFIERS: ReadonlySet<string> = new Set<InputModifier>([
  'shift',
  'control',
  'alt',
  'meta',
  'leftButtonDown',
  'middleButtonDown',
  'rightButtonDown',
])
const BUTTONS: ReadonlySet<string> = new Set(['left', 'middle', 'right'])

type Button = Extract<TargetInputEvent, { button: unknown }>['button']

/** Unknown entries are dropped; a missing or non-array list means no modifiers. */
function parseModifiers(raw: unknown): InputModifier[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((m): m is InputModifier => typeof m === 'string' && MODIFIERS.has(m))
}

export function parseInputEvent(raw: unknown): TargetInputEvent | null {
  if (!isRecord(raw)) return null
  const modifiers = parseModifiers(raw.modifiers)
  switch (raw.type) {
    case 'mouseDown':
    case 'mouseUp':
    case 'mouseMove': {
      const { x, y, button, clickCount } = raw
      if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(clickCount)) return null
      if (typeof button !== 'string' || !BUTTONS.has(button)) return null
      return { type: raw.type, x, y, button: button as Button, clickCount, modifiers }
    }
    case 'mouseWheel': {
      const { x, y, deltaX, deltaY } = raw
      if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(deltaX) || !isFiniteNumber(deltaY)) return null
      return { type: 'mouseWheel', x, y, deltaX, deltaY, modifiers }
    }
    case 'keyDown':
    case 'keyUp':
    case 'char': {
      const { keyCode } = raw
      if (typeof keyCode !== 'string') return null
      return { type: raw.type, keyCode, modifiers }
    }
    default:
      return null
  }
}

/**
 * `setViewport`'s device scale factor. Real screens run 1x-3x; 4 leaves
 * headroom without letting a renderer ask for an absurd raster. A missing
 * value means 1 (the pre-mobile wire shape); anything else out of range is
 * refused, never clamped — main must not guess at a malformed payload.
 */
export function parseDeviceScaleFactor(raw: unknown): number | null {
  if (raw === undefined) return 1
  if (!isFiniteNumber(raw) || raw < 1 || raw > 4) return null
  return raw
}

/**
 * Copies exactly the known keys; the numbers must be finite and
 * positive. A missing `agentControl` means false and a missing `updateCheck`
 * means true (the pre-feature wire shapes); any non-boolean value is refused,
 * never coerced.
 */
export function parseSettings(raw: unknown): Settings | null {
  if (!isRecord(raw)) return null
  const { hostDiagonalInches, hostNits } = raw
  if (!isFiniteNumber(hostDiagonalInches) || hostDiagonalInches <= 0) return null
  if (!isFiniteNumber(hostNits) || hostNits <= 0) return null
  const agentControl = raw.agentControl ?? false
  if (typeof agentControl !== 'boolean') return null
  const updateCheck = raw.updateCheck ?? true
  if (typeof updateCheck !== 'boolean') return null
  const lastUpdateCheck = raw.lastUpdateCheck ?? 0
  if (!isFiniteNumber(lastUpdateCheck) || lastUpdateCheck < 0) return null
  const recordHistory = raw.recordHistory ?? true
  if (typeof recordHistory !== 'boolean') return null
  // A missing `split` is the pre-feature wire shape and means the default.
  // Out of band it is refused rather than clamped: `loadSettings` forgives a
  // hand-edited file because it must, but the renderer clamps before it
  // sends, so a bad ratio arriving here is a bug worth surfacing.
  const split = raw.split ?? DEFAULT_SETTINGS.split
  if (!isFiniteNumber(split) || split < SPLIT_MIN || split > SPLIT_MAX) return null
  // Same shape for the tab cap: absent is the pre-tabs wire shape and means
  // the default, and an out-of-band or fractional count is refused rather
  // than clamped — the Settings input is a bounded integer field, so one
  // arriving here is a bug rather than a hand-edited file.
  const maxTabs = raw.maxTabs ?? DEFAULT_SETTINGS.maxTabs
  if (!isFiniteNumber(maxTabs) || !Number.isInteger(maxTabs) || maxTabs < MAX_TABS_MIN || maxTabs > MAX_TABS_MAX) return null
  return { hostDiagonalInches, hostNits, agentControl, updateCheck, lastUpdateCheck, recordHistory, split, maxTabs }
}

export function parseMode(raw: unknown): 'url' | 'image' | null {
  return raw === 'url' || raw === 'image' ? raw : null
}

/** Longest preset/profile id the UI-state mirror will store. */
const MAX_UI_ID = 64

/**
 * The renderer's UI-state report (`IPC.uiState`), mirrored main-side so the
 * agent-control server can answer `status` without a renderer round-trip.
 * Ids are copied as opaque strings (bounded — the mirror must not store an
 * arbitrarily long one) rather than checked against the preset table: the
 * report *describes* renderer state, and refusing an id main does not know
 * would leave the mirror lying about it.
 *
 * `targetBounds` (the pane rect `captureTarget` crops to) is advisory:
 * malformed or missing bounds become null — the capture falls back to the
 * full window — rather than dropping the whole report and starving the
 * mirror of the state it *is* sure about.
 */
export function parseUiState(raw: unknown): AgentUiReport | null {
  if (!isRecord(raw)) return null
  const { presetId, profileId, viewMode, mode } = raw
  if (typeof presetId !== 'string' || presetId.length === 0 || presetId.length > MAX_UI_ID) return null
  if (typeof profileId !== 'string' || profileId.length === 0 || profileId.length > MAX_UI_ID) return null
  if (viewMode !== '1:1' && viewMode !== 'fit') return null
  if (mode !== 'url' && mode !== 'image') return null
  // A renderer older than this field cannot exist (both ship in one app), but
  // the report is validated like any other payload: absent defaults to both,
  // present-but-wrong drops the whole report.
  const panes = raw.panes ?? 'both'
  if (panes !== 'both' && panes !== 'target') return null
  return {
    presetId,
    profileId,
    viewMode,
    panes,
    mode,
    targetBounds: parseRect(raw.targetBounds),
    canvasBounds: parseRect(raw.canvasBounds),
  }
}

/**
 * A scroll offset reported by the sync preload in a page webContents. Both
 * axes must be finite and non-negative; anything else is dropped rather than
 * relayed to the other pane.
 */
export function parseScrollPos(raw: unknown): ScrollPos | null {
  if (!isRecord(raw)) return null
  const { x, y } = raw
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || x < 0 || y < 0) return null
  return { x, y }
}

/**
 * A `scroll` command payload: an offset plus the optional `scrollSelector`
 * escape hatch. The selector is only ever handed to `document.querySelector`
 * in the preload's isolated world — never evaluated — but it is still bounded
 * and type-checked here so a malformed one is refused with an explanation
 * rather than silently ignored by the page. Returns the parsed request, or the
 * error message.
 */
export function parseScrollRequest(raw: unknown): ScrollRequest | string {
  const pos = parseScrollPos(raw)
  if (!pos) return 'scroll payload must be { x, y } with finite, non-negative CSS-pixel offsets'
  const selector = (raw as Record<string, unknown>).scrollSelector
  if (selector === undefined || selector === null) return pos
  if (typeof selector !== 'string') return 'scrollSelector must be a CSS selector string'
  const trimmed = selector.trim()
  if (trimmed === '') return 'scrollSelector must not be empty'
  if (trimmed.length > MAX_SCROLL_SELECTOR) return `scrollSelector must be at most ${MAX_SCROLL_SELECTOR} characters`
  return { ...pos, selector: trimmed }
}

/**
 * A pane's `IPC.scrollResult` reply. Sent by the sync preload, which runs
 * beside a third-party page, so it is parsed exactly like any renderer
 * message; anything malformed is dropped and the caller times out rather than
 * reporting an offset it cannot trust.
 */
export function parseScrollReport(raw: unknown): ScrollReport | null {
  if (!isRecord(raw)) return null
  const { id, x, y, scroller } = raw
  if (!isFiniteNumber(id)) return null
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null
  if (scroller !== 'root' && scroller !== 'element') return null
  const warnings = Array.isArray(raw.warnings)
    ? raw.warnings.filter((w): w is string => typeof w === 'string').slice(0, MAX_SCROLL_WARNINGS)
    : []
  return { id, x, y, scroller, warnings }
}
