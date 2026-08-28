import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_SETTINGS, MAX_TABS_MAX, MAX_TABS_MIN, SPLIT_MAX, SPLIT_MIN } from './presets'
import type { Settings } from './types'

const isPositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
const isStamp = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

const isRatio = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= SPLIT_MIN && v <= SPLIT_MAX

const isTabCap = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= MAX_TABS_MIN && v <= MAX_TABS_MAX

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
      // Same default as `updateCheck`, for the same reason: a file written
      // before this feature existed has no key, and history is on by default.
      recordHistory: raw.recordHistory !== false,
      // A ratio outside 0.1–0.9 is treated as absent, not rejected: unlike a
      // nits or diagonal figure it is a layout preference, and a file that
      // was hand-edited to 0.97 means "I want the target tiny", not "refuse
      // to start". Falling back to an even split loses one preference; the
      // panes stay usable, which is the point of the band.
      split: isRatio(raw.split) ? raw.split : DEFAULT_SETTINGS.split,
      // Like `split`, and for the same reason: a cap outside 2–32 in a
      // hand-edited file is someone wanting a different number, not grounds
      // for refusing to start. The default costs them the preference and
      // leaves the app usable, which is what the band is for. Not a clamp to
      // the nearest edge either — a file claiming 999 tabs is not evidence of
      // an intent worth honouring at 32.
      maxTabs: isTabCap(raw.maxTabs) ? raw.maxTabs : DEFAULT_SETTINGS.maxTabs,
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
  if (typeof s.recordHistory !== 'boolean') throw new RangeError('recordHistory must be a boolean')
  // Writing is the stricter side: `loadSettings` forgives a bad ratio because
  // it has to cope with whatever is on disk, but nothing inside the app has
  // any business asking for one — the renderer clamps before it saves.
  if (!isRatio(s.split)) throw new RangeError(`split must be a finite ratio in ${SPLIT_MIN}..${SPLIT_MAX}`)
  if (!isTabCap(s.maxTabs)) throw new RangeError(`maxTabs must be a whole count in ${MAX_TABS_MIN}..${MAX_TABS_MAX}`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(s, null, 2))
}
