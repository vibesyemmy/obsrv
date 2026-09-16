/**
 * Which `NativePane.load()` record belongs to a navigation a spec issued.
 *
 * Not `at(-1)`, and the difference decides the answer in the one case the
 * trace exists for. **The sync bus mirrors into the native pane through the
 * same method** (`syncBus.ts:226`, `else void other.load(url)`), so every
 * mirror leaves a record too, and a mirror that starts after the spec's own
 * load is the last record.
 *
 * In `bug-sync138-no-url-changed`'s hypothesis (a) — the step-2 REDIRECT load
 * aborted by a later navigation — the aborted record is second from last and
 * the mirror's `ok` is last. Reading `at(-1)` would print `ok`, and the reader
 * would conclude (b), the opposite fact. So the record is chosen by what was
 * asked for and when, never by position.
 */

export interface LoadRecordLike {
  at: number
  url: string
  outcome: string
  tookMs: number
}

/**
 * The first load of `url` started at or after `startedAt` — the spec's own
 * navigation. `load()` records the normalised URL, and a `file://` URL
 * normalises to itself, so the comparison is exact.
 */
export function loadIssuedAt<T extends LoadRecordLike>(records: readonly T[], url: string, startedAt: number): T | undefined {
  return records.find(r => r.url === url && r.at >= startedAt)
}

/**
 * How many other loads the native pane began after that one. A mirror into the
 * native pane during step 2 is itself evidence — it is the mechanism the
 * hypothesis names — so it is counted and printed rather than merely skipped.
 */
export function loadsAfter<T extends LoadRecordLike>(records: readonly T[], picked: T): number {
  return records.filter(r => r !== picked && r.at >= picked.at).length
}
