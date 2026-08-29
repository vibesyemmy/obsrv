import { describe, it, expect, beforeEach } from 'vitest'
import { profileToParams } from '../../src/shared/panelSim'
import { DEFAULT_SETTINGS, findProfile } from '../../src/shared/presets'
import { tabTitle } from '../../src/shared/tabList'
import {
  CUSTOM_PRESET_ID,
  FALLBACK_SCALE,
  selectDeviceScaleFactor,
  selectHostScaleFactor,
  selectPanelParams,
  selectScale,
  selectScaleIsFallback,
  selectScreen,
  selectScreenShape,
  selectTab,
  selectUrlBarText,
  selectViewport,
  useStore,
  type TabState,
} from '../../src/renderer/src/state/store'

const HOST_4K = { physicalWidth: 3840, physicalHeight: 2160, scaleFactor: 2 }
const initial = useStore.getState()

beforeEach(() => useStore.setState(initial, true))

/** The active tab, where every per-session field now lives. */
const tab = (): TabState => selectTab(useStore.getState())

/** Seeds per-session fields; plain `setState` still seeds the window globals. */
const setTab = (patch: Partial<TabState>): void =>
  useStore.setState(s => ({ tabs: { ...s.tabs, [s.activeId]: { ...selectTab(s), ...patch } } }))

describe('defaults', () => {
  it('starts on the first preset, the reference profile and default settings', () => {
    const s = useStore.getState()
    const t = tab()
    expect(t.mode).toBe('url')
    expect(t.presetId).toBe('1080p-24')
    expect(t.profileId).toBe('reference')
    expect(s.settings).toEqual(DEFAULT_SETTINGS)
    expect(t.profileOverride).toBeNull()
    expect(s.surround).toBe('graphite')
  })
})

describe('selectScale', () => {
  it('falls back to 2 while the host display is unknown', () => {
    expect(selectScale(useStore.getState())).toBe(FALLBACK_SCALE)
  })
  it('is exactly 2 for 1080p 27" on a 4K 27" host', () => {
    useStore.setState({ host: HOST_4K, settings: { hostDiagonalInches: 27, hostNits: 500 } })
    setTab({ presetId: '1080p-27' })
    expect(selectScale(useStore.getState())).toBeCloseTo(2, 10)
  })
  it('pixel-exact ignores physical size and uses the host scale factor', () => {
    useStore.setState({ host: HOST_4K })
    setTab({ presetId: 'laptop-768', pixelExact: true })
    expect(selectScale(useStore.getState())).toBe(2)
  })
  it('never yields a non-positive or non-finite scale', () => {
    useStore.setState({ host: HOST_4K })
    useStore.getState().setCustom({ width: 1920, height: 1080, diagonalInches: 0 })
    expect(selectScale(useStore.getState())).toBe(FALLBACK_SCALE)

    useStore.getState().setCustom({ diagonalInches: Number.NaN })
    expect(selectScale(useStore.getState())).toBe(FALLBACK_SCALE)

    useStore.setState({ settings: { hostDiagonalInches: 0, hostNits: 500 } })
    useStore.getState().setPreset('1080p-24')
    expect(selectScale(useStore.getState())).toBe(FALLBACK_SCALE)
  })
  it('says when the scale is the fallback rather than calibrated', () => {
    expect(selectScaleIsFallback(useStore.getState())).toBe(true)

    useStore.setState({ host: HOST_4K })
    setTab({ presetId: '1080p-27' })
    expect(selectScaleIsFallback(useStore.getState())).toBe(false)

    useStore.getState().setCustom({ width: 1920, height: 1080, diagonalInches: 0 })
    expect(selectScaleIsFallback(useStore.getState())).toBe(true)

    useStore.setState({ settings: { hostDiagonalInches: 0, hostNits: 500 } })
    setTab({ presetId: '1080p-27' })
    expect(selectScaleIsFallback(useStore.getState())).toBe(true)
  })
})

describe('selectDeviceScaleFactor', () => {
  it('is 1 for monitor presets and the custom screen', () => {
    expect(selectDeviceScaleFactor(useStore.getState())).toBe(1)
    useStore.getState().setCustom({ width: 800, height: 600, diagonalInches: 10 })
    expect(selectDeviceScaleFactor(useStore.getState())).toBe(1)
  })
  it('is the device factor for mobile presets', () => {
    setTab({ presetId: 'iphone-61' })
    expect(selectDeviceScaleFactor(useStore.getState())).toBe(3)
    setTab({ presetId: 'ipad-109' })
    expect(selectDeviceScaleFactor(useStore.getState())).toBe(2)
  })
})

