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
  selectUrlBarText,
  selectViewport,
  useStore,
} from '../../src/renderer/src/state/store'

const HOST_4K = { physicalWidth: 3840, physicalHeight: 2160, scaleFactor: 2 }
const initial = useStore.getState()

beforeEach(() => useStore.setState(initial, true))

describe('defaults', () => {
  it('starts on the first preset, the reference profile and default settings', () => {
    const s = useStore.getState()
    expect(s.mode).toBe('url')
    expect(s.presetId).toBe('1080p-24')
    expect(s.profileId).toBe('reference')
    expect(s.settings).toEqual(DEFAULT_SETTINGS)
    expect(s.profileOverride).toBeNull()
    expect(s.surround).toBe('graphite')
  })
})

describe('selectScale', () => {
  it('falls back to 2 while the host display is unknown', () => {
    expect(selectScale(useStore.getState())).toBe(FALLBACK_SCALE)
  })
  it('is exactly 2 for 1080p 27" on a 4K 27" host', () => {
    useStore.setState({
      host: HOST_4K,
      presetId: '1080p-27',
      settings: { hostDiagonalInches: 27, hostNits: 500 },
    })
    expect(selectScale(useStore.getState())).toBeCloseTo(2, 10)
  })
  it('pixel-exact ignores physical size and uses the host scale factor', () => {
    useStore.setState({ host: HOST_4K, presetId: 'laptop-768', pixelExact: true })
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

    useStore.setState({ host: HOST_4K, presetId: '1080p-27' })
    expect(selectScaleIsFallback(useStore.getState())).toBe(false)

    useStore.getState().setCustom({ width: 1920, height: 1080, diagonalInches: 0 })
    expect(selectScaleIsFallback(useStore.getState())).toBe(true)

    useStore.setState({ presetId: '1080p-27', settings: { hostDiagonalInches: 0, hostNits: 500 } })
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
    useStore.setState({ presetId: 'iphone-61' })
    expect(selectDeviceScaleFactor(useStore.getState())).toBe(3)
    useStore.setState({ presetId: 'ipad-109' })
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
    useStore.setState({ presetId: '1440p-27' })
    expect(selectViewport(useStore.getState())).toEqual({
      width: 2560,
      height: 1440,
      clamped: false,
    })
  })
  it('keeps mobile presets in CSS pixels: 393x852 at 3x fits the device clamp', () => {
    useStore.setState({ presetId: 'iphone-61' })
    expect(selectViewport(useStore.getState())).toEqual({
      width: 393,
      height: 852,
      clamped: false,
    })
  })
  it('clamps an oversized custom screen and says so', () => {
    useStore.getState().setCustom({ width: 6000, height: 900, diagonalInches: 40 })
    expect(useStore.getState().presetId).toBe(CUSTOM_PRESET_ID)
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
      presetId: 'iphone-61',
      settings: { hostDiagonalInches: 27, hostNits: 500 },
    })
    // hostPPI 163.18 / devicePPI 461.4
    expect(selectScale(useStore.getState())).toBeCloseTo(0.3537, 3)
  })
})

describe('selectPanelParams', () => {
  it('follows the profile and the host nits', () => {
    useStore.setState({
      profileId: 'budget-tn',
      settings: { hostDiagonalInches: 27, hostNits: 500 },
    })
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
    expect(useStore.getState().profileOverride).toBeNull()
    expect(selectPanelParams(useStore.getState())).toEqual(
      profileToParams(findProfile('office-ips'), 500),
    )
  })
  it('falls back to the default nits instead of throwing on bad settings', () => {
    useStore.setState({
      profileId: 'budget-tn',
      settings: { hostDiagonalInches: 27, hostNits: 0 },
    })
    expect(selectPanelParams(useStore.getState())).toEqual(
      profileToParams(findProfile('budget-tn'), DEFAULT_SETTINGS.hostNits),
    )
  })
})

describe('errors', () => {
  it('keeps one error state when both panes report the same failure', () => {
    const err = { code: -105, description: 'ERR_NAME_NOT_RESOLVED', url: 'https://nope.invalid/' }
    useStore.getState().setError(err)
    const first = useStore.getState().error
    useStore.getState().setError({ ...err })
    expect(useStore.getState().error).toBe(first)

    useStore.getState().setError({ ...err, code: -106 })
    expect(useStore.getState().error).not.toBe(first)
    useStore.getState().setError(null)
    expect(useStore.getState().error).toBeNull()
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
    expect(useStore.getState().url).toBe('https://example.com')
    expect(useStore.getState().image).toBeNull()
    expect(selectUrlBarText(useStore.getState())).toBe('https://example.com')
  })
})

describe('view mode', () => {
  it('starts at 1:1 with no fit scale published', () => {
    const s = useStore.getState()
    expect(s.viewMode).toBe('1:1')
    expect(s.fitScale).toBeNull()
  })

  it('switches modes and carries the published fit scale', () => {
    useStore.getState().setViewMode('fit')
    useStore.getState().setFitScale(0.42)
    expect(useStore.getState().viewMode).toBe('fit')
    expect(useStore.getState().fitScale).toBe(0.42)

    useStore.getState().setViewMode('1:1')
    useStore.getState().setFitScale(null)
    expect(useStore.getState().viewMode).toBe('1:1')
    expect(useStore.getState().fitScale).toBeNull()
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
      expect(useStore.getState().agentHighlight).toMatchObject(HIGHLIGHT)
      change()
      expect(useStore.getState().agentHighlight).toBeNull()
    }
    // Leaving image mode swaps the content back; that clears too.
    useStore.getState().setMode('image')
    show()
    useStore.getState().setMode('url')
    expect(useStore.getState().agentHighlight).toBeNull()
  })

  it('a seq-guarded clear removes only the highlight it was armed for', () => {
    show()
    const first = useStore.getState().agentHighlight!
    show() // the replacement bumps seq
    const second = useStore.getState().agentHighlight!
    expect(second.seq).toBe(first.seq + 1)

    // The first highlight's expiry timer fires late: a no-op.
    useStore.getState().clearAgentHighlight(first.seq)
    expect(useStore.getState().agentHighlight).toBe(second)

    // Its own timer (or an unconditional clear) removes it.
    useStore.getState().clearAgentHighlight(second.seq)
    expect(useStore.getState().agentHighlight).toBeNull()
  })
})
