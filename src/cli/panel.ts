import type { RGBAImage } from '../shared/downsample'
import { profileToParams, simulatePixel } from '../shared/panelSim'
import { DEFAULT_SETTINGS } from '../shared/presets'
import type { PanelProfile } from '../shared/types'

/**
 * Applies a panel profile to a whole frame through `simulatePixel` — the CPU
 * reference implementation the app's shader is parity-tested against — so the
 * CLI's PNGs show exactly what the app's simulated pane shows. (x, y) feed the
 * ordered dither, matching the shader's `gl_FragCoord` addressing.
 *
 * `hostNits` defaults to the app's default setting (500): the CLI has no
 * per-user Settings store, and a documented constant beats a hidden one.
 */
export function applyPanelProfile(img: RGBAImage, profile: PanelProfile, hostNits: number = DEFAULT_SETTINGS.hostNits): RGBAImage {
  if (profile.id === 'reference') return img
  const params = profileToParams(profile, hostNits)
  const out = new Uint8ClampedArray(img.data.length)
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4
      const [r, g, b] = simulatePixel([img.data[i]!, img.data[i + 1]!, img.data[i + 2]!], params, x, y)
      out[i] = r
      out[i + 1] = g
      out[i + 2] = b
      out[i + 3] = img.data[i + 3]!
    }
  }
  return { width: img.width, height: img.height, data: out }
}