describe('selectHostScaleFactor', () => {
  it('is 1 until the host is known, then the real DPR', () => {
    expect(selectHostScaleFactor(useStore.getState())).toBe(1)
    useStore.getState().setHost(HOST_4K)
    expect(selectHostScaleFactor(useStore.getState())).toBe(2)
  })
})

describe('selectViewport', () => {
  it('follows the chosen preset', () => {
    setTab({ presetId: '1440p-27' })
    expect(selectViewport(useStore.getState())).toEqual({
      width: 2560,
      height: 1440,
      clamped: false,
    })
  })
  it('keeps mobile presets in CSS pixels: 393x852 at 3x fits the device clamp', () => {
    setTab({ presetId: 'iphone-61' })
    expect(selectViewport(useStore.getState())).toEqual({
      width: 393,
      height: 852,
      clamped: false,
    })
  })
  it('clamps an oversized custom screen and says so', () => {
    useStore.getState().setCustom({ width: 6000, height: 900, diagonalInches: 40 })
    expect(tab().presetId).toBe(CUSTOM_PRESET_ID)
    expect(selectViewport(useStore.getState())).toEqual({
      width: 4096,
      height: 900,
      clamped: true,
    })
  })
})

describe('orientation', () => {
  it('opens portrait, which is the preset exactly as stored', () => {
    expect(tab().orientation).toBe('portrait')
    setTab({ presetId: 'iphone-61' })
    expect(selectViewport(useStore.getState())).toMatchObject({ width: 393, height: 852 })
  })

  it('swaps the CSS axes in landscape', () => {
    setTab({ presetId: 'iphone-61' })
    useStore.getState().setOrientation('landscape')
    expect(tab().orientation).toBe('landscape')
    expect(selectViewport(useStore.getState())).toEqual({ width: 852, height: 393, clamped: false })
    expect(selectScreen(useStore.getState())).toEqual({
      width: 852,
      height: 393,
      diagonalInches: 6.1,
      deviceScaleFactor: 3,
    })
  })

  it('rotates any preset, not only mobile ones', () => {
    setTab({ presetId: '1080p-24' })
    useStore.getState().setOrientation('landscape')
    expect(selectViewport(useStore.getState())).toMatchObject({ width: 1080, height: 1920 })
  })

  it('rotates the custom screen too', () => {
    useStore.getState().setCustom({ width: 1000, height: 600, diagonalInches: 20 })
    useStore.getState().setOrientation('landscape')
    expect(selectViewport(useStore.getState())).toMatchObject({ width: 600, height: 1000 })
  })

  it('leaves the physical magnification unchanged in magnitude', () => {
    useStore.setState({ host: HOST_4K, settings: { ...DEFAULT_SETTINGS, hostDiagonalInches: 27 } })
    setTab({ presetId: 'iphone-61' })
    const portrait = selectScale(useStore.getState())
    useStore.getState().setOrientation('landscape')
    expect(selectScale(useStore.getState())).toBeCloseTo(portrait, 10)
    expect(selectDeviceScaleFactor(useStore.getState())).toBe(3)
  })

  it('re-clamps against the device-pixel budget on the rotated axis', () => {
    // 820x1180 at 2x: the long axis is 2360 device px either way round, so
    // neither orientation clamps — but the clamp must be recomputed, not
    // carried over from the unrotated shape.
    setTab({ presetId: 'ipad-109' })
    useStore.getState().setOrientation('landscape')
    expect(selectViewport(useStore.getState())).toEqual({ width: 1180, height: 820, clamped: false })
  })

  it('is per tab, like the preset it rotates', () => {
    const s = useStore.getState()
    setTab({ presetId: 'iphone-61' })
    s.setOrientation('landscape')
    const second = s.addTab()!
    expect(selectTab(useStore.getState()).orientation).toBe('portrait')
    useStore.getState().activateTab(s.activeId === second ? Object.keys(s.tabs)[0]! : second)
  })

  it('drops a highlight, because rotation re-rasters the screen it marked', () => {
    useStore.getState().showAgentHighlight({ x: 1, y: 2, width: 3, height: 4, durationMs: 500 })
    expect(tab().agentHighlight).not.toBeNull()
    useStore.getState().setOrientation('landscape')
    expect(tab().agentHighlight).toBeNull()
  })

  it('writes nothing when the orientation is already the one asked for', () => {
    const before = tab()
    useStore.getState().setOrientation('portrait')
    expect(tab()).toBe(before)
  })
})

