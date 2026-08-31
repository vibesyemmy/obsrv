import { create } from 'zustand'
import {
  applyOrientation,
  clampViewport,
  computeScale,
  maxCssViewport,
  screenShape,
  type HostDisplay,
  type TargetScreen,
} from '../../../shared/calibration'
import { profileToParams } from '../../../shared/panelSim'
import {
  DEFAULT_ORIENTATION,
  DEFAULT_SETTINGS,
  PANEL_PROFILES,
  SCREEN_PRESETS,
  findProfile,
} from '../../../shared/presets'
import { canAddTab, closeTab as closeInList, type TabSnapshot } from '../../../shared/tabList'
import type { AgentHighlight } from '../../../shared/control'
import type { HistoryEntry } from '../../../shared/history'
import type { HostInfo, LoadError, Orientation, PanelParams, PanelProfile, Settings, UpdateState } from '../../../shared/types'
import type { VisionType } from '../../../shared/vision'

export type Mode = 'url' | 'image'

/** How the target pane shows the render: at 1:1, or scaled down to fit the pane. */
export type ViewMode = '1:1' | 'fit'

/** The neutral field the panes sit in. Graphite by default; see the UI spec. */
export type Surround = 'black' | 'graphite' | 'grey50'

/** Whether the native pane shares the window, or the target render has it alone. */
export type Panes = 'both' | 'target'

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

/**
 * One session: the page, the screen it is being shown on, and what the target
 * pane is currently doing with it. Everything here is per tab — two tabs hold
 * two of these and neither sees the other's.
 */
export interface TabState {
  mode: Mode
  url: string
  /**
   * Chromium's page title, as main reports it for this tab; '' when the page
   * has none. The strip prefers it, then the host, then the URL — see
   * `tabTitle`. Main clears it on every committed navigation, so a tab never
   * wears the previous page's title.
   */
  title: string
  /** URL parked while image mode is showing, restored on the way back. */
  lastUrl: string
  presetId: string
  /**
   * Which way round the chosen screen is held. Applied on top of the preset
   * rather than baked into it — `SCREEN_PRESETS` keeps its natural dimensions
   * and `selectScreen` is the one place the axes swap.
   */
  orientation: Orientation
  custom: TargetScreen
  pixelExact: boolean
  visionType: VisionType
  /** 0..1; 1 is the dichromat end. */
  visionSeverity: number
  profileId: string
  /**
   * The advanced sliders' hand-tuned profile (`id: 'custom'`), in the same
   * human units as a preset profile; null means "follow `profileId`".
   */
  profileOverride: PanelProfile | null
  targetLoading: boolean
  error: LoadError | null
  image: ImageState | null
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
}

export interface AppState {
  /** Every open session by id. Always non-empty, and always holds `activeId`. */
  tabs: Record<string, TabState>
  /** Strip order — `tabs` is a record, so the order the user sees lives here. */
  tabOrder: string[]
  /** The tab every per-tab action writes and every selector reads. */
  activeId: string
  settings: Settings
  host: HostInfo
  toast: string | null
  /** Null until the first `getUpdate` resolves; main seeds a real value. */
  update: UpdateState | null
  /**
   * Every remembered address, ranked, as main last published it. The URL bar
   * matches against this locally so a keystroke costs no IPC; main owns the
   * file and pushes the whole list whenever it changes.
   */
  history: HistoryEntry[]
  surround: Surround
  /**
   * Native-only is deliberately not offered: that is a browser, and the user
   * has one. Not persisted to settings — a per-look toggle like `viewMode`.
   */
  panes: Panes
  /** The settings modal is covering the panes, so the native view steps aside. */
  nativeObscured: boolean

