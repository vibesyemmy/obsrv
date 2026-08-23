export interface ScreenPreset {
  id: string
  label: string
  width: number
  height: number
  diagonalInches: number
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
export type InputModifier = 'shift' | 'control' | 'alt' | 'meta'

export type TargetInputEvent =
  | { type: 'mouseDown' | 'mouseUp' | 'mouseMove'; x: number; y: number; button: 'left' | 'middle' | 'right'; clickCount: number; modifiers: InputModifier[] }
  | { type: 'mouseWheel'; x: number; y: number; deltaX: number; deltaY: number; modifiers: InputModifier[] }
  | { type: 'keyDown' | 'keyUp' | 'char'; keyCode: string; modifiers: InputModifier[] }

export interface LoadError {
  code: number
  description: string
  url: string
}
