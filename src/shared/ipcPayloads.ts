import { LINT_OBJECT_FITS } from './lint'
import type { WalkBlocked } from './walkCoverage'
import type { MenuGroup, MenuOption, MenuRequest, Rect } from './api'
import { DEFAULT_THROTTLE, isThrottleId } from './throttle'
import { DEFAULT_ONION_SKIN, isOnionSkin } from './onionSkin'
import { MAX_SELECTOR_LENGTH } from './inspect'
import type { SelectOpen, SelectResult } from './selectPopup'
import { isPickerType, MAX_PICKER_VALUE, type PickerEvent, type PickerOpen, type PickerRequest } from './pickerPopup'
import { parseTextScale } from './textScale'
import type { AuditRect, AuditReport, AuditTarget, AuditText } from './audit'
import type { LintEdge, LintEdgeKind, LintImage, LintRect, LintReport, LintText, LintObjectFit } from './lint'
import type { InspectReport, RGBA } from './inspect'
import { isVisionType } from './vision'
import type { AgentUiReport } from './control'
import { DEFAULT_ORIENTATION, DEFAULT_SETTINGS, isOrientation, MAX_TABS_MAX, MAX_TABS_MIN, SPLIT_MAX, SPLIT_MIN } from './presets'
import {
  MAX_SCROLL_SELECTOR,
  SCROLL_PAGES,
  type InputModifier,
  type Orientation,
  type ScrollPage,
  type ScrollPos,
  type ScrollReport,
  type ScrollRequest,
  type Settings,
  type TargetInputEvent,
} from './types'

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

/** Longest line the renderer may put in the app log; its messages are short and fixed. */
export const MAX_LOG_MESSAGE = 200

/**
 * A renderer line for the app log (`IPC.log`): one bounded line of printable
 * text. Control characters are dropped rather than the message, so a stray
 * newline cannot forge a second log entry.
 */
export function parseLogMessage(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_LOG_MESSAGE) return null
  // eslint-disable-next-line no-control-regex
  const clean = raw.replace(/[\x00-\x1f\x7f]+/g, ' ').trim()
  return clean.length === 0 ? null : clean
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** A point in the target viewport to inspect (`IPC.inspect`), CSS pixels. */
export function parseInspectPoint(raw: unknown): { x: number; y: number } | null {
  if (!isRecord(raw) || !isFiniteNumber(raw.x) || !isFiniteNumber(raw.y)) return null
  if (raw.x < 0 || raw.y < 0 || raw.x > MAX_RECT || raw.y > MAX_RECT) return null
  return { x: raw.x, y: raw.y }
}

/** What an agent may ask the inspector to look at: a viewport point, or a selector's first match. */
export type InspectRequest = { x: number; y: number } | { selector: string }

/** A point or a selector, or the reason it is neither — the control server's 400 text. */
export function parseInspectRequest(raw: unknown): InspectRequest | string {
  if (!isRecord(raw)) return 'inspect payload must be { x, y } (CSS px of the target screen) or { selector }'
  if (raw.selector !== undefined) {
    if (typeof raw.selector !== 'string') return 'selector must be a string'
    const selector = raw.selector.trim()
    if (selector.length === 0 || selector.length > MAX_SELECTOR_LENGTH) return `selector must be 1 to ${MAX_SELECTOR_LENGTH} characters`
    return { selector }
  }
  const point = parseInspectPoint(raw)
  return point ?? 'inspect payload must be { x, y } (non-negative CSS px of the target screen) or { selector }'
}

/** A live audit's request: the thresholds in millimetres; absent means the defaults. */
export type AuditRequest = { tapMm?: number; textMm?: number }

export function parseAuditRequest(raw: unknown): AuditRequest | string {
  if (raw === undefined || raw === null) return {}
  if (!isRecord(raw)) return 'audit payload must be {} or { tapMm?, textMm? } (finite, non-negative millimetres)'
  const out: AuditRequest = {}
  for (const k of ['tapMm', 'textMm'] as const) {
    const v = raw[k]
    if (v === undefined) continue
    if (!isFiniteNumber(v) || v < 0) return `${k} must be a finite, non-negative number of millimetres`
    out[k] = v
  }
  return out
}

/** A live lint's request: the thin-text threshold in device px; absent means the default. */
export type LintRequest = { thinPx?: number }

