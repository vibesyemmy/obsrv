import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { ALLOWED_URL_SCHEMES } from './url'

/**
 * Everything about visited-URL history that can be decided without Electron:
 * what may be stored, how a visit updates the list, the cap, the ranking and
 * the substring match the URL bar types against. `history.json` is read and
 * written here in the same shape `shared/settings.ts` reads `settings.json` —
 * every field checked with a fallback on the way in, nothing invalid allowed
 * out — so it is unit-tested directly in tests/unit/history.test.ts.
 *
 * Main owns the one hook that calls `recordVisit` (`src/main/ipc.ts`, off the
 * native pane's `did-navigate`); the renderer owns the dropdown and calls
 * `matchHistory` only. See the history spec.
 */

export interface HistoryEntry {
  url: string
  /** How many committed navigations have landed on this URL. Always >= 1. */
  visits: number
  /** Epoch ms of the most recent one. */
  lastVisit: number
}

/**
 * The file is read and written whole, so it needs a bound. 500 is far beyond
 * what this app's usage produces — a handful of dev and staging addresses
 * returned to over and over — and small enough to parse instantly.
 */
export const HISTORY_MAX = 500

/** Rows the URL bar offers. Past six, a longer list is a worse tool than a better query. */
export const HISTORY_SUGGESTIONS = 6

/**
 * The other half of the bound: 500 entries of unbounded length is not a
 * bounded file. Far longer than any address this tool is pointed at, and
 * short enough that the whole file stays trivial to parse.
 */
export const MAX_URL_LENGTH = 2048

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1
const isStamp = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

/**
 * Is this an address worth remembering? Only the schemes the app can load
 * back (`shared/url.ts`), so `about:blank` — which the native pane commits on
 * every launch — never becomes a suggestion, and a scheme the URL bar would
 * refuse can never be offered by it.
 */
export function isStorableUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v === '' || v.length > MAX_URL_LENGTH) return false
  try {
    return (ALLOWED_URL_SCHEMES as readonly string[]).includes(new URL(v).protocol)
  } catch {
    return false
  }
}

/**
 * Most recent first, visit count breaking ties — so the address used
 * constantly stays at the top without a stale favourite outranking what was
 * on screen ten minutes ago. URL breaks the remaining tie only to keep the
 * order stable across reloads of the same file.
 */
function byRank(a: HistoryEntry, b: HistoryEntry): number {
  if (a.lastVisit !== b.lastVisit) return b.lastVisit - a.lastVisit
  if (a.visits !== b.visits) return b.visits - a.visits
  return a.url < b.url ? -1 : a.url > b.url ? 1 : 0
}

/**
 * The list after a committed navigation to `url`. Returns `entries`
 * *unchanged* — the same reference — when the URL is not one we store, which
 * is what lets the caller write the file only when something actually
 * changed.
 *
 * Eviction is by rank, so the least recently visited entry is the one that
 * goes; a busy day cannot push out the address visited an hour ago in favour
 * of one visited last year.
 */
export function recordVisit(entries: readonly HistoryEntry[], url: string, now: number): HistoryEntry[] {
  if (!isStorableUrl(url) || !isStamp(now)) return entries as HistoryEntry[]
  const previous = entries.find(e => e.url === url)
  const next: HistoryEntry = {
    url,
    visits: previous ? previous.visits + 1 : 1,
    lastVisit: now,
  }
  return [next, ...entries.filter(e => e.url !== url)].sort(byRank).slice(0, HISTORY_MAX)
}

/**
 * The rows to offer for what has been typed: case-insensitive substring
 * against the whole URL, in rank order. An empty query matches everything,
 * so pressing Down in an empty field offers the most recent addresses.
 */
export function matchHistory(
  entries: readonly HistoryEntry[],
  query: string,
  limit = HISTORY_SUGGESTIONS,
): HistoryEntry[] {
  const needle = query.trim().toLowerCase()
  return entries
    .filter(e => e.url.toLowerCase().includes(needle))
    .sort(byRank)
    .slice(0, Math.max(0, limit))
}

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