describe('selectScreenShape', () => {
  it('names the shape the dimensions have, never the stored flag', () => {
    setTab({ presetId: 'iphone-61' })
    expect(selectScreenShape(useStore.getState())).toBe('portrait')
    useStore.getState().setOrientation('landscape')
    expect(selectScreenShape(useStore.getState())).toBe('landscape')
  })
  it('reports a rotated monitor preset as the portrait it actually is', () => {
    setTab({ presetId: '1080p-24' })
    expect(selectScreenShape(useStore.getState())).toBe('landscape')
    useStore.getState().setOrientation('landscape')
    expect(selectScreenShape(useStore.getState())).toBe('portrait')
  })
})

describe('selectScale on a mobile preset', () => {
  it('is per device pixel: iPhone 6.1" on a 4K 27" host is ~0.35', () => {
    useStore.setState({
      host: HOST_4K,
      settings: { hostDiagonalInches: 27, hostNits: 500 },
    })
    setTab({ presetId: 'iphone-61' })
    // hostPPI 163.18 / devicePPI 461.4
    expect(selectScale(useStore.getState())).toBeCloseTo(0.3537, 3)
  })
})

describe('selectPanelParams', () => {
  it('follows the profile and the host nits', () => {
    useStore.setState({ settings: { hostDiagonalInches: 27, hostNits: 500 } })
    setTab({ profileId: 'budget-tn' })
    expect(selectPanelParams(useStore.getState())).toEqual(
      profileToParams(findProfile('budget-tn'), 500),
    )
  })
  it('lets the advanced sliders win, and choosing a profile clears them', () => {
    const custom = {
      id: 'custom',
      label: 'Custom panel',
      contrastRatio: 100,
      gamutCoverage: 0.5,
      bits: 6 as const,
      frc: true,
      nits: 150,
    }
    useStore.setState({ settings: { hostDiagonalInches: 27, hostNits: 500 } })
    useStore.getState().setProfileOverride(custom)
    expect(selectPanelParams(useStore.getState())).toEqual(profileToParams(custom, 500))

    useStore.getState().setProfile('office-ips')
    expect(tab().profileOverride).toBeNull()
    expect(selectPanelParams(useStore.getState())).toEqual(
      profileToParams(findProfile('office-ips'), 500),
    )
  })
  it('falls back to the default nits instead of throwing on bad settings', () => {
    useStore.setState({ settings: { hostDiagonalInches: 27, hostNits: 0 } })
    setTab({ profileId: 'budget-tn' })
    expect(selectPanelParams(useStore.getState())).toEqual(
      profileToParams(findProfile('budget-tn'), DEFAULT_SETTINGS.hostNits),
    )
  })
})

describe('errors', () => {
  it('keeps one error state when both panes report the same failure', () => {
    const err = { code: -105, description: 'ERR_NAME_NOT_RESOLVED', url: 'https://nope.invalid/' }
    useStore.getState().setError(err)
    const first = tab().error
    useStore.getState().setError({ ...err })
    expect(tab().error).toBe(first)

    useStore.getState().setError({ ...err, code: -106 })
    expect(tab().error).not.toBe(first)
    useStore.getState().setError(null)
    expect(tab().error).toBeNull()
  })
})

describe('image mode', () => {
  it('shows the filename, then restores the URL on the way back', () => {
    const st = useStore.getState()
    st.setUrl('https://example.com')
    st.setImage({ name: 'hero@2x.png', exportScale: 2, width: 800, height: 600 })
    st.setMode('image')

    expect(selectUrlBarText(useStore.getState())).toBe('hero@2x.png')

    useStore.getState().setMode('url')
    expect(tab().url).toBe('https://example.com')
    expect(tab().image).toBeNull()
    expect(selectUrlBarText(useStore.getState())).toBe('https://example.com')
  })
})

