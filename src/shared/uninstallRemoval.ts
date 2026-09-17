import type { UninstallReport } from './uninstallReport'
import type { GuardVerdict } from './removalGuard'

/**
 * The removing half of `obsrv uninstall`, as a decision rather than an action.
 *
 * The listing half (`uninstallReport`) touches no filesystem because it does not
 * need to. This half cannot be pure — something has to call `rm` — so the split
 * is drawn one step further in: **this module decides, the caller acts**, and
 * every decision is testable without a single real file.
 *
 * **Authorised by Opeyemi on 2026-09-17**, in the session that wrote it, which
 * is the condition `chore-uninstall-path` set before any deletion code existed.
 *
 * ## What it refuses to do, and why each one is here
 *
 * **It re-checks every path immediately before that path is removed.** The
 * report already put each through `checkRemoval`, but a report can be minutes
 * old, built from a plan computed against a home that has since changed, or —
 * once this is a library — handed in by a caller who built it somewhere else.
 * The check that matters is the one that happens with the `rm` in hand, so the
 * guard runs twice and the second time is the one that counts.
 *
 * **It removes nothing the report did not list as present and allowed.** Not
 * the `keep` list, not the refusals, not the absent paths — an `rm` of a path
 * that is not there reports success for removing nothing, which is the empty
 * success this whole card family exists to refuse.
 *
 * **It stops at nothing and reports everything.** One failed removal does not
 * abandon the rest, and does not vanish: a caller that removed three of four
 * needs to know which one is still there, and a person reading the output needs
 * it more.
 *
 * **It never decides that a path is safe.** That is `checkRemoval`'s job, and
 * that function's own comment is explicit that it narrows the symlink hole
 * rather than closing it: the caller must `lstat` and refuse to descend into
 * links. The `rm` this module hands out is therefore specified as
 * link-respecting (see `Remove`), and `bin/uninstall.js` satisfies it with
 * `rmSync({ recursive: true })`, whose behaviour on a symlinked directory is
 * pinned by a measured test rather than assumed.
 */

/**
 * Removes one path, recursively, **without following symbolic links** — a link
 * is unlinked, never descended into. Throws on failure.
 */
export type Remove = (path: string) => void

export interface RemovalInput {
  report: UninstallReport
  /** `checkRemoval`, run again per path at the moment of removal. */
  check: (path: string) => GuardVerdict
  remove: Remove
}

export interface Removed {
  path: string
  bytes?: number | undefined
}

export interface NotRemoved {
  path: string
  /** Why: the guard's refusal, or the error the removal threw. */
  because: string
}

export interface RemovalResult {
  removed: Removed[]
  /** Listed as present and allowed, and still not removed. Never silent. */
  failed: NotRemoved[]
  /** Refused by the guard at removal time, including any the report had allowed. */
  refused: NotRemoved[]
  /** True when the report said this platform has nothing measured to remove. */
  unmeasured: boolean
}

export function removeListed({ report, check, remove }: RemovalInput): RemovalResult {
  const result: RemovalResult = { removed: [], failed: [], refused: [], unmeasured: report.unmeasured }
  // A platform nobody measured has a plan of nothing. Removing "nothing" is
  // fine; the point is that this returns before touching a filesystem it has
  // no map of.
  if (report.unmeasured) return result

  for (const entry of report.present) {
    const verdict = check(entry.path)
    if (!verdict.allow) {
      // The report allowed it and the guard now refuses. That is worth
      // surfacing rather than skipping quietly: it means the two disagree, and
      // the one holding the `rm` wins.
      result.refused.push({ path: entry.path, because: verdict.refuse })
      continue
    }
    try {
      remove(entry.path)
      result.removed.push({ path: entry.path, bytes: entry.bytes })
    } catch (e) {
      result.failed.push({ path: entry.path, because: e instanceof Error ? e.message : String(e) })
    }
  }
  return result
}

/** The removal as the words a person reads, beside `uninstallLines`. */
export function removalLines(result: RemovalResult): string[] {
  if (result.unmeasured) return ['Nothing was removed: Obsrv has nothing measured to remove on this platform.']
  const lines: string[] = []
  if (result.removed.length === 0) lines.push('Nothing was removed.')
  else {
    lines.push('Removed:')
    for (const r of result.removed) lines.push(`  ${r.path}`)
  }
  if (result.refused.length > 0) {
    lines.push('')
    lines.push('Refused at the moment of removal, and left alone:')
    for (const r of result.refused) {
      lines.push(`  ${r.path}`)
      lines.push(`      ${r.because}`)
    }
  }
  if (result.failed.length > 0) {
    lines.push('')
    // Named individually: "some removals failed" leaves a person to work out
    // which of their directories is still there.
    lines.push('Still here — the removal failed, and the reason it gave:')
    for (const r of result.failed) {
      lines.push(`  ${r.path}`)
      lines.push(`      ${r.because}`)
    }
  }
  return lines
}
