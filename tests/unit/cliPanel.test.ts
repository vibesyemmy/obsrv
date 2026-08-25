import { describe, it, expect } from 'vitest'
import { applyPanelProfile } from '../../src/cli/panel'
import { profileToParams, simulatePixel } from '../../src/shared/panelSim'
import { DEFAULT_SETTINGS, findProfile } from '../../src/shared/presets'
import type { RGBAImage } from '../../src/shared/downsample'

describe('applyPanelProfile', () => {
  it('the reference profile is a pass-through', () => {
    const img: RGBAImage = { width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255]) }
    expect(applyPanelProfile(img, findProfile('reference'))).toBe(img)
  })
  it('matches simulatePixel per pixel, with (x, y) driving the dither', () => {
    const w = 4
    const h = 2
    const data = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 200
      data[i + 1] = 100
      data[i + 2] = 50
      data[i + 3] = 255
    }
    const profile = findProfile('budget-tn')
    const out = applyPanelProfile({ width: w, height: h, data }, profile)
    const params = profileToParams(profile, DEFAULT_SETTINGS.hostNits)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const [r, g, b] = simulatePixel([200, 100, 50], params, x, y)
        expect([out.data[i], out.data[i + 1], out.data[i + 2], out.data[i + 3]]).toEqual([r, g, b, 255])
      }
    }
    // budget-tn dithers: neighbouring pixels of one flat colour must not all agree.
    const distinct = new Set<string>()
    for (let i = 0; i < out.data.length; i += 4) distinct.add(`${out.data[i]},${out.data[i + 1]},${out.data[i + 2]}`)
    expect(distinct.size).toBeGreaterThan(1)
  })
})