describe('view mode', () => {
  it('starts in fit with no fit scale published yet', () => {
    // Fit is the opening view; `fitScale` stays null until `TargetCanvas`
    // measures the pane and publishes the magnification it actually drew at.
    expect(tab().viewMode).toBe('fit')
    expect(tab().fitScale).toBeNull()
  })

  it('switches modes and carries the published fit scale', () => {
    useStore.getState().setViewMode('fit')
    useStore.getState().setFitScale(0.42)
    expect(tab().viewMode).toBe('fit')
    expect(tab().fitScale).toBe(0.42)

    useStore.getState().setViewMode('1:1')
    useStore.getState().setFitScale(null)
    expect(tab().viewMode).toBe('1:1')
    expect(tab().fitScale).toBeNull()
  })
})

describe('agent highlight lifecycle', () => {
  const HIGHLIGHT = { x: 10, y: 20, width: 100, height: 60, durationMs: 2000 }
  const show = () => useStore.getState().showAgentHighlight(HIGHLIGHT)

  it('is cleared by whatever replaces the content it marked', () => {
    for (const change of [
      () => useStore.getState().setUrl('https://next.test/'),
      () => useStore.getState().setPreset('laptop-768'),
      () => useStore.getState().setCustom({ width: 800 }),
      () => useStore.getState().setMode('image'),
    ]) {
      show()
      expect(tab().agentHighlight).toMatchObject(HIGHLIGHT)
      change()
      expect(tab().agentHighlight).toBeNull()
    }
    // Leaving image mode swaps the content back; that clears too.
    useStore.getState().setMode('image')
    show()
    useStore.getState().setMode('url')
    expect(tab().agentHighlight).toBeNull()
  })

  it('a seq-guarded clear removes only the highlight it was armed for', () => {
    show()
    const first = tab().agentHighlight!
    show() // the replacement bumps seq
    const second = tab().agentHighlight!
    expect(second.seq).toBe(first.seq + 1)

    // The first highlight's expiry timer fires late: a no-op.
    useStore.getState().clearAgentHighlight(first.seq)
    expect(tab().agentHighlight).toBe(second)

    // Its own timer (or an unconditional clear) removes it.
    useStore.getState().clearAgentHighlight(second.seq)
    expect(tab().agentHighlight).toBeNull()
  })
})

describe('panes', () => {
  it('starts showing both panes', () => {
    expect(useStore.getState().panes).toBe('both')
  })

  it('switches to the target alone and back', () => {
    useStore.getState().setPanes('target')
    expect(useStore.getState().panes).toBe('target')
    useStore.getState().setPanes('both')
    expect(useStore.getState().panes).toBe('both')
  })

  it('does not disturb the agent highlight', () => {
    useStore.getState().showAgentHighlight({ x: 0, y: 0, width: 4, height: 4, durationMs: 1000 })
    useStore.getState().setPanes('target')
    expect(tab().agentHighlight).not.toBeNull()
  })
})

