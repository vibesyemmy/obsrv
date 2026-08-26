import { create } from 'zustand'
import {
  clampViewport,
  computeScale,
  maxCssViewport,
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
import type { AgentHighlight } from '../../../shared/control'
import type { HostInfo, LoadError, PanelParams, PanelProfile, Settings, UpdateState } from '../../../shared/types'

export type Mode = 'url' | 'image'

/** How the target pane shows the render: at 1:1, or scaled down to fit the pane. */
export type ViewMode = '1:1' | 'fit'

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
  /**
   * The advanced sliders' hand-tuned profile (`id: 'custom'`), in the same
   * human units as a preset profile; null means "follow `profileId`".
   */
  profileOverride: PanelProfile | null
  settings: Settings
  host: HostInfo
  targetLoading: boolean
  error: LoadError | null
  toast: string | null
  /** Null until the first `getUpdate` resolves; main seeds a real value. */
  update: UpdateState | null
  image: ImageState | null
  surround: Surround
  viewMode: ViewMode
  /**
   * The magnification fit mode is actually drawing at, published by
   * `TargetCanvas` (it owns the pane measurement) so the footer can read it;
   * null outside fit mode.
   */
  fitScale: number | null
  /**
   * A pending agent-control `panTo`: centre this target pixel in the pane's
   * 1:1 view. `TargetCanvas` (which owns the pane measurement and scale)
   * applies it and clears it; `seq` distinguishes repeated requests for the
   * same pixel.
   */
  agentPan: { x: number; y: number; seq: number } | null
  /**
   * The agent-control highlight currently showing over the target canvas;
   * a new one replaces the previous (fresh `seq` restarts the lifetime).
   */
  agentHighlight: (AgentHighlight & { seq: number }) | null

  setMode(mode: Mode): void
  setUrl(url: string): void
  setPreset(id: string): void
  setCustom(c: Partial<TargetScreen>): void
  setPixelExact(v: boolean): void
  setProfile(id: string): void
  setProfileOverride(p: PanelProfile | null): void
  setSettings(s: Settings): void
  setHost(h: HostInfo): void
  setTargetLoading(v: boolean): void
  setError(e: LoadError | null): void
  setUpdate(u: UpdateState | null): void
  setToast(t: string | null): void
  setImage(i: ImageState | null): void
  setSurround(s: Surround): void
  setViewMode(v: ViewMode): void
  setFitScale(v: number | null): void
  requestAgentPan(p: { x: number; y: number }): void
  clearAgentPan(): void
  showAgentHighlight(h: AgentHighlight): void
  /**
   * With `seq`, clears only the highlight it names — the expiry timer's
   * guard, so a timeout that fires as a replacement lands never removes the
   * newer highlight. Without `seq`, clears unconditionally.
   */
  clearAgentHighlight(seq?: number): void
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
  presetId: '1080p-24',
  custom: { width: 1920, height: 1080, diagonalInches: 24 },
  pixelExact: false,
  profileId: PANEL_PROFILES[0]!.id,
  profileOverride: null,
  settings: { ...DEFAULT_SETTINGS },
  // Zeroes until the first `getHostInfo`; `selectScale` falls back meanwhile.
  host: { physicalWidth: 0, physicalHeight: 0, scaleFactor: 0 },
  targetLoading: false,
  error: null,
  toast: null,
  update: null,
  image: null,
  surround: 'graphite',
  viewMode: '1:1',
  fitScale: null,
  agentPan: null,
  agentHighlight: null,

  // Does not clear `error`: a failed load navigates to Chromium's error page,
  // so clearing here would wipe the toolbar badge the moment it appeared.
  // Does clear the agent highlight: it marked pixels of the page that was
  // showing, and a committed navigation (a reload included) replaces them.
  setUrl: url => set({ url, agentHighlight: null }),
  // A screen change re-rasters the target, so a highlight's target-pixel rect
  // no longer marks what it marked; the same for the custom fields below.
  setPreset: presetId => set({ presetId, agentHighlight: null }),
  setCustom: c => set(s => ({ custom: { ...s.custom, ...c }, presetId: CUSTOM_PRESET_ID, agentHighlight: null })),
  setPixelExact: pixelExact => set({ pixelExact }),
  // Picking a profile drops any hand-tuned slider values.
  setProfile: profileId => set({ profileId, profileOverride: null }),
  setProfileOverride: profileOverride => set({ profileOverride }),
  setSettings: settings => set({ settings }),
  setHost: host => set({ host }),
  setTargetLoading: targetLoading => set({ targetLoading }),
  // Both panes report the same `loadError` for one failed navigation; the
  // duplicate must not replace the object and re-render everything twice.
  setError: error => set(s => (sameError(s.error, error) ? {} : { error })),
  setUpdate: update => set({ update }),
  setToast: toast => set({ toast }),
  setImage: image => set({ image }),
  setSurround: surround => set({ surround }),
  setViewMode: viewMode => set({ viewMode }),
  setFitScale: fitScale => set({ fitScale }),
  requestAgentPan: p => set(s => ({ agentPan: { ...p, seq: (s.agentPan?.seq ?? 0) + 1 } })),
  clearAgentPan: () => set({ agentPan: null }),
  showAgentHighlight: h => set(s => ({ agentHighlight: { ...h, seq: (s.agentHighlight?.seq ?? 0) + 1 } })),
  clearAgentHighlight: seq =>
    set(s => (seq === undefined || s.agentHighlight?.seq === seq ? { agentHighlight: null } : {})),

  // Spec §7: leaving image mode restores the URL that was showing before.
  // Either direction swaps what the target pane shows, so a highlight over
  // the old content is dropped with it.
  setMode: mode =>
    set(s =>
      mode === s.mode
        ? {}
        : mode === 'image'
          ? { mode, lastUrl: s.url, agentHighlight: null }
          : { mode, url: s.lastUrl, image: null, agentHighlight: null },
    ),
}))

