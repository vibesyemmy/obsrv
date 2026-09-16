import { test } from '@playwright/test'

/**
 * TEMPORARY — control 4 for `bug-trace-upload-errors-when-e2e-never-ran`, on a
 * throwaway branch that is never merged.
 *
 * Raised by Wren: traces matter most when e2e HANGS, and a hang does not end in
 * a failure. The `test` job has `timeout-minutes: 30` and the e2e step has no
 * timeout of its own, so a hang ends as a job-level timeout, which GitHub
 * records as CANCELLED, not failed. A manual cancel is the same outcome and
 * costs 25 fewer minutes, so this run is cancelled by hand once e2e is running.
 *
 * Two things are being read, in one run:
 *   1. the gated upload  (`always() && steps.e2e.outcome == 'failure'`)
 *   2. a probe step carrying the OLD gate (`if: failure()`)
 *
 * If BOTH are skipped, the gate did not take traces away from hanging runs —
 * they were never uploaded for one. That makes "not a regression" observed
 * rather than argued.
 */
test('control4 hangs until the run is cancelled', async () => {
  test.setTimeout(0)
  await new Promise(() => {})
})
