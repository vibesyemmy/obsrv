import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  HISTORY_MAX,
  byRank,
  isCount,
  isRecord,
  isStamp,
  isStorableUrl,
  type HistoryEntry,
} from './history'

/**
 * `history.json`, read and written in the same shape `shared/settings.ts`
 * reads `settings.json`: every field checked with a fallback on the way in, a
 * malformed file treated as empty rather than fatal, and nothing invalid
 * allowed out. Main-side only — the renderer never touches the file, and the
 * pure half it does import must stay free of `node:fs`.
 */

/**
 * The stored list, or an empty one. A malformed file is treated as no history
 * rather than as a fatal error, exactly as `loadSettings` treats a malformed
 * `settings.json`: losing a convenience beats refusing to start.
 */
export function loadHistory(file: string): HistoryEntry[] {
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (!Array.isArray(raw)) return []
    const seen = new Set<string>()
    const out: HistoryEntry[] = []
    for (const item of raw) {
      if (!isRecord(item)) continue
      // Unlike a settings field, a bad URL has no sensible fallback — the
      // entry *is* the URL — so the row is dropped rather than the file. A
      // duplicate is dropped for the same reason: two rows for one address
      // would both match and waste a slot in a list of six.
      if (!isStorableUrl(item.url) || seen.has(item.url)) continue
      seen.add(item.url)
      out.push({
        url: item.url,
        // These two do fall back: a row whose counter got mangled is still a
        // page that was visited, and losing its rank beats losing the row.
        visits: isCount(item.visits) ? item.visits : 1,
        lastVisit: isStamp(item.lastVisit) ? item.lastVisit : 0,
      })
    }
    return out.sort(byRank).slice(0, HISTORY_MAX)
  } catch {
    return []
  }
}

/**
 * Writing is the stricter side, as it is for settings: `loadHistory` forgives
 * whatever is on disk because it has to, but nothing inside the app has any
 * business asking to store a malformed entry.
 */
export function saveHistory(file: string, entries: readonly HistoryEntry[]): void {
  if (!Array.isArray(entries)) throw new RangeError('history must be an array')
  if (entries.length > HISTORY_MAX) throw new RangeError(`history must hold at most ${HISTORY_MAX} entries`)
  for (const e of entries) {
    if (!isRecord(e) || !isStorableUrl(e.url)) throw new RangeError('history entries need a loadable url')
    if (!isCount(e.visits)) throw new RangeError('visits must be an integer >= 1')
    if (!isStamp(e.lastVisit)) throw new RangeError('lastVisit must be a finite epoch ms >= 0')
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(entries, null, 2))
}
