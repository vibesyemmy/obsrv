import { ALLOWED_URL_SCHEMES } from './url'

/**
 * Everything about visited-URL history that can be decided without Electron
 * — and, unlike `shared/settings.ts`, without touching the disk either: what
 * may be stored, how a visit updates the list, the cap, the ranking and the
 * substring match the URL bar types against. The renderer imports
 * `matchHistory` on every keystroke, so a `node:fs` import here would put
 * `node:fs` in the renderer bundle; the file half lives in
 * `shared/historyFile.ts` next door.
 *
 * Main owns the one hook that calls `recordVisit` (`src/main/ipc.ts`, off the
 * native pane's `did-navigate`); the renderer owns the dropdown and calls
 * `matchHistory` only. Unit-tested directly in tests/unit/history.test.ts.
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

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
export const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1
export const isStamp = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

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
export function byRank(a: HistoryEntry, b: HistoryEntry): number {
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