export function parseLintRequest(raw: unknown): LintRequest | string {
  if (raw === undefined || raw === null) return {}
  if (!isRecord(raw)) return 'lint payload must be {} or { thinPx? } (a finite, non-negative number of device pixels)'
  if (raw.thinPx === undefined) return {}
  if (!isFiniteNumber(raw.thinPx) || raw.thinPx < 0) return 'thinPx must be a finite, non-negative number of device pixels'
  return { thinPx: raw.thinPx }
}

/** Longest string the inspector keeps from the page: a tag, an id, a class list, a text snippet. */
const MAX_INSPECT_TEXT = 200

/** Longest srcset descriptor kept: "60w" and "2x" are the shape of the thing. */
const MAX_SRCSET_DESCRIPTOR = 16

/** How many srcset candidates are kept for one image; the page sends this many. */
const MAX_SRCSET_CANDIDATES = 12

const parseColor = (v: unknown): RGBA | null => {
  if (!Array.isArray(v) || v.length !== 4 || !v.every(isFiniteNumber)) return null
  const [r, g, b, a] = v as number[]
  if ([r, g, b].some(c => c! < 0 || c! > 255) || a! < 0 || a! > 1) return null
  return [r!, g!, b!, a!]
}
/**
 * The `dropped` block a report carries when the checks refused an entry or
 * two: only the kinds that lost something, and nothing at all when nothing
 * did, so a clean report is byte-for-byte what it always was.
 */
const droppedCount = <T extends Record<string, number>>(counts: T): { dropped?: Partial<T> } => {
  const kept = Object.entries(counts).filter(([, n]) => n > 0)
  return kept.length === 0 ? {} : { dropped: Object.fromEntries(kept) as Partial<T> }
}

const boundedString = (v: unknown): string | null =>
  typeof v === 'string' && v.length <= MAX_INSPECT_TEXT ? v : null

/**
 * The inspector's report from the target page (`TargetSource.inspectAt`).
 * The page is untrusted, so every field is checked and copied; a report
 * that fails anywhere is dropped whole rather than patched.
 */
export function parseInspectReport(raw: unknown): InspectReport | null {
  if (!isRecord(raw)) return null
  const tag = boundedString(raw.tag)
  const id = boundedString(raw.id)
  const classes = boundedString(raw.classes)
  const text = boundedString(raw.text)
  const fontFamily = boundedString(raw.fontFamily)
  if (tag === null || id === null || classes === null || text === null || fontFamily === null) return null
  if (!isRecord(raw.rect)) return null
  const { x, y, width, height } = raw.rect
  if (![x, y, width, height].every(isFiniteNumber)) return null
  if (!isFiniteNumber(raw.fontSizePx) || raw.fontSizePx < 0 || !isFiniteNumber(raw.fontWeight)) return null
  const color = parseColor(raw.color)
  if (!color) return null
  if (raw.backgroundNote !== 'computed' && raw.backgroundNote !== 'image') return null
  const background = raw.background === null ? null : parseColor(raw.background)
  if (raw.backgroundNote === 'computed' && !background) return null
  // A page that reports no opacity is fully opaque. Anything outside 0..1 is a
  // page saying something impossible, and the report is dropped whole rather
  // than clamped — the rule the rest of this parser follows.
  const opacity = raw.opacity === undefined ? 1 : raw.opacity
  if (!isFiniteNumber(opacity) || opacity < 0 || opacity > 1) return null
  // A page reporting anything but the two rules, or nothing at all, reads as
  // drawn: the same posture as `opacity` above, and an older report carries no
  // such field.
  const hidden = raw.hidden === 'visibility' || raw.hidden === 'display' ? raw.hidden : null
  return {
    opacity,
    hidden,
    tag,
    id,
    classes,
    text,
    rect: { x: x as number, y: y as number, width: width as number, height: height as number },
    fontSizePx: raw.fontSizePx,
    fontWeight: raw.fontWeight,
    fontFamily,
    color,
    background: raw.backgroundNote === 'image' ? null : background,
    backgroundNote: raw.backgroundNote,
    // The layout viewport's width, for the readout's layout scale; a report
    // from before the field, or a nonsense width, reads as a page that fits.
    ...(isFiniteNumber(raw.viewportWidth) && raw.viewportWidth > 0 ? { viewportWidth: raw.viewportWidth } : {}),
  }
}