describe('tabs', () => {
  it('opens one tab and every per-session field belongs to it', () => {
    const s = useStore.getState()
    expect(s.tabOrder).toEqual([s.activeId])
    expect(Object.keys(s.tabs)).toEqual([s.activeId])
  })

  it('gives each tab its own screen, and switching back restores it', () => {
    const first = useStore.getState().activeId
    useStore.getState().setPreset('1440p-27')
    useStore.getState().setUrl('https://first.test/')

    const second = useStore.getState().addTab()!
    expect(second).not.toBe(first)
    expect(useStore.getState().activeId).toBe(second)
    // A new tab opens blank, not on a copy of the tab it was opened from.
    expect(tab().presetId).toBe('1080p-24')
    expect(tab().url).toBe('')

    useStore.getState().setPreset('iphone-61')
    // The first tab kept its own screen while the second was being set up.
    expect(useStore.getState().tabs[first]!.presetId).toBe('1440p-27')
    expect(useStore.getState().tabs[first]!.url).toBe('https://first.test/')

    useStore.getState().activateTab(first)
    expect(tab().presetId).toBe('1440p-27')
    expect(selectViewport(useStore.getState())).toEqual({ width: 2560, height: 1440, clamped: false })
    expect(selectUrlBarText(useStore.getState())).toBe('https://first.test/')

    useStore.getState().activateTab(second)
    expect(tab().presetId).toBe('iphone-61')
    expect(selectDeviceScaleFactor(useStore.getState())).toBe(3)
  })

  it('adds at the end of the strip and refuses past the cap', () => {
    const first = useStore.getState().activeId
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, maxTabs: 2 } })
    const second = useStore.getState().addTab()
    expect(useStore.getState().tabOrder).toEqual([first, second])

    expect(useStore.getState().addTab()).toBeNull()
    expect(useStore.getState().tabOrder).toEqual([first, second])
    expect(useStore.getState().activeId).toBe(second)
  })

  it('adopts an id minted elsewhere, and a second add of it switches rather than blanks it', () => {
    const first = useStore.getState().activeId
    expect(useStore.getState().addTab('tab-from-main')).toBe('tab-from-main')
    useStore.getState().setPreset('1440p-27')

    useStore.getState().activateTab(first)
    expect(useStore.getState().addTab('tab-from-main')).toBe('tab-from-main')
    expect(useStore.getState().tabOrder).toEqual([first, 'tab-from-main'])
    expect(tab().presetId).toBe('1440p-27')
  })

  it('closing the active tab moves right, and at the end moves left', () => {
    const first = useStore.getState().activeId
    const second = useStore.getState().addTab()!
    const third = useStore.getState().addTab()!

    useStore.getState().activateTab(second)
    useStore.getState().closeTab(second)
    expect(useStore.getState().tabOrder).toEqual([first, third])
    expect(useStore.getState().activeId).toBe(third)

    useStore.getState().closeTab(third)
    expect(useStore.getState().tabOrder).toEqual([first])
    expect(useStore.getState().activeId).toBe(first)
  })

  it('closing a background tab leaves the active one alone', () => {
    const first = useStore.getState().activeId
    const second = useStore.getState().addTab()!
    useStore.getState().setPreset('1440p-27')

    useStore.getState().closeTab(first)
    expect(useStore.getState().tabOrder).toEqual([second])
    expect(useStore.getState().activeId).toBe(second)
    expect(tab().presetId).toBe('1440p-27')
    expect(useStore.getState().tabs[first]).toBeUndefined()
  })

  it('leaves a fresh blank tab when the last one closes', () => {
    const only = useStore.getState().activeId
    useStore.getState().setPreset('1440p-27')
    useStore.getState().closeTab(only)

    const s = useStore.getState()
    expect(s.tabOrder).toHaveLength(1)
    expect(s.activeId).not.toBe(only)
    expect(s.tabOrder).toEqual([s.activeId])
    expect(tab().presetId).toBe('1080p-24')
  })

  it('writes the tab that was named, not the tab that is showing', () => {
    // The whole point of the id on main's forwards. A background tab's late
    // redirect used to be suppressed entirely (so its strip entry went stale)
    // or, unnamed, would have rewritten the address of the tab in front.
    const first = useStore.getState().activeId
    const second = useStore.getState().addTab()!
    useStore.getState().setTabUrl(first, 'https://background.test/')
    useStore.getState().setTabTitle(first, 'Background')
    useStore.getState().setTabLoading(first, true)
    useStore.getState().setTabError(first, { code: -105, description: 'NAME_NOT_RESOLVED', url: 'x' })

    expect(useStore.getState().tabs[first]!.url).toBe('https://background.test/')
    expect(useStore.getState().tabs[first]!.title).toBe('Background')
    expect(useStore.getState().tabs[first]!.targetLoading).toBe(true)
    expect(useStore.getState().tabs[first]!.error?.code).toBe(-105)

    expect(useStore.getState().activeId).toBe(second)
    expect(tab().url).toBe('')
    expect(tab().title).toBe('')
    expect(tab().targetLoading).toBe(false)
    expect(tab().error).toBeNull()
  })

  it('drops a report for a tab that is no longer open', () => {
    // A report can outlive the close that raced it; resurrecting the tab it
    // names would put a ghost back in the strip.
    const first = useStore.getState().activeId
    const second = useStore.getState().addTab()!
    useStore.getState().closeTab(first)
    useStore.getState().setTabUrl(first, 'https://gone.test/')
    expect(useStore.getState().tabs[first]).toBeUndefined()
    expect(useStore.getState().tabOrder).toEqual([second])
  })

  it('titles a tab by its page title, then its host, then its URL', () => {
    const id = useStore.getState().activeId
    expect(tabTitle(tab().url, tab().title)).toBe('New tab')
    useStore.getState().setTabUrl(id, 'https://example.test:8080/deep/path')
    expect(tabTitle(tab().url, tab().title)).toBe('example.test:8080')
    useStore.getState().setTabTitle(id, 'Example — Home')
    expect(tabTitle(tab().url, tab().title)).toBe('Example — Home')
  })

  describe('syncTabs', () => {
    /** What a session main just built reports: the same defaults `blankTab` has. */
    const SCREEN = { presetId: '1080p-24', profileId: 'reference' }

    it('adopts main\'s list, order and active tab, keeping each open tab\'s own screen', () => {
      const first = useStore.getState().activeId
      useStore.getState().setPreset('1440p-27')
      const second = useStore.getState().addTab()!

      useStore.getState().syncTabs({
        tabs: [
          { id: first, url: 'https://a.test/', title: 'A', ...SCREEN },
          { id: second, url: '', title: '', ...SCREEN },
          { id: 'tab-from-main', url: 'https://c.test/', title: 'C', ...SCREEN },
        ],
        activeId: 'tab-from-main',
      })

      const s = useStore.getState()
      expect(s.tabOrder).toEqual([first, second, 'tab-from-main'])
      expect(s.activeId).toBe('tab-from-main')
      // Kept: the preset is the renderer's own state, not main's.
      expect(s.tabs[first]!.presetId).toBe('1440p-27')
      // Taken: url and title are main's — it is what every tab's panes report to.
      expect(s.tabs[first]!.url).toBe('https://a.test/')
      expect(s.tabs[first]!.title).toBe('A')
      // A tab main has never mentioned opens blank.
      expect(s.tabs['tab-from-main']!.presetId).toBe('1080p-24')
    })

    it('seeds a tab it has never seen with the screen main restored, and leaves an open one alone', () => {
      // The restore case: main built these tabs from `tabs.json` before any
      // renderer existed to report a preset, so the snapshot is the only place
      // the screen can come from. Seeded blank instead, a restored tab would
      // come back on the wrong screen — a different observation of the page.
      const first = useStore.getState().activeId
      useStore.getState().setPreset('1440p-27')

      useStore.getState().syncTabs({
        tabs: [
          { id: first, url: 'https://a.test/', title: 'A', presetId: 'iphone-61', profileId: 'budget-tn' },
          { id: 'restored', url: 'https://b.test/', title: 'B', presetId: 'laptop-768', profileId: 'budget-tn' },
        ],
        activeId: first,
      })

      const s = useStore.getState()
      expect(s.tabs.restored!.presetId).toBe('laptop-768')
      expect(s.tabs.restored!.profileId).toBe('budget-tn')
      // Seeding is for tabs the renderer does not know. For one it does, the
      // renderer is the authority — main's mirror is only an echo of an older
      // report of the very same value, and taking it back would fight the user.
      expect(s.tabs[first]!.presetId).toBe('1440p-27')
      expect(s.tabs[first]!.profileId).toBe('reference')
    })

    it('drops the tabs main no longer holds', () => {
      const first = useStore.getState().activeId
      const second = useStore.getState().addTab()!
      useStore.getState().syncTabs({ tabs: [{ id: second, url: '', title: '', ...SCREEN }], activeId: second })
      expect(useStore.getState().tabOrder).toEqual([second])
      expect(useStore.getState().tabs[first]).toBeUndefined()
    })

    it('refuses an empty list rather than leaving no active tab', () => {
      const before = useStore.getState()
      useStore.getState().syncTabs({ tabs: [], activeId: '' })
      expect(useStore.getState().tabs).toBe(before.tabs)
      expect(useStore.getState().activeId).toBe(before.activeId)
    })

    it('falls back to the first tab when the named active one is not in the list', () => {
      const first = useStore.getState().activeId
      useStore.getState().syncTabs({ tabs: [{ id: first, url: '', title: '', ...SCREEN }], activeId: 'tab-nowhere' })
      expect(useStore.getState().activeId).toBe(first)
    })
  })

  it('ignores a close or an activate naming a tab that is not open', () => {
    const before = useStore.getState()
    useStore.getState().closeTab('tab-gone')
    useStore.getState().activateTab('tab-gone')
    expect(useStore.getState().tabs).toBe(before.tabs)
    expect(useStore.getState().activeId).toBe(before.activeId)
  })
})
