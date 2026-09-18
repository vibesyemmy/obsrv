import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter'
import { appendFileSync } from 'node:fs'

/**
 * PROBE ONLY (`probe/desk-recorder`, `bug-e2e-takes-the-desk`). Never merge.
 *
 * **This is the instrument runs 3 and 4 did not have.** Both counted activations
 * and neither could attribute one, for a reason the card states plainly: *the
 * suite log carries no wall clock*. Run 3 therefore attributed by arithmetic
 * over cumulative durations and named a spec that run 4 cleared; run 4's
 * timestamp sampler "had nothing to timestamp".
 *
 * A front-app watcher says *an activation happened at 02:21:04*. The in-app
 * recorder says *a call was made at 02:21:04, from here*. Neither says **which
 * test was running**, and that is the join the attribution needs. One line per
 * test boundary with an ISO clock closes it.
 *
 * Writes to `OBSRV_DESK_CLOCK`; unset, it records nothing.
 */
const dest = process.env['OBSRV_DESK_CLOCK'] ?? ''

function line(kind: string, title: string, extra = ''): void {
  if (dest === '') return
  try {
    appendFileSync(dest, `${new Date().toISOString()}\t${kind}\t${title}${extra === '' ? '' : `\t${extra}`}\n`)
  } catch {
    // A reporter that throws would take the suite down with it.
  }
}

export default class DeskClockReporter implements Reporter {
  onBegin(): void {
    line('SUITE', 'begin')
  }

  onTestBegin(test: TestCase): void {
    line('BEGIN', `${test.location.file.split('/').pop() ?? ''}:${test.location.line} ${test.title}`)
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    // The status matters for reading the join: an activation inside a test that
    // then failed and retried is a different story from one inside a pass.
    line(
      'END',
      `${test.location.file.split('/').pop() ?? ''}:${test.location.line} ${test.title}`,
      `${result.status} retry=${result.retry} ${result.duration}ms`,
    )
  }

  onEnd(): void {
    line('SUITE', 'end')
  }
}
