import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_SETTINGS } from './presets'
import type { Settings } from './types'

const isPositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
const isStamp = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

export function loadSettings(file: string): Settings {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    return {
      hostDiagonalInches: isPositive(raw.hostDiagonalInches) ? raw.hostDiagonalInches : DEFAULT_SETTINGS.hostDiagonalInches,
      hostNits: isPositive(raw.hostNits) ? raw.hostNits : DEFAULT_SETTINGS.hostNits,
      // Anything but a literal true (older files have no key at all) means off:
      // a network-facing capability must never be enabled by a malformed file.
      agentControl: raw.agentControl === true,
      // The opposite default: only a literal false turns the update check off,
      // so a file from before this feature keeps it on.
      updateCheck: raw.updateCheck !== false,
      lastUpdateCheck: isStamp(raw.lastUpdateCheck) ? raw.lastUpdateCheck : 0,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(file: string, s: Settings): void {
  if (!isPositive(s.hostDiagonalInches) || !isPositive(s.hostNits)) throw new RangeError('settings values must be finite and > 0')
  if (typeof s.agentControl !== 'boolean') throw new RangeError('agentControl must be a boolean')
  if (typeof s.updateCheck !== 'boolean') throw new RangeError('updateCheck must be a boolean')
  if (!isStamp(s.lastUpdateCheck)) throw new RangeError('lastUpdateCheck must be a finite epoch ms >= 0')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(s, null, 2))
}