  setMode(mode: Mode): void
  setUrl(url: string): void
  /**
   * The tab-named forms of the four reports main pushes. Main no longer gates
   * those on the tab being in front — a background tab has to keep its own
   * strip entry current — so the renderer writes the tab that was *named*,
   * never the tab that happens to be showing. The unnamed forms above stay for
   * the toolbar, which only ever acts on the tab in front.
   */
  setTabUrl(id: string, url: string): void
  setTabTitle(id: string, title: string): void
  setTabError(id: string, e: LoadError | null): void
  setTabLoading(id: string, v: boolean): void
  setPreset(id: string): void
  setOrientation(o: Orientation): void
  setCustom(c: Partial<TargetScreen>): void
  setPixelExact(v: boolean): void
  setVision(type: VisionType, severity: number): void
  setProfile(id: string): void
  setProfileOverride(p: PanelProfile | null): void
  setSettings(s: Settings): void
  setHost(h: HostInfo): void
  setTargetLoading(v: boolean): void
  setError(e: LoadError | null): void
  setUpdate(u: UpdateState | null): void
  setHistory(h: HistoryEntry[]): void
  setToast(t: string | null): void
  setImage(i: ImageState | null): void
  setSurround(s: Surround): void
  setViewMode(v: ViewMode): void
  setPanes(p: Panes): void
  setNativeObscured(v: boolean): void
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

  /**
   * Adopts main's strip wholesale: main owns tab identity (a tab is the pair
   * of Chromium renderers it built), so the list, the order and which tab is
   * in front all come from there. Per-tab UI state is the renderer's own and
   * survives — a tab that is still open keeps its preset, profile and view
   * mode; a tab main has never mentioned opens blank.
   */
  syncTabs(s: TabSnapshot): void
  /**
   * Opens a blank tab at the end of the strip and switches to it, returning
   * its id — or null when `settings.maxTabs` is already reached, mirroring
   * the main process's `TabManager.add`. `id` adopts an id minted elsewhere
   * (main mints the session's), so the two sides can name the same tab.
   */
  addTab(id?: string): string | null
  /**
   * Closes a tab, moving focus the way `tabList.closeTab` says. Closing the
   * last one leaves a fresh blank tab rather than no tab: the window is the
   * app, and an empty app with no way back is a trap.
   */
  closeTab(id: string): void
  activateTab(id: string): void
}

function sameError(a: LoadError | null, b: LoadError | null): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  return a.code === b.code && a.url === b.url && a.description === b.description
}

/** A session as it opens: no page, the first preset, the reference profile. */
function blankTab(): TabState {
  return {
    mode: 'url',
    url: '',
    title: '',
    lastUrl: '',
    presetId: '1080p-24',
    orientation: DEFAULT_ORIENTATION,
    custom: { width: 1920, height: 1080, diagonalInches: 24 },
    pixelExact: false,
    visionType: 'none',
    visionSeverity: 1,
    profileId: PANEL_PROFILES[0]!.id,
    profileOverride: null,
    targetLoading: false,
    error: null,
    image: null,
    // Fit, not 1:1: fit never enlarges past 1:1, so a render that already fits
    // its pane opens at true magnification anyway, while one that does not is
    // shown whole instead of as its top-left corner. Fit is interactive, so
    // this costs nothing — and the footer names the actual magnification
    // whenever fit is minifying.
    viewMode: 'fit',
    fitScale: null,
    agentPan: null,
    agentHighlight: null,
  }
}

/**
 * Ids the main process can never mint. The renderer makes one only for the tab
 * it opens with, before main's list has arrived; `addTab(id)` takes main's id
 * whenever there is one, and the first snapshot replaces this tab outright.
 *
 * Deliberately *not* main's `tab-N` shape. Sharing it made the boot tab's id
 * collide with main's first session, and `syncTabs` then read that session as
 * a tab it already knew — keeping its own blank screen instead of the one main
 * had just restored from disk, silently and only after a relaunch.
 */
let nextTabId = 0
function newTabId(): string {
  nextTabId += 1
  return `local-${nextTabId}`
}

/**
 * The one write path for per-tab state: `f` sees the active tab and returns
 * the fields to change, or null to write nothing at all (a duplicate that must
 * not replace the object and re-render everything twice).
 */
