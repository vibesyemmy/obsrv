import type { PanelProfile, ScreenPreset, Settings } from './types'

export const MAX_VIEWPORT = 4096

export const DEFAULT_SETTINGS: Settings = { hostDiagonalInches: 27, hostNits: 500 }

export const SCREEN_PRESETS: readonly ScreenPreset[] = [
  { id: '1080p-24', label: '1080p 24"', width: 1920, height: 1080, diagonalInches: 24 },
  { id: '1080p-27', label: '1080p 27"', width: 1920, height: 1080, diagonalInches: 27 },
  { id: 'laptop-768', label: 'Laptop 1366×768 15.6"', width: 1366, height: 768, diagonalInches: 15.6 },
  { id: '1440p-27', label: '1440p 27"', width: 2560, height: 1440, diagonalInches: 27 },
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
