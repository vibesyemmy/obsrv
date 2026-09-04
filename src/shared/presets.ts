import type { Orientation, PanelProfile, ScreenPreset, Settings } from './types'

export const MAX_VIEWPORT = 4096

/** The loose sanity band for `Settings.split`; the clamp that matters is the
 *  drag's 240px-a-side floor, which only the renderer knows the pixels for. */
export const SPLIT_MIN = 0.1
export const SPLIT_MAX = 0.9

/** The band `Settings.maxTabs` is held to. Below two there is nothing to tab
 *  between; above thirty-two the process count is a problem on any machine. */
export const MAX_TABS_MIN = 2
export const MAX_TABS_MAX = 32

export const DEFAULT_SETTINGS: Settings = {
  hostDiagonalInches: 27,
  hostNits: 500,
  agentControl: false,
  updateCheck: true,
  lastUpdateCheck: 0,
  recordHistory: true,
  split: 0.5,
  maxTabs: 12,
}

/**
 * Every tab opens unrotated. `'portrait'` means "the preset as stored", so this
 * is a no-op against the table below rather than a shape anyone has to honour.
 */
export const DEFAULT_ORIENTATION: Orientation = 'portrait'

/** Type guard for anything off the wire, off disk, or off an agent's payload. */
export function isOrientation(v: unknown): v is Orientation {
  return v === 'portrait' || v === 'landscape'
}

