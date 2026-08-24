import type { PanelProfile, ScreenPreset, Settings } from './types'

export const MAX_VIEWPORT = 4096

export const DEFAULT_SETTINGS: Settings = { hostDiagonalInches: 27, hostNits: 500 }

export const SCREEN_PRESETS: readonly ScreenPreset[] = [
  // Laptops — ordered largest to smallest panel, then the denser 1080p outlier.
  { id: 'laptop-768', label: '1366×768 15.6"', width: 1366, height: 768, diagonalInches: 15.6, group: 'laptop' },
  { id: 'laptop-768-14', label: '1366×768 14"', width: 1366, height: 768, diagonalInches: 14, group: 'laptop' },
  { id: 'laptop-768-11', label: '1366×768 11.6" (Chromebook)', width: 1366, height: 768, diagonalInches: 11.6, group: 'laptop' },
  { id: 'laptop-800-11', label: '1280×800 11.6" (Chromebook)', width: 1280, height: 800, diagonalInches: 11.6, group: 'laptop' },
  { id: 'laptop-900-17', label: '1600×900 17.3"', width: 1600, height: 900, diagonalInches: 17.3, group: 'laptop' },
  { id: 'laptop-1080-15', label: '1080p 15.6"', width: 1920, height: 1080, diagonalInches: 15.6, group: 'laptop' },
  // Desktops.
  { id: '1080p-24', label: '1080p 24"', width: 1920, height: 1080, diagonalInches: 24, group: 'desktop' },
  { id: '1080p-27', label: '1080p 27"', width: 1920, height: 1080, diagonalInches: 27, group: 'desktop' },
  { id: '1440p-27', label: '1440p 27"', width: 2560, height: 1440, diagonalInches: 27, group: 'desktop' },
  { id: 'sxga-19', label: '1280×1024 19" (5:4)', width: 1280, height: 1024, diagonalInches: 19, group: 'desktop' },
  { id: '1440x900-19', label: '1440×900 19"', width: 1440, height: 900, diagonalInches: 19, group: 'desktop' },
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