const patchActiveWith =
  (f: (t: TabState) => Partial<TabState> | null) =>
  (s: AppState): Partial<AppState> => {
    const active = s.tabs[s.activeId]!
    const patch = f(active)
    return patch === null ? {} : { tabs: { ...s.tabs, [s.activeId]: { ...active, ...patch } } }
  }

const patchActive = (patch: Partial<TabState>): ((s: AppState) => Partial<AppState>) =>
  patchActiveWith(() => patch)

/**
 * The same write path, for a tab named by main rather than the one in front.
 * A tab that is not open is not an error — a report can outlive the close that
 * raced it — so it writes nothing.
 */
const patchTabWith =
  (id: string, f: (t: TabState) => Partial<TabState> | null) =>
  (s: AppState): Partial<AppState> => {
    const t = s.tabs[id]
    if (!t) return {}
    const patch = f(t)
    return patch === null ? {} : { tabs: { ...s.tabs, [id]: { ...t, ...patch } } }
  }

const FIRST_TAB = newTabId()

export const useStore = create<AppState>()((set, get) => ({
  tabs: { [FIRST_TAB]: blankTab() },
  tabOrder: [FIRST_TAB],
  activeId: FIRST_TAB,
  settings: { ...DEFAULT_SETTINGS },
  // Zeroes until the first `getHostInfo`; `selectScale` falls back meanwhile.
  host: { physicalWidth: 0, physicalHeight: 0, scaleFactor: 0 },
  toast: null,
  update: null,
  history: [],
  surround: 'graphite',
  panes: 'both',
  nativeObscured: false,

  // Does not clear `error`: a failed load navigates to Chromium's error page,
  // so clearing here would wipe the toolbar badge the moment it appeared.
  // Does clear the agent highlight: it marked pixels of the page that was
  // showing, and a committed navigation (a reload included) replaces them.
  setUrl: url => set(s => patchTabWith(s.activeId, () => ({ url, agentHighlight: null }))(s)),
  setTabUrl: (id, url) => set(patchTabWith(id, () => ({ url, agentHighlight: null }))),
  setTabTitle: (id, title) => set(patchTabWith(id, t => (t.title === title ? null : { title }))),
  // Both panes report the same failure; see `setError`.
  setTabError: (id, error) => set(patchTabWith(id, t => (sameError(t.error, error) ? null : { error }))),
  setTabLoading: (id, targetLoading) => set(patchTabWith(id, () => ({ targetLoading }))),
  // A screen change re-rasters the target, so a highlight's target-pixel rect
  // no longer marks what it marked; the same for the custom fields below.
  setPreset: presetId => set(patchActive({ presetId, agentHighlight: null })),
  // A rotation re-rasters the target exactly as a preset change does, so a
  // highlight's target-pixel rect no longer marks what it marked. Setting the
  // orientation already in force writes nothing, so a re-report from an agent
  // (or a click on the pressed half of the control) costs no re-render.
  setOrientation: orientation =>
    set(patchActiveWith(t => (t.orientation === orientation ? null : { orientation, agentHighlight: null }))),
  setCustom: c =>
    set(patchActiveWith(t => ({ custom: { ...t.custom, ...c }, presetId: CUSTOM_PRESET_ID, agentHighlight: null }))),
  setPixelExact: pixelExact => set(patchActive({ pixelExact })),
  setVision: (visionType, visionSeverity) => set(patchActive({ visionType, visionSeverity })),
  // Picking a profile drops any hand-tuned slider values.
  setProfile: profileId => set(patchActive({ profileId, profileOverride: null })),
  setProfileOverride: profileOverride => set(patchActive({ profileOverride })),
  setSettings: settings => set({ settings }),
  setHost: host => set({ host }),
  setTargetLoading: targetLoading => set(patchActive({ targetLoading })),
  // Both panes report the same `loadError` for one failed navigation; the
  // duplicate must not replace the object and re-render everything twice.
  setError: error => set(patchActiveWith(t => (sameError(t.error, error) ? null : { error }))),
  setUpdate: update => set({ update }),
  setHistory: history => set({ history }),
  setToast: toast => set({ toast }),
  setImage: image => set(patchActive({ image })),
  setSurround: surround => set({ surround }),
  setViewMode: viewMode => set(patchActive({ viewMode })),
  // No `agentHighlight: null` here, unlike setPreset: hiding a pane does not
  // re-raster the target, so the highlight still marks the pixels it marked.
  setPanes: panes => set({ panes }),
  setNativeObscured: nativeObscured => set({ nativeObscured }),
  setFitScale: fitScale => set(patchActive({ fitScale })),
  requestAgentPan: p => set(patchActiveWith(t => ({ agentPan: { ...p, seq: (t.agentPan?.seq ?? 0) + 1 } }))),
  clearAgentPan: () => set(patchActive({ agentPan: null })),
  showAgentHighlight: h =>
    set(patchActiveWith(t => ({ agentHighlight: { ...h, seq: (t.agentHighlight?.seq ?? 0) + 1 } }))),
  clearAgentHighlight: seq =>
    set(patchActiveWith(t => (seq === undefined || t.agentHighlight?.seq === seq ? { agentHighlight: null } : null))),

  // Spec §7: leaving image mode restores the URL that was showing before.
  // Either direction swaps what the target pane shows, so a highlight over
  // the old content is dropped with it.
  setMode: mode =>
    set(
      patchActiveWith(t =>
        mode === t.mode
          ? null
          : mode === 'image'
            ? { mode, lastUrl: t.url, agentHighlight: null }
            : { mode, url: t.lastUrl, image: null, agentHighlight: null },
      ),
    ),

  syncTabs: snap =>
    set(s => {
      // Main always holds at least one session, so an empty list is a message
      // that cannot be true; taking it would leave the renderer with no active
      // tab and every selector reading through `undefined`.
      if (snap.tabs.length === 0) return {}
      const tabs: Record<string, TabState> = {}
      for (const info of snap.tabs) {
        const existing = s.tabs[info.id]
        tabs[info.id] = existing
          ? // url and title are main's to know — it is what every tab's panes
            // report to — so the snapshot is authoritative for those two and
            // for nothing else.
            existing.url === info.url && existing.title === info.title
            ? existing
            : { ...existing, url: info.url, title: info.title }
          : // A tab the renderer has never seen. Its screen comes from the
            // snapshot rather than from `blankTab`'s defaults, because main
            // may have restored it from disk with a preset chosen in a
            // previous launch — and for a tab genuinely opened just now, the
            // session's own defaults are those same defaults.
            {
              ...blankTab(),
              url: info.url,
              title: info.title,
              presetId: info.presetId,
              profileId: info.profileId,
              orientation: info.orientation,
            }
      }
      const tabOrder = snap.tabs.map(t => t.id)
      return { tabs, tabOrder, activeId: tabs[snap.activeId] ? snap.activeId : tabOrder[0]! }
    }),

  addTab: id => {
    const s = get()
    if (!canAddTab(s.tabOrder.length, s.settings.maxTabs)) return null
    const next = id ?? newTabId()
    // An id already open is that tab, not a second one; switch to it instead
    // of overwriting a live session with a blank.
    if (s.tabs[next]) {
      set({ activeId: next })
      return next
    }
    set({ tabs: { ...s.tabs, [next]: blankTab() }, tabOrder: [...s.tabOrder, next], activeId: next })
    return next
  },

  closeTab: id =>
    set(s => {
      if (!s.tabs[id]) return {}
      const result = closeInList(
        s.tabOrder.map(tabId => ({ id: tabId })),
        id,
        s.activeId,
      )
      if (result.activeId === null) {
        const fresh = newTabId()
        return { tabs: { [fresh]: blankTab() }, tabOrder: [fresh], activeId: fresh }
      }
      const tabs = { ...s.tabs }
      delete tabs[id]
      return { tabs, tabOrder: result.tabs.map(t => t.id), activeId: result.activeId }
    }),

  activateTab: id => set(s => (s.tabs[id] ? { activeId: id } : {})),

}))