export const SCREEN_PRESETS: readonly ScreenPreset[] = [
  // Laptops — ordered largest to smallest panel, then the denser 1080p outlier.
  { id: 'laptop-768', label: '1366×768 15.6"', width: 1366, height: 768, diagonalInches: 15.6, deviceScaleFactor: 1, group: 'laptop' },
  { id: 'laptop-768-14', label: '1366×768 14"', width: 1366, height: 768, diagonalInches: 14, deviceScaleFactor: 1, group: 'laptop' },
  { id: 'laptop-768-11', label: '1366×768 11.6" (Chromebook)', width: 1366, height: 768, diagonalInches: 11.6, deviceScaleFactor: 1, group: 'laptop' },
  { id: 'laptop-800-11', label: '1280×800 11.6" (Chromebook)', width: 1280, height: 800, diagonalInches: 11.6, deviceScaleFactor: 1, group: 'laptop' },
  { id: 'laptop-900-17', label: '1600×900 17.3"', width: 1600, height: 900, diagonalInches: 17.3, deviceScaleFactor: 1, group: 'laptop' },
  { id: 'laptop-1080-15', label: '1080p 15.6"', width: 1920, height: 1080, diagonalInches: 15.6, deviceScaleFactor: 1, group: 'laptop' },
  // The same 1080p panels as Windows ships them: 125% is the default display
  // scaling on a 15.6" FHD laptop and 150% on a 14", so most owners of these
  // machines see 1536×864 and 1280×720 CSS px at a fractional density — text
  // larger than the 1x row above, layouts narrower, and every 1px line
  // landing between device pixels. Fractional factors rasterise exactly
  // (measured: 1280×800 at 1.5 paints 1920×1200) since 0.18.1.
  { id: 'laptop-1080-125', label: '1080p 15.6" @1.25 (Windows 125%)', width: 1536, height: 864, diagonalInches: 15.6, deviceScaleFactor: 1.25, group: 'laptop' },
  { id: 'laptop-1080-150', label: '1080p 14" @1.5 (Windows 150%)', width: 1280, height: 720, diagonalInches: 14, deviceScaleFactor: 1.5, group: 'laptop' },
  // The machines the work is usually made on, which is exactly why they are
  // worth having as a *target*: you cannot check one from inside it. Apple's
  // default scaled mode on both is precisely half the native panel, so the
  // scale factor really is 2 and the diagonals are the real 14.2/16.2.
  { id: 'mbp-14', label: 'MacBook Pro 14" @2x', width: 1512, height: 982, diagonalInches: 14.2, deviceScaleFactor: 2, group: 'laptop' },
  { id: 'mbp-16', label: 'MacBook Pro 16" @2x', width: 1728, height: 1117, diagonalInches: 16.2, deviceScaleFactor: 2, group: 'laptop' },
  // Desktops.
  { id: '1080p-24', label: '1080p 24"', width: 1920, height: 1080, diagonalInches: 24, deviceScaleFactor: 1, group: 'desktop' },
  { id: '1080p-27', label: '1080p 27"', width: 1920, height: 1080, diagonalInches: 27, deviceScaleFactor: 1, group: 'desktop' },
  { id: '1440p-27', label: '1440p 27"', width: 2560, height: 1440, diagonalInches: 27, deviceScaleFactor: 1, group: 'desktop' },
  { id: 'sxga-19', label: '1280×1024 19" (5:4)', width: 1280, height: 1024, diagonalInches: 19, deviceScaleFactor: 1, group: 'desktop' },
  { id: '1440x900-19', label: '1440×900 19"', width: 1440, height: 900, diagonalInches: 19, deviceScaleFactor: 1, group: 'desktop' },
  // 4K at 100% scaling: the high-end screen that makes text *smaller* than a
  // 1080p one, not larger. The 150% row is how Windows ships the same panel
  // and how most of its owners see it: 2560×1440 CSS px, HiDPI text.
  { id: '4k-27', label: '4K 27"', width: 3840, height: 2160, diagonalInches: 27, deviceScaleFactor: 1, group: 'desktop' },
  { id: '4k-27-150', label: '4K 27" @1.5 (150%)', width: 2560, height: 1440, diagonalInches: 27, deviceScaleFactor: 1.5, group: 'desktop' },
  // Breaks layout rather than density: max-width containers, line length, and
  // anything centred or sticky.
  { id: 'ultrawide-34', label: 'Ultrawide 34"', width: 3440, height: 1440, diagonalInches: 34, deviceScaleFactor: 1, group: 'desktop' },
  // Mobiles — CSS viewport x the device's real scale factor. A phone preset
  // rendered at 1x would look worse than any real phone; these rasterise at
  // 2x/3x and are shown at true physical size (usually minified on a desktop).
  // Mobiles — CSS viewport x the device's real scale factor. A phone preset
  // rendered at 1x would look worse than any real phone; these rasterise at
  // 2x/3x and are shown at true physical size (usually minified on a desktop).
  //
  // Narrowest viewport first, then the tablets: the width is what decides
  // which layout a page serves, so the list reads in the order things break.
  // The layout floor. Also what any phone becomes when the owner raises the
  // system font size or splits the screen, so it is an accessibility case as
  // much as an old device.
  { id: 'phone-320', label: 'Small phone 4" @2x', width: 320, height: 568, diagonalInches: 4, deviceScaleFactor: 2, group: 'mobile' },
  { id: 'android-65', label: 'Budget Android 6.5" @2x', width: 360, height: 800, diagonalInches: 6.5, deviceScaleFactor: 2, group: 'mobile' },
  { id: 'iphone-se', label: 'iPhone SE 4.7" @2x', width: 375, height: 667, diagonalInches: 4.7, deviceScaleFactor: 2, group: 'mobile' },
  { id: 'iphone-61', label: 'iPhone 6.1" @3x', width: 393, height: 852, diagonalInches: 6.1, deviceScaleFactor: 3, group: 'mobile' },
  // The Android flagship density is fractional: a 1080×2400 panel at 412 CSS
  // px wide is 2.625×, which is what every Pixel since the 4a and most
  // Samsung A-series report. 6.17" is Google's own diagonal for the 428 ppi
  // it publishes. 412 × 2.625 is 1081.5, and the raster is what Chromium
  // paints of that — 1081×2401, the floor (see `paintedExtent`).
  { id: 'pixel-8', label: 'Pixel 8 6.2" @2.625', width: 412, height: 915, diagonalInches: 6.17, deviceScaleFactor: 2.625, group: 'mobile' },
  { id: 'iphone-67', label: 'iPhone 6.7" @3x', width: 430, height: 932, diagonalInches: 6.7, deviceScaleFactor: 3, group: 'mobile' },
  { id: 'ipad-109', label: 'iPad 10.9" @2x', width: 820, height: 1180, diagonalInches: 10.9, deviceScaleFactor: 2, group: 'mobile' },
  // At 1024 CSS px most sites serve this the *desktop* layout on a touch
  // device, which is a different failure from anything above it.
  { id: 'ipad-pro-129', label: 'iPad Pro 12.9" @2x', width: 1024, height: 1366, diagonalInches: 12.9, deviceScaleFactor: 2, group: 'mobile' },
]

export const PANEL_PROFILES: readonly PanelProfile[] = [
  { id: 'reference', label: 'Reference (off)', contrastRatio: null, gamutCoverage: 1, bits: 8, frc: false, nits: null },
  { id: 'office-ips', label: 'Office IPS', contrastRatio: 1000, gamutCoverage: 1, bits: 8, frc: false, nits: 300 },
  { id: 'budget-tn', label: 'Budget TN', contrastRatio: 700, gamutCoverage: 0.72, bits: 6, frc: true, nits: 250 },
  { id: 'old-laptop', label: 'Old laptop', contrastRatio: 600, gamutCoverage: 0.6, bits: 6, frc: false, nits: 220 },
]

export function findPreset(id: string): ScreenPreset {
  const p = SCREEN_PRESETS.find(x => x.id === id)
  if (!p) throw new Error(`unknown preset: ${id}`)
  return p
}

export function findProfile(id: string): PanelProfile {
  const p = PANEL_PROFILES.find(x => x.id === id)
  if (!p) throw new Error(`unknown profile: ${id}`)
  return p
}