/** Most entries an audit report may carry per list; the page's own caps are lower. */
const MAX_AUDIT_ENTRIES = 5000

const parseAuditRect = (v: unknown): AuditRect | null => {
  if (!isRecord(v)) return null
  const { x, y, width, height } = v
  if (![x, y, width, height].every(isFiniteNumber)) return null
  // `clipped` is a flag, not a value the page gets to shape: anything but a
  // literal true is dropped rather than copied through.
  return {
    x: x as number,
    y: y as number,
    width: width as number,
    height: height as number,
    ...(v.clipped === true ? { clipped: true as const } : {}),
  }
}

/**
 * The physical-units audit's report from the target page
 * (`TargetSource.auditPage`). Untrusted like the inspector's: every entry
 * is checked and copied, a bad entry drops the report whole, and the lists
 * are bounded above whatever the page claims.
 */
/**
 * The iframe count and viewport coverage a page script reports
 * (`framesInViewport`), when it does and they parse; an older app sends
 * none, and the empty-document sentence then has no iframe clause.
 */
/** The shadow-root counts a page sent, when it sent them and they are counts. */
function shadowSeen(raw: unknown): {
  shadow?: { hosts: number; interactive: number; text: number; lightInteractive?: number; lightText?: number }
} {
  if (!isRecord(raw)) return {}
  const n = (v: unknown): number | null => (isFiniteNumber(v) && v >= 0 && Number.isInteger(v) ? v : null)
  const hosts = n(raw.hosts)
  const interactive = n(raw.interactive)
  const text = n(raw.text)
  if (hosts === null || interactive === null || text === null) return {}
  // The light-DOM counts are the share sentence's denominator, and a page
  // that did not send them gets no share sentence rather than a fraction of
  // a number that was not measured. Each is carried only if it is a count.
  const lightInteractive = n(raw.lightInteractive)
  const lightText = n(raw.lightText)
  return {
    shadow: {
      hosts,
      interactive,
      text,
      ...(lightInteractive === null ? {} : { lightInteractive }),
      ...(lightText === null ? {} : { lightText }),
    },
  }
}

function frameCoverage(raw: unknown): { frames?: { count: number; viewportCoverage: number } } {
  if (!isRecord(raw) || !isFiniteNumber(raw.count) || !isFiniteNumber(raw.viewportCoverage)) return {}
  return { frames: { count: Math.max(0, Math.floor(raw.count)), viewportCoverage: Math.min(1, Math.max(0, raw.viewportCoverage)) } }
}

export function parseAuditReport(raw: unknown): AuditReport | null {
  if (!isRecord(raw) || !isRecord(raw.viewport) || !isRecord(raw.truncated)) return null
  if (!isFiniteNumber(raw.viewport.width) || !isFiniteNumber(raw.viewport.height) || !isFiniteNumber(raw.pageHeight)) return null
  if (!Array.isArray(raw.targets) || !Array.isArray(raw.text)) return null
  if (raw.targets.length > MAX_AUDIT_ENTRIES || raw.text.length > MAX_AUDIT_ENTRIES) return null
  const count = (v: unknown): number | null => (isFiniteNumber(v) && v >= 0 && Number.isInteger(v) ? v : null)
  const truncatedTargets = count(raw.truncated.targets)
  const truncatedText = count(raw.truncated.text)
  if (truncatedTargets === null || truncatedText === null) return null

  // A value the checks refuse costs its own entry, not the page: one bad
  // element used to discard every figure on it (a srcset descriptor did
  // exactly that on reuters.com, fixed in 0.54.0). What cannot be salvaged
  // — no viewport, a list past the bound — is still refused whole above,
  // because there is no partial answer to give. The counts ride back so the
  // judge can say how many went and of what kind.
  let droppedTargets = 0
  let droppedText = 0
  const targets: AuditTarget[] = []
  for (const t of raw.targets) {
    if (!isRecord(t)) {
      droppedTargets++
      continue
    }
    const element = boundedString(t.element)
    const text = boundedString(t.text)
    const rect = parseAuditRect(t.rect)
    if (element === null || text === null || rect === null) {
      droppedTargets++
      continue
    }
    targets.push({ element, text, rect })
  }
  const text: AuditText[] = []
  for (const t of raw.text) {
    if (!isRecord(t)) {
      droppedText++
      continue
    }
    const element = boundedString(t.element)
    const snippet = boundedString(t.text)
    const rect = parseAuditRect(t.rect)
    if (element === null || snippet === null || rect === null || !isFiniteNumber(t.fontSizePx) || t.fontSizePx < 0) {
      droppedText++
      continue
    }
    text.push({ element, text: snippet, fontSizePx: t.fontSizePx, rect })
  }
  return {
    viewport: { width: raw.viewport.width, height: raw.viewport.height },
    pageHeight: raw.pageHeight,
    targets,
    text,
    truncated: { targets: truncatedTargets, text: truncatedText },
    ...droppedCount({ targets: droppedTargets, text: droppedText }),
    ...frameCoverage(raw.frames),
    ...shadowSeen(raw.shadow),
  }
}