/** The session every per-tab selector reads through. Never undefined. */
export function selectTab(s: AppState): TabState {
  return s.tabs[s.activeId]!
}

/**
 * The screen the target pane is simulating, as it is actually being held.
 * Orientation is applied here and nowhere else, so every selector below —
 * viewport, clamp, magnification — sees one already-rotated screen.
 */
function naturalScreen(s: AppState): TargetScreen {
  const tab = selectTab(s)
  const preset = SCREEN_PRESETS.find(p => p.id === tab.presetId)
  return preset
    ? {
        width: preset.width,
        height: preset.height,
        diagonalInches: preset.diagonalInches,
        deviceScaleFactor: preset.deviceScaleFactor,
      }
    : tab.custom
}

export function selectScreen(s: AppState): TargetScreen {
  return applyOrientation(naturalScreen(s), selectTab(s).orientation)
}

/**
 * The shape the target screen actually has, for anything the user reads. Not
 * the stored `orientation` flag: that means "the preset as stored" vs "rotated
 * a quarter turn", which for a landscape-natural monitor preset would put the
 * word "landscape" next to a portrait pair of numbers. What is on screen has
 * to agree with the pixels beside it.
 */
export function selectScreenShape(s: AppState): Orientation {
  const screen = selectScreen(s)
  return screenShape(screen.width, screen.height)
}

