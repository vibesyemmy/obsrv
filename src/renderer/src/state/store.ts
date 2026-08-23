import { create } from 'zustand'
import {
  clampViewport,
  computeScale,
  type HostDisplay,
  type TargetScreen,
} from '../../../shared/calibration'
import { profileToParams } from '../../../shared/panelSim'
import {
  DEFAULT_SETTINGS,
  PANEL_PROFILES,
  SCREEN_PRESETS,
  findProfile,
} from '../../../shared/presets'
import type { HostInfo, LoadError, PanelParams, Settings } from '../../../shared/types'

export type Mode = 'url' | 'image'

/** The neutral field the panes sit in. Graphite by default; see the UI spec. */
export type Surround = 'black' | 'graphite' | 'grey50'

/** `presetId` when the screen comes from the custom fields instead. */
export const CUSTOM_PRESET_ID = 'custom'

/** Spec §9: with no usable display information, fall back to a flat 2x. */
export const FALLBACK_SCALE = 2

export interface ImageState {
  name: string
  /** Export scale the file was rendered at (1, 2 or 3). */
  exportScale: number
  /** Dimensions after downsampling to 1x. */
  width: number
  height: number
}

export interface AppState {
  mode: Mode
  url: string
  /** URL parked while image mode is showing, restored on the way back. */
  lastUrl: string
  presetId: string
  custom: TargetScreen
  pixelExact: boolean
  profileId: string
  /** Advanced sliders; null means "follow the profile". */
  paramsOverride: PanelParams | null
  settings: Settings
  host: HostInfo
  targetLoading: boolean
  error: LoadError | null
  toast: string | null
  image: ImageState | null
  surround: Surround

  setMode(mode: Mode): void
  setUrl(url: string): void
  setPreset(id: string): void
  setCustom(c: Partial<TargetScreen>): void
  setPixelExact(v: boolean): void
  setProfile(id: string): void
  setParamsOverride(p: PanelParams | null): void
  setSettings(s: Settings): void
  setHost(h: HostInfo): void
  setTargetLoading(v: boolean): void
  setError(e: LoadError | null): void
  setToast(t: string | null): void
  setImage(i: ImageState | null): void
  setSurround(s: Surround): void
}

function sameError(a: LoadError | null, b: LoadError | null): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  return a.code === b.code && a.url === b.url && a.description === b.description
}

export const useStore = create<AppState>()(set => ({
  mode: 'url',
  url: '',
  lastUrl: '',
  presetId: SCREEN_PRESETS[0]!.id,
  custom: { width: 1920, height: 1080, diagonalInches: 24 },
  pixelExact: false,
  profileId: PANEL_PROFILES[0]!.id,
  paramsOverride: null,
  settings: { ...DEFAULT_SETTINGS },
  // Zeroes until the first `getHostInfo`; `selectScale` falls back meanwhile.
  host: { physicalWidth: 0, physicalHeight: 0, scaleFactor: 0 },
  targetLoading: false,
  error: null,
  toast: null,
  image: null,
  surround: 'graphite',

  // Does not clear `error`: a failed load navigates to Chromium's error page,
  // so clearing here would wipe the toolbar badge the moment it appeared.
  setUrl: url => set({ url }),
  setPreset: presetId => set({ presetId }),
  setCustom: c => set(s => ({ custom: { ...s.custom, ...c }, presetId: CUSTOM_PRESET_ID })),
  setPixelExact: pixelExact => set({ pixelExact }),
  // Picking a profile drops any hand-tuned slider values.
  setProfile: profileId => set({ profileId, paramsOverride: null }),
  setParamsOverride: paramsOverride => set({ paramsOverride }),
  setSettings: settings => set({ settings }),
  setHost: host => set({ host }),
  setTargetLoading: targetLoading => set({ targetLoading }),
  // Both panes report the same `loadError` for one failed navigation; the
  // duplicate must not replace the object and re-render everything twice.
  setError: error => set(s => (sameError(s.error, error) ? {} : { error })),
  setToast: toast => set({ toast }),
  setImage: image => set({ image }),
  setSurround: surround => set({ surround }),

  // Spec §7: leaving image mode restores the URL that was showing before.
  setMode: mode =>
    set(s =>
      mode === s.mode
        ? {}
        : mode === 'image'
          ? { mode, lastUrl: s.url }
          : { mode, url: s.lastUrl, image: null },
    ),
}))

export function selectScreen(s: AppState): TargetScreen {
  const preset = SCREEN_PRESETS.find(p => p.id === s.presetId)
  return preset
    ? { width: preset.width, height: preset.height, diagonalInches: preset.diagonalInches }
    : s.custom
}

/** The 1x viewport handed to `TargetSource`; `clamped` drives the §9 warning. */
export function selectViewport(s: AppState): {
  width: number
  height: number
  clamped: boolean
} {
  const screen = selectScreen(s)
  return clampViewport(screen.width, screen.height)
}

/**
 * The calibrated magnification, or `null` when the inputs cannot support one:
 * host unknown, a zero diagonal, a half-typed custom field, a non-finite
 * result. `ppi` throws on a bad diagonal and `GlRenderer.draw` refuses a scale
 * that is not finite and positive, so every guard lives here, once.
 */
function calibratedScale(s: AppState): number | null {
  if (s.host.physicalWidth <= 0 || s.host.physicalHeight <= 0 || s.host.scaleFactor <= 0) return null
  if (!(s.settings.hostDiagonalInches > 0)) return null
  const screen = selectScreen(s)
  if (!(screen.diagonalInches > 0) || !(screen.width > 0) || !(screen.height > 0)) return null
  const host: HostDisplay = {
    physicalWidth: s.host.physicalWidth,
    physicalHeight: s.host.physicalHeight,
    diagonalInches: s.settings.hostDiagonalInches,
    scaleFactor: s.host.scaleFactor,
  }
  const scale = computeScale(host, screen, s.pixelExact)
  return Number.isFinite(scale) && scale > 0 ? scale : null
}

/** Magnification for the target pane. Always finite and positive (spec §9). */
export function selectScale(s: AppState): number {
  return calibratedScale(s) ?? FALLBACK_SCALE
}

/** Spec §9: true while the pane is drawn at the flat fallback, so Settings can say so. */
export function selectScaleIsFallback(s: AppState): boolean {
  return calibratedScale(s) === null
}

/** The host display's DPR; 1 until `getHostInfo` has answered. */
export function selectHostScaleFactor(s: AppState): number {
  return s.host.scaleFactor > 0 ? s.host.scaleFactor : 1
}

export function selectPanelParams(s: AppState): PanelParams {
  if (s.paramsOverride) return s.paramsOverride
  // `profileToParams` throws on a non-positive nits; settings arrive validated
  // from main, but a selector must never throw, so fall back to the default.
  const nits = s.settings.hostNits > 0 ? s.settings.hostNits : DEFAULT_SETTINGS.hostNits
  return profileToParams(findProfile(s.profileId), nits)
}

/** Spec §7: the URL bar shows the filename, read-only, while in image mode. */
export function selectUrlBarText(s: AppState): string {
  return s.mode === 'image' ? (s.image?.name ?? '') : s.url
}
