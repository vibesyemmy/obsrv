import { describe, expect, it } from 'vitest'

/**
 * TEMPORARY — control 1 for `bug-trace-upload-errors-when-e2e-never-ran`, on a
 * throwaway branch that is never merged.
 *
 * Fails deliberately, in the UNIT step, so the run dies before Playwright has
 * run and before `test-results/` can exist. With the upload step gated on
 * `steps.e2e.outcome == 'failure'`, the expected outcome is:
 *
 *     failure   Unit tests
 *     skipped   E2E (Playwright driving the Electron app)
 *     skipped   Upload Playwright traces on failure   ← was `failure` before the gate
 *
 * If that step shows `failure`, the gate does not work and the PR is wrong.
 */
describe('temporary control: a failure before e2e', () => {
  it('fails on purpose so the run dies before Playwright starts', () => {
    expect('this test exists to fail').toBe('and it is deleted before merge')
  })
})
