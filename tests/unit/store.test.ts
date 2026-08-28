import { describe, it, expect, beforeEach } from 'vitest'
import { profileToParams } from '../../src/shared/panelSim'
import { DEFAULT_SETTINGS, findProfile } from '../../src/shared/presets'
import {
  CUSTOM_PRESET_ID,
  FALLBACK_SCALE,
  selectDeviceScaleFactor,
  selectHostScaleFactor,
  selectPanelParams,
  selectScale,
  selectScaleIsFallback,
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
