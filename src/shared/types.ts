export type PresetGroup = 'laptop' | 'desktop' | 'mobile'

export interface ScreenPreset {
  id: string
  label: string
  /** CSS-pixel viewport; the raster is `width x height` x `deviceScaleFactor`. */
  width: number
  height: number
  diagonalInches: number
  /** Device pixels per CSS pixel on the real screen; 1 for every 1x monitor. */
  deviceScaleFactor: number
  group: PresetGroup
}

export interface PanelProfile {
  id: string
  label: string
  /** null = no contrast limit (black stays black) */
  contrastRatio: number | null
  /** 0..1, fraction of sRGB covered; 1 = no desaturation */
  gamutCoverage: number
  bits: 6 | 8
  frc: boolean
  /** null = same as host (no brightness change) */
  nits: number | null
}

/** Resolved shader uniforms. */
export interface PanelParams {
  brightness: number
  blackFloor: number
  gamut: number
  levels: number
  dither: boolean
}

export interface HostInfo {
  physicalWidth: number
  physicalHeight: number
  scaleFactor: number
}

export interface Settings {
  hostDiagonalInches: number
  hostNits: number
  /**
   * Whether the loopback agent-control server runs (spec §14 "Live drive").
   * Off by default: the toolbar toggle turns it on, and
   * `OBSRV_AGENT_CONTROL=1` force-enables it for the session at boot.
   */
  agentControl: boolean
}

/** A dirty-rect slice of the 1x target frame. `data` is BGRA, row-major, no padding. */
export interface FrameSlice {
  x: number
  y: number
  width: number
  height: number
  data: Uint8Array
}

/** Subset of Electron's InputEvent modifiers that the app forwards. */
/**
 * Electron's `sendInputEvent` modifier names. The three `*ButtonDown` entries
 * carry the pressed-button state on `mouseMove`, which is how Chromium tells a
 * drag from a hover.
 */
export type InputModifier =
  | 'shift'
  | 'control'
  | 'alt'
  | 'meta'
  | 'leftButtonDown'
  | 'middleButtonDown'
  | 'rightButtonDown'

export type TargetInputEvent =
  | { type: 'mouseDown' | 'mouseUp' | 'mouseMove'; x: number; y: number; button: 'left' | 'middle' | 'right'; clickCount: number; modifiers: InputModifier[] }
  | { type: 'mouseWheel'; x: number; y: number; deltaX: number; deltaY: number; modifiers: InputModifier[] }
  | { type: 'keyDown' | 'keyUp' | 'char'; keyCode: string; modifiers: InputModifier[] }

export interface LoadError {
  code: number
  description: string
  url: string
}

/** Scroll offset in CSS pixels, mirrored between the panes. */
export interface ScrollPos {
  x: number
  y: number
}

/**
 * Which scroller a pane's sync preload actually moved: the document root, or
 * an inner `overflow-y: auto` container it had to find because the root had
 * nothing to scroll (the app-shell pattern — `html, body { overflow: hidden }`
 * with a scrolling flex child).
 */
export type ScrollerKind = 'root' | 'element'

/** Longest `scrollSelector` accepted; a CSS selector far beyond any real one. */
export const MAX_SCROLL_SELECTOR = 512

/**
 * What main sends a pane over `IPC.applyScroll`. `id` is the correlation id an
 * agent-driven scroll uses to await the offset actually reached; the pane-sync
 * mirror omits it and wants no reply. `selector` is the caller's escape hatch
 * for pages whose scroll host the heuristic misjudges.
 */
export interface ScrollRequest extends ScrollPos {
  id?: number
  selector?: string
}

/** A pane's `IPC.scrollResult` reply: the offset reached, read back after the write. */
export interface ScrollReport {
  id: number
  x: number
  y: number
  scroller: ScrollerKind
  warnings: string[]
}