export function parseRect(raw: unknown): Rect | null {
  if (!isRecord(raw)) return null
  const { x, y, width, height } = raw
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) return null
  const r = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
  for (const v of [r.x, r.y, r.width, r.height]) if (v < 0 || v > MAX_RECT) return null
  return r
}

/** Most entries a lint report may carry per list; the page's own caps are lower. */
const MAX_LINT_ENTRIES = 5000
const LINT_EDGE_KINDS: ReadonlySet<string> = new Set<LintEdgeKind>([
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'outline',
  'box-shadow',
  'height',
  'width',
])

const parseLintRect = (v: unknown): LintRect | null => {
  if (!isRecord(v)) return null
  const { x, y, width, height } = v
  if (![x, y, width, height].every(isFiniteNumber)) return null
  // `clipped` is a flag, not a value the page gets to shape: anything but a
  // literal true is dropped rather than copied through.
  return {
    x: x as number,
    y: y as number,
    width: width as number,
    height: height as number,
    ...(v.clipped === true ? { clipped: true as const } : {}),
  }
}

/**
 * The lint's report from the target page (`TargetSource.lintPage`), checked
 * and copied entry by entry like the audit's; a bad entry drops the report
 * whole, and the lists are bounded above whatever the page claims.
 */
export function parseLintReport(raw: unknown): LintReport | null {
  if (!isRecord(raw) || !isRecord(raw.viewport) || !isRecord(raw.truncated)) return null
  if (!isFiniteNumber(raw.viewport.width) || !isFiniteNumber(raw.viewport.height) || !isFiniteNumber(raw.pageHeight)) return null
  if (!Array.isArray(raw.text) || !Array.isArray(raw.edges) || !Array.isArray(raw.images)) return null
  if (raw.text.length > MAX_LINT_ENTRIES || raw.edges.length > MAX_LINT_ENTRIES || raw.images.length > MAX_LINT_ENTRIES) return null
  const count = (v: unknown): number | null => (isFiniteNumber(v) && v >= 0 && Number.isInteger(v) ? v : null)
  const overText = count(raw.truncated.text)
  const overEdges = count(raw.truncated.edges)
  const overImages = count(raw.truncated.images)
  if (overText === null || overEdges === null || overImages === null) return null

  // Per-entry, as the audit: a refused value costs its own entry and is
  // counted, and only what cannot be salvaged refuses the page.
  let droppedText = 0
  let droppedEdges = 0
  let droppedImages = 0
  const text: LintText[] = []
  for (const t of raw.text) {
    if (!isRecord(t)) {
      droppedText++
      continue
    }
    const element = boundedString(t.element)
    const snippet = boundedString(t.text)
    const fontFamily = boundedString(t.fontFamily)
    const rect = parseLintRect(t.rect)
    const color = parseColor(t.color)
    const background = t.background === null ? null : parseColor(t.background)
    if (
      element === null ||
      snippet === null ||
      fontFamily === null ||
      rect === null ||
      !isFiniteNumber(t.fontSizePx) ||
      t.fontSizePx < 0 ||
      !isFiniteNumber(t.fontWeight) ||
      !color ||
      (t.backgroundNote !== 'computed' && t.backgroundNote !== 'image') ||
      (t.backgroundNote === 'computed' && !background) ||
      // Absent means opaque; outside 0..1 is a page saying something that
      // cannot be true, and this parser drops rather than clamps.
      (t.opacity !== undefined && (!isFiniteNumber(t.opacity) || t.opacity < 0 || t.opacity > 1))
    ) {
      droppedText++
      continue
    }
    text.push({
      element,
      text: snippet,
      rect,
      opacity: t.opacity === undefined ? 1 : (t.opacity as number),
      fontSizePx: t.fontSizePx,
      fontWeight: t.fontWeight,
      fontFamily,
      color,
      background: t.backgroundNote === 'image' ? null : background,
      backgroundNote: t.backgroundNote,
    })
  }
  const edges: LintEdge[] = []
  for (const e of raw.edges) {
    if (!isRecord(e)) {
      droppedEdges++
      continue
    }
    const element = boundedString(e.element)
    const snippet = boundedString(e.text)
    const rect = parseLintRect(e.rect)
    if (
      element === null ||
      snippet === null ||
      rect === null ||
      typeof e.kind !== 'string' ||
      !LINT_EDGE_KINDS.has(e.kind) ||
      !isFiniteNumber(e.px) ||
      e.px <= 0
    ) {
      droppedEdges++
      continue
    }
    edges.push({ element, text: snippet, rect, kind: e.kind as LintEdgeKind, px: e.px })
  }
  const images: LintImage[] = []
  for (const i of raw.images) {
    if (!isRecord(i)) {
      droppedImages++
      continue
    }
    const element = boundedString(i.element)
    const src = boundedString(i.src)
    const rect = parseLintRect(i.rect)
    if (
      element === null ||
      src === null ||
      rect === null ||
      !isFiniteNumber(i.naturalWidth) ||
      !isFiniteNumber(i.naturalHeight) ||
      i.naturalWidth <= 0 ||
      i.naturalHeight <= 0 ||
      typeof i.srcset !== 'boolean' ||
      !Array.isArray(i.candidates)
    ) {
      droppedImages++
      continue
    }
    // A descriptor is short ("60w", "2x"). One that is not is this image's
    // srcset detail gone wrong, not the page's measurement, so it is dropped
    // on its own: a malformed descriptor once cost a whole page its lint.
    const candidates: string[] = []
    for (const c of i.candidates) {
      if (candidates.length >= MAX_SRCSET_CANDIDATES) break
      const s = boundedString(c)
      if (s !== null && s.length > 0 && s.length <= MAX_SRCSET_DESCRIPTOR) candidates.push(s)
    }
    let chosen: string | undefined
    if (i.chosen !== undefined) {
      const c = boundedString(i.chosen)
      chosen = c !== null && c.length <= MAX_SRCSET_DESCRIPTOR ? c : undefined
    }
    let objectFit: LintObjectFit | undefined
    if (i.objectFit !== undefined) {
      if (typeof i.objectFit !== 'string' || !(LINT_OBJECT_FITS as readonly string[]).includes(i.objectFit)) {
        droppedImages++
        continue
      }
      objectFit = i.objectFit as LintObjectFit
    }
    images.push({
      element,
      rect,
      naturalWidth: i.naturalWidth,
      naturalHeight: i.naturalHeight,
      src,
      srcset: i.srcset,
      candidates,
      ...(chosen !== undefined ? { chosen } : {}),
      ...(objectFit !== undefined ? { objectFit } : {}),
    })
  }
  return {
    viewport: { width: raw.viewport.width, height: raw.viewport.height },
    pageHeight: raw.pageHeight,
    text,
    edges,
    images,
    truncated: { text: overText, edges: overEdges, images: overImages },
    ...droppedCount({ text: droppedText, edges: droppedEdges, images: droppedImages }),
    ...(raw.spacers !== undefined ? { spacers: count(raw.spacers) ?? 0 } : {}),
    ...frameCoverage(raw.frames),
    ...shadowSeen(raw.shadow),
  }
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

/**
 * An orientation off the wire. Refused rather than defaulted, unlike the
 * absent-field handling inside `parseUiState`: a caller that names an
 * orientation and gets a different one back is worse served than one told its
 * value was not a word this app knows.
 */
export function parseOrientation(raw: unknown): Orientation | null {
  return isOrientation(raw) ? raw : null
}

export function parseMode(raw: unknown): 'url' | 'image' | null {
  return raw === 'url' || raw === 'image' ? raw : null
}

/** Longest preset/profile id the UI-state mirror will store. */
const MAX_UI_ID = 64

/**
 * Longest tab id main will act on. Ids are minted main-side (`tab-N`), so a
 * renderer message naming one is only ever echoing what it was told; the bound
 * is there because the renderer is still the one sending it. An id no session
 * carries resolves to nothing in the manager and the command is dropped, so
 * shape is all this has to check.
 */
const MAX_TAB_ID = 64

export function parseTabId(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_TAB_ID) return null
  return raw
}