export function selectScreen(s: AppState): TargetScreen {
  const preset = SCREEN_PRESETS.find(p => p.id === s.presetId)
  return preset
    ? {
        width: preset.width,
        height: preset.height,
        diagonalInches: preset.diagonalInches,
        deviceScaleFactor: preset.deviceScaleFactor,
      }
    : s.custom
}

/**
 * Device pixels per CSS pixel of the target screen: 1 for every monitor
 * preset and the custom entry, the real 2x/3x factor for mobile presets.
 */
export function selectDeviceScaleFactor(s: AppState): number {
  return selectScreen(s).deviceScaleFactor ?? 1
}

/** The 1x viewport handed to `TargetSource`; `clamped` drives the §9 warning. */
export function selectViewport(s: AppState): {
  width: number
  height: number
  clamped: boolean
} {
  const screen = selectScreen(s)
  // The 4096 limit is on *device* pixels, so the CSS budget shrinks with the
  // device scale factor (393x852 at 3x = 1179x2556 device pixels, fits).
  return clampViewport(screen.width, screen.height, maxCssViewport(screen.deviceScaleFactor ?? 1))
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

/** The host's peak brightness for the panel maths; never non-positive. */
export function selectHostNits(s: AppState): number {
  // `profileToParams` throws on a non-positive nits; settings arrive validated
  // from main, but a selector must never throw, so fall back to the default.
  return s.settings.hostNits > 0 ? s.settings.hostNits : DEFAULT_SETTINGS.hostNits
}

/** The profile the target pane is simulating: the sliders' custom one, else the chosen preset. */
export function selectProfile(s: AppState): PanelProfile {
  return s.profileOverride ?? findProfile(s.profileId)
}

export function selectPanelParams(s: AppState): PanelParams {
  return profileToParams(selectProfile(s), selectHostNits(s))
}

/** Spec §7: the URL bar shows the filename, read-only, while in image mode. */
export function selectUrlBarText(s: AppState): string {
  return s.mode === 'image' ? (s.image?.name ?? '') : s.url
}
