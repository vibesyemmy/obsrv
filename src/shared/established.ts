/**
 * A value one test establishes and another reads, with the failure named.
 *
 * A spec file whose later tests read module-level state that its FIRST test
 * fills dies two ways. Run filtered, the filler is skipped and the reader
 * crashes inside the app's own code. Kenya hit it on
 * `tests/e2e/live-drive.spec.ts`, where `info` carries the control port and
 * token — a `-g` run of any later test died on `Cannot read properties of
 * undefined (reading 'token')`, which reads like a bug in whatever test you
 * just wrote, in whichever part of the app the value reached first.
 *
 * Run whole, it dies the second way the moment any test in the file fails:
 * Playwright replaces the worker after a failure and does not re-run the
 * filler, so every later test fails in milliseconds on the same missing value.
 * Main's run 35074542775 read as eleven failures and was one. This message
 * first named only the filtered run, so in CI it told the reader that ten red
 * tests downstream of a real failure were "the run, not the code". Its next
 * version named two causes as if that were all of them, and a reader who had
 * re-run one test by `file:line` would not have recognised "-g / -t" as their
 * case. So it keys on the one fact the reader can see — whether an earlier test
 * in this file failed in this run — and names the rest as an open set.
 * (`live-drive.spec.ts` now reads `info` in `beforeAll`, which every worker
 * runs; the guard stays for the next file that fills state in a test.)
 *
 * That is the same family as a suite green that measured nothing
 * (`scripts/suiteLock.js`, `tests/e2e/surface-parity.spec.ts`): the symptom
 * fits two facts — the code is broken, or this run never set the value up —
 * and nothing in it says which. This says which.
 *
 * It does not make the arrangement good. A file whose tests depend on each
 * other in order is still a file that cannot be run a test at a time; this
 * makes the dependency announce itself instead of being discovered by
 * debugging the wrong thing.
 */
export class EstablishedError extends Error {}

/**
 * Returns `value` when it is anything other than `undefined` or `null`, and
 * otherwise throws naming what is missing and what fills it.
 *
 * Only nullish counts as unestablished: `0`, `''`, `false` and `NaN` are
 * values somebody may legitimately have set, and a guard that fires on them
 * teaches people to remove it — the same fate as a lock that refuses on a dead
 * holder.
 *
 * @param what  the variable's name, as written in the file
 * @param filler what would have set it: "the file's first test", "beforeAll"
 */
/** Whether a run counted nothing — the state whose pass says nothing. */
export function measuredNothing(count: number): boolean {
  return count === 0
}

/**
 * The message for an assertion that a run had evidence at all.
 *
 * A test that passed having checked nothing and a test that passed having
 * checked everything are the same green. The only instance of this assertion
 * anyone had written (`tests/e2e/surface-parity.spec.ts`) was added after a
 * filtered run starved its rows and a planted stale row passed; this is its
 * wording, kept in one place so the next one is not discovered the same way.
 *
 * @param counted  what a non-zero count would have been: "tool compared on any page"
 * @param remedy   what the reader should do: "run the whole file rather than a filtered subset"
 */
export function noEvidenceMessage(counted: string, remedy: string): string {
  return (
    `No ${counted}, so this test had nothing to check. ` +
    `A pass here is not evidence — it is the absence of any — so ${remedy}.`
  )
}

export function established<T>(value: T | undefined | null, what: string, filler: string): T {
  if (value === undefined || value === null) {
    throw new EstablishedError(
      `${what} was never established: ${filler} did not run in this worker. ` +
        `If an earlier test in this file failed in this run, this is its echo — Playwright replaced the worker ` +
        `without re-running ${filler} — so read that first failure. ` +
        `If none did, this test ran without ${filler}: selected on its own (-g, -t, file:line, --last-failed, ` +
        `test.only), the filler skipped, or the file's tests split across workers — so run the file whole, in order.`,
    )
  }
  return value
}