/** The two orientation flags, in the order the rotate control shows them. */
export const ORIENTATIONS: readonly Orientation[] = ['portrait', 'landscape']

/**
 * The shape each of `ORIENTATIONS` actually produces for the screen in force,
 * by the same index. The rotate control labels its buttons from this rather
 * than from the flag they write, so it can never put the word "landscape" on a
 * button that yields a portrait pair of numbers — which is exactly what a
 * rotated monitor preset does.
 *
 * Two plain strings, not two objects: this is read through `useShallow`, which
 * compares elements by identity, and a selector returning freshly-minted
 * objects would never compare equal and would re-render forever.
 */
export function selectOrientationShapes(s: AppState): Orientation[] {
  const natural = naturalScreen(s)
  return ORIENTATIONS.map(value => {
    const r = applyOrientation(natural, value)
    return screenShape(r.width, r.height)
  })
}

/**
 * Device pixels per CSS pixel of the target screen: 1 for every monitor
 * preset and the custom entry, the real 2x/3x factor for mobile presets.
 */
/**
 * Whether the tab's screen is a phone or a tablet, and so should be given
 * mobile browser fidelity — a mobile user agent and mobile viewport semantics.
 *
 * Read from the preset's group rather than inferred from its scale factor. The
 * two used to be conflated, which was harmless only while every laptop and
 * desktop preset happened to be 1x: a Retina laptop is dense *and* a desktop
 * browser, and a Windows panel at 150% scaling is 1.5x and not a phone at all.
 * A custom screen is whatever the user typed, so it is not a phone.
 */
export function selectIsMobileScreen(s: AppState): boolean {
  return SCREEN_PRESETS.find(p => p.id === selectTab(s).presetId)?.group === 'mobile'
}

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
  const scale = computeScale(host, screen, selectTab(s).pixelExact)
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
  const tab = selectTab(s)
  return tab.profileOverride ?? findProfile(tab.profileId)
}

export function selectPanelParams(s: AppState): PanelParams {
  return profileToParams(selectProfile(s), selectHostNits(s))
}

/** Spec §7: the URL bar shows the filename, read-only, while in image mode. */
export function selectUrlBarText(s: AppState): string {
  const tab = selectTab(s)
  return tab.mode === 'image' ? (tab.image?.name ?? '') : tab.url
}
