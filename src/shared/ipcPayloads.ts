import type { Rect } from './api'
import type { AgentUiState } from './control'
import type { InputModifier, ScrollPos, Settings, TargetInputEvent } from './types'

/**
 * Parsers for everything the renderer sends main over IPC. Each returns a
 * fresh, fully-typed value or `null`; nothing from the wire is passed through
 * by reference, so unknown keys never reach Electron, disk or `getSettings`.
 * Main must never crash on a renderer message — every handler drops a `null`
 * silently (or, for request/response channels, rejects the call).
 */

/** Largest coordinate or size a pane rect may carry; far beyond any real window. */
export const MAX_RECT = 16384

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
 * Copies exactly the three known keys; the numbers must be finite and
 * positive. A missing `agentControl` means false (the pre-live-drive wire
 * shape); any non-boolean value is refused, never coerced.
 */
export function parseSettings(raw: unknown): Settings | null {
  if (!isRecord(raw)) return null
  const { hostDiagonalInches, hostNits } = raw
  if (!isFiniteNumber(hostDiagonalInches) || hostDiagonalInches <= 0) return null
  if (!isFiniteNumber(hostNits) || hostNits <= 0) return null
  const agentControl = raw.agentControl ?? false
  if (typeof agentControl !== 'boolean') return null
  return { hostDiagonalInches, hostNits, agentControl }
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
 */
export function parseUiState(raw: unknown): AgentUiState | null {
  if (!isRecord(raw)) return null
  const { presetId, profileId, viewMode, mode } = raw
  if (typeof presetId !== 'string' || presetId.length === 0 || presetId.length > MAX_UI_ID) return null
  if (typeof profileId !== 'string' || profileId.length === 0 || profileId.length > MAX_UI_ID) return null
  if (viewMode !== '1:1' && viewMode !== 'fit') return null
  if (mode !== 'url' && mode !== 'image') return null
  return { presetId, profileId, viewMode, mode }
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