/**
 * A `moveTab` payload: `{ id, toIndex }`. The index is not bounded here —
 * `moveTab` in `shared/tabList.ts` clamps it against the list it can see, and
 * this side cannot see the list. What it does refuse is a value that is not a
 * finite integer, because that reaches `Math.min`/`Math.max` as NaN and comes
 * out the far end as position 0 without anything having gone wrong.
 */
export function parseTabMove(raw: unknown): { id: string; toIndex: number } | null {
  if (!isRecord(raw)) return null
  const id = parseTabId(raw.id)
  if (id === null) return null
  const toIndex = raw.toIndex
  if (typeof toIndex !== 'number' || !Number.isInteger(toIndex)) return null
  return { id, toIndex }
}

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
  // Required, unlike `panes` below: there is no sane default for "which tab
  // this describes", and guessing would reintroduce exactly the misattribution
  // the field exists to stop.
  const tabId = parseTabId(raw.tabId)
  if (tabId === null) return null
  if (typeof presetId !== 'string' || presetId.length === 0 || presetId.length > MAX_UI_ID) return null
  if (typeof profileId !== 'string' || profileId.length === 0 || profileId.length > MAX_UI_ID) return null
  if (viewMode !== '1:1' && viewMode !== 'fit') return null
  if (mode !== 'url' && mode !== 'image') return null
  // A renderer older than this field cannot exist (both ship in one app), but
  // the report is validated like any other payload: absent defaults to both,
  // present-but-wrong drops the whole report.
  const panes = raw.panes ?? 'both'
  if (panes !== 'both' && panes !== 'target') return null
  // Same shape again for the orientation, and for the same reason.
  const orientation = raw.orientation ?? DEFAULT_ORIENTATION
  if (!isOrientation(orientation)) return null
  // And for the text scale: absent (or null, like the orientation) is ×1,
  // present-but-wrong is refused.
  const textScale = parseTextScale(raw.textScale ?? undefined)
  if (textScale === null) return null
  // The throttle likewise: absent or null is none, present-but-wrong is refused.
  const throttle = raw.throttle ?? DEFAULT_THROTTLE
  if (!isThrottleId(throttle)) return null
  // And the onion skin: absent is off.
  const onionSkin = raw.onionSkin ?? DEFAULT_ONION_SKIN
  if (!isOnionSkin(onionSkin)) return null
  // And for the viewer simulation.
  const visionType = raw.visionType ?? 'none'
  if (!isVisionType(visionType)) return null
  const visionSeverity = raw.visionSeverity ?? 1
  if (typeof visionSeverity !== 'number' || !(visionSeverity >= 0 && visionSeverity <= 1)) return null
  return {
    tabId,
    presetId,
    profileId,
    viewMode,
    panes,
    visionType,
    visionSeverity,
    orientation,
    textScale,
    throttle,
    onionSkin,
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
 * A `scroll` command payload: either an absolute offset, or a page-wise
 * `{ page }` request (a screenful of the scroller, or an end — `x`/`y` are
 * placeholders in that case, resolved against whatever scroller the preload
 * picks). Either way `scrollSelector` is the optional escape hatch, handed to
 * `document.querySelector` in the preload's isolated world — never evaluated —
 * but still bounded and type-checked here so a malformed one is refused with
 * an explanation rather than silently ignored by the page. Returns the parsed
 * request, or the error message.
 */
export function parseScrollRequest(raw: unknown): ScrollRequest | string {
  if (!isRecord(raw)) return 'scroll payload must be an object'
  const page = raw.page
  const hasOffsets = raw.x !== undefined || raw.y !== undefined
  if (page !== undefined) {
    if (!(SCROLL_PAGES as readonly unknown[]).includes(page)) return `scroll page must be one of ${SCROLL_PAGES.join(', ')}`
    if (hasOffsets) return 'scroll takes either { page } or { x, y }, not both'
  }
  const pos = page !== undefined ? { x: 0, y: 0 } : parseScrollPos(raw)
  if (!pos) return 'scroll payload must be { x, y } with finite, non-negative CSS-pixel offsets, or { page }'
  const out: ScrollRequest = { ...pos, ...(page !== undefined ? { page: page as ScrollPage } : {}) }
  const selector = raw.scrollSelector
  if (selector === undefined || selector === null) return out
  if (typeof selector !== 'string') return 'scrollSelector must be a CSS selector string'
  const trimmed = selector.trim()
  if (trimmed === '') return 'scrollSelector must not be empty'
  if (trimmed.length > MAX_SCROLL_SELECTOR) return `scrollSelector must be at most ${MAX_SCROLL_SELECTOR} characters`
  return { ...out, selector: trimmed }
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
  // Every optional field below is optional for the same reason: an older
  // preload sends none of them, and the walk then says less rather than
  // guessing. Note what that means for this function — it is a whitelist, so
  // a field added to `ScrollReport` and to the preload and forwarded by the
  // control server still arrives as `undefined` until it is named *here*, and
  // the caller downstream cannot tell that from a page where the measurement
  // came back false. `panel` and `blocked` were both in that state until
  // 2026-09-14: measured, forwarded, and dropped in the middle.
  return {
    id,
    x,
    y,
    scroller,
    warnings,
    atEnd: raw.atEnd === true,
    ...(typeof raw.hidden === 'boolean' ? { hidden: raw.hidden } : {}),
    ...(typeof raw.panel === 'boolean' ? { panel: raw.panel } : {}),
    ...(typeof raw.dialog === 'boolean' ? { dialog: raw.dialog } : {}),
    ...(parseWalkBlocked(raw.blocked) ?? {}),
    // The whitelist again: sent by the preload and forwarded by the control
    // server, and still undefined downstream until it is named here.
    ...(isFiniteNumber(raw.pageHeight) && raw.pageHeight >= 0 ? { pageHeight: raw.pageHeight } : {}),
  }
}

/**
 * The counts a blocked walk measured, as a field of the report rather than as
 * two numbers a sentence guesses at. Both are counts of things in the
 * viewport, so both are bounded well below any sane page; the clamp is here
 * because this crosses into main from a renderer, like everything else in
 * this file.
 */
function parseWalkBlocked(raw: unknown): { blocked: WalkBlocked } | null {
  if (!isRecord(raw)) return null
  const blocked: WalkBlocked = {}
  const { frames, shadowHosts } = raw
  if (isRecord(frames) && isFiniteNumber(frames.count) && isFiniteNumber(frames.viewportCoverage)) {
    blocked.frames = {
      count: clampCount(frames.count),
      // A fraction of the viewport, so out of range is a bug rather than a
      // big page: clamped, not rejected, since the sentence only asks whether
      // it is over half.
      viewportCoverage: Math.max(0, Math.min(1, frames.viewportCoverage)),
    }
  }
  if (isFiniteNumber(shadowHosts)) blocked.shadowHosts = clampCount(shadowHosts)
  // Both fields are optional on `WalkBlocked`, so an empty object would be a
  // measurement that says nothing while looking like one that was taken.
  return blocked.frames === undefined && blocked.shadowHosts === undefined ? null : { blocked }
}

const clampCount = (n: number): number => Math.max(0, Math.min(Math.round(n), MAX_BLOCKED_COUNT))
const MAX_BLOCKED_COUNT = 10_000

/** Rows in one menu, and characters in a label. A renderer bug should not be
 *  able to ask main to hold an unbounded payload. */
// A thousand rather than a couple of hundred since a page's own <select>
// flows through here too (see shared/selectPopup.ts), and a country list is
// ~250 rows.
const MAX_MENU_OPTIONS = 1000
const MAX_MENU_LABEL = 120

/**
 * The menu the chrome is asking the overlay to draw. Validated like anything
 * else crossing into main: the two sides are separate web contents, and main is
 * the only thing standing between them.
 */
/** The rows of a menu: bounded in count and label length, at least one row. */
function parseMenuGroups(groups: unknown): MenuGroup[] | null {
  if (!Array.isArray(groups)) return null
  const out: MenuGroup[] = []
  let rows = 0
  for (const g of groups) {
    if (!isRecord(g)) return null
    if (g.label !== undefined && (typeof g.label !== 'string' || g.label.length > MAX_MENU_LABEL)) return null
    if (!Array.isArray(g.options)) return null
    const options: MenuOption[] = []
    for (const o of g.options) {
      if (!isRecord(o)) return null
      if (typeof o.value !== 'string' || o.value.length > MAX_MENU_LABEL) return null
      if (typeof o.label !== 'string' || o.label.length > MAX_MENU_LABEL) return null
      if (++rows > MAX_MENU_OPTIONS) return null
      options.push({ value: o.value, label: o.label })
    }
    out.push(g.label === undefined ? { options } : { label: g.label, options })
  }
  if (rows === 0) return null
  return out
}

/**
 * A `<select>` popup request off the target preload (see
 * shared/selectPopup.ts). The rect is the page's own and may be fractional;
 * `parseRect` rounds it like any pane rect. The index may be -1 (nothing
 * selected) and is otherwise a non-negative integer.
 */
export function parseSelectOpen(raw: unknown): SelectOpen | null {
  if (!isRecord(raw)) return null
  const { id, rect, selectedIndex, ariaLabel, groups } = raw
  if (!isFiniteNumber(id) || !Number.isInteger(id) || id < 1) return null
  const box = parseRect(rect)
  if (!box) return null
  if (!isFiniteNumber(selectedIndex) || !Number.isInteger(selectedIndex) || selectedIndex < -1) return null
  if (typeof ariaLabel !== 'string' || ariaLabel.length > MAX_MENU_LABEL) return null
  const out = parseMenuGroups(groups)
  if (!out) return null
  return { id, rect: box, selectedIndex, ariaLabel, groups: out }
}

/** The chrome's answer to a select popup: a row index, or null for a dismissal. */
export function parseSelectResult(raw: unknown): SelectResult | null {
  if (!isRecord(raw)) return null
  const { tabId, id, index } = raw
  if (typeof tabId !== 'string' || tabId.length === 0 || tabId.length > MAX_MENU_LABEL) return null
  if (!isFiniteNumber(id) || !Number.isInteger(id) || id < 1) return null
  if (index !== null && (!isFiniteNumber(index) || !Number.isInteger(index) || index < 0)) return null
  return { tabId, id, index }
}

const pickerText = (v: unknown): string | null => (typeof v === 'string' && v.length <= MAX_PICKER_VALUE ? v : null)

/** A picker request from the target preload; the rect is rounded like any pane rect. */
export function parsePickerOpen(raw: unknown): PickerOpen | null {
  if (!isRecord(raw)) return null
  const { id, rect, type, value, min, max, step, ariaLabel } = raw
  if (!isFiniteNumber(id) || !Number.isInteger(id) || id < 1) return null
  const box = parseRect(rect)
  if (!box) return null
  if (typeof type !== 'string' || !isPickerType(type)) return null
  const v = pickerText(value)
  const lo = pickerText(min)
  const hi = pickerText(max)
  const st = pickerText(step)
  if (v === null || lo === null || hi === null || st === null) return null
  if (typeof ariaLabel !== 'string' || ariaLabel.length > MAX_MENU_LABEL) return null
  return { id, rect: box, type, value: v, min: lo, max: hi, step: st, ariaLabel }
}

/** The chrome's request to host a picker: a `PickerOpen` on a tab, anchored in window coordinates. */
export function parsePickerRequest(raw: unknown): PickerRequest | null {
  if (!isRecord(raw)) return null
  const { tabId, anchor } = raw
  if (typeof tabId !== 'string' || tabId.length === 0 || tabId.length > MAX_MENU_LABEL) return null
  const open = parsePickerOpen({ ...raw, rect: anchor })
  if (!open) return null
  const { rect, ...rest } = open
  return { tabId, ...rest, anchor: rect }
}

/** What the hosted input took: a bounded value and whether the picker committed. */
export function parsePickerEvent(raw: unknown): PickerEvent | null {
  if (!isRecord(raw)) return null
  const { value, done } = raw
  const v = pickerText(value)
  if (v === null || typeof done !== 'boolean') return null
  return { value: v, done }
}

export function parseMenuRequest(raw: unknown): MenuRequest | null {
  if (!isRecord(raw)) return null
  const { groups, value, ariaLabel, anchor } = raw
  if (typeof value !== 'string' || value.length > MAX_MENU_LABEL) return null
  if (typeof ariaLabel !== 'string' || ariaLabel.length > MAX_MENU_LABEL) return null
  const rect = parseRect(anchor)
  if (!rect) return null
  const out = parseMenuGroups(groups)
  if (!out) return null
  return { groups: out, value, ariaLabel, anchor: rect }
}
