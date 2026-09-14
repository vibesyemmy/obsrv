import { describe, expect, it } from 'vitest'
import playwrightConfig from '../../playwright.config'
import { E2E_NAVIGATE_WAIT_MS } from '../../tests/e2e/launch'

/**
 * A budget inside the app and the budget the test runner gives it must not be
 * the same number.
 *
 * `navigateWithin` answers with the page as it stands when a load has not
 * finished within `OBSRV_NAVIGATE_WAIT_MS`, which is 30 s in production —
 * exactly Playwright's per-test timeout. Every e2e app inherited that default
 * except the one spec that overrode it, so a slow load killed the test at the
 * instant the app would have answered: no assertion, no error, a 30.0 s hang,
 * and a worker teardown that took the file's remaining tests with it.
 *
 * These assertions are the lesson rather than the symptom. They cannot
 * reproduce a contended CI runner, but they can refuse the arrangement that
 * made a contended runner undiagnosable.
 */
describe('the e2e harness leaves the app room to answer', () => {
  const testTimeout = playwrightConfig.timeout ?? 0
  const expectTimeout = playwrightConfig.expect?.timeout ?? 0

  it('gives navigate a budget well inside the per-test timeout', () => {
    expect(testTimeout).toBeGreaterThan(0)
    // Not merely "less than": a budget a hair under the timeout leaves no room
    // for the assertions that follow the navigation, and fails the same way.
    expect(E2E_NAVIGATE_WAIT_MS).toBeLessThanOrEqual(testTimeout / 2)
  })

  it('leaves room for a navigation and the assertion after it', () => {
    // The shape of almost every spec here: navigate, then wait for the page to
    // show something. Both budgets have to fit inside one test.
    expect(E2E_NAVIGATE_WAIT_MS + expectTimeout).toBeLessThan(testTimeout)
  })

  it('is long enough for a local fixture on a slow machine', () => {
    // The other direction: a budget so short that a healthy load is cut off
    // would trade a rare hang for a common wrong answer.
    expect(E2E_NAVIGATE_WAIT_MS).toBeGreaterThanOrEqual(5_000)
  })
})
