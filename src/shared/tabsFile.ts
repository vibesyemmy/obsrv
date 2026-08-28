import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { PANEL_PROFILES, SCREEN_PRESETS } from './presets'

export interface StoredTab {
  url: string
  presetId: string
  profileId: string
}

export interface StoredTabs {
  tabs: StoredTab[]
  activeIndex: number
}

const DEFAULT_PRESET = '1080p-24'
const DEFAULT_PROFILE = PANEL_PROFILES[0]!.id

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

const EMPTY = (): StoredTabs => ({ tabs: [], activeIndex: 0 })

/**
 * Tabs live in their own file rather than in `settings.json`: they have a
 * different lifetime and a different failure mode, and a corrupt tab list must
 * not cost the user their monitor calibration.
 *
 * A stored preset or profile id that no longer exists falls back rather than
 * being kept — ids can be removed between releases, and a tab pointing at a
 * preset that is gone would render nothing with no way to say why. This is the
 * one divergence from `settings.ts`'s `maxTabs`, which clamps an out-of-band
 * number because the direction of what the user asked for is still legible; a
 * dead id carries no direction to honour.
 *
 * Nothing here throws: `loadTabs` runs during boot, and a hand-edited or
 * half-written file must cost the user their tabs, not their app.
 *
 * `max` is `Settings.maxTabs`. The cap belongs here rather than at the restore
 * site because this is the one moment the app builds tabs from something it
 * did not write — a hand-edited file, or one saved when the cap was higher —
 * and a list of forty would otherwise stand up forty pairs of Chromium
 * renderers behind a cap of twelve, which is the cap's whole point.
 */
export function loadTabs(file: string, max = Infinity): StoredTabs {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (!isRecord(raw) || !Array.isArray(raw.tabs)) return EMPTY()
    const tabs: StoredTab[] = []
    for (const entry of raw.tabs) {
      // The url is the only field a tab cannot be reconstructed without, so an
      // entry missing it is dropped whole rather than defaulted into a tab
      // pointing at nothing.
      if (!isRecord(entry) || typeof entry.url !== 'string') continue
      tabs.push({
        url: entry.url,
        presetId: SCREEN_PRESETS.some(p => p.id === entry.presetId) ? (entry.presetId as string) : DEFAULT_PRESET,
        profileId: PANEL_PROFILES.some(p => p.id === entry.profileId) ? (entry.profileId as string) : DEFAULT_PROFILE,
      })
    }
    // Truncated before the index is bounded, and both after validation:
    // dropping an entry shifts every index after it, and the truncation can
    // strand the index outright. A stranded one falls to the front rather than
    // to the nearest surviving tab — that index now names a different page,
    // and opening on it would be a guess wearing the shape of a memory.
    const kept = tabs.slice(0, Math.max(0, max))
    const idx = raw.activeIndex
    const activeIndex =
      typeof idx === 'number' && Number.isInteger(idx) && idx >= 0 && idx < kept.length ? idx : 0
    return { tabs: kept, activeIndex }
  } catch {
    return EMPTY()
  }
}

/**
 * The strict side, like `saveSettings`: the loader forgives whatever is on
 * disk because it has no choice, but a caller inside the app handing over a
 * tab with no url is a bug that should surface here rather than as an empty
 * list on the next launch.
 */
export function saveTabs(file: string, s: StoredTabs): void {
  if (!Array.isArray(s.tabs)) throw new TypeError('tabs must be an array')
  for (const t of s.tabs) {
    if (!isRecord(t) || typeof t.url !== 'string') throw new TypeError('each tab needs a url string')
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(s, null, 2))
}
