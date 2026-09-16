import { test, expect } from '@playwright/test'

/**
 * TEMPORARY — control 2 for `bug-trace-upload-errors-when-e2e-never-ran`, on a
 * throwaway branch that is never merged.
 *
 * Fails deliberately IN the e2e step, so Playwright writes `test-results/`
 * (at minimum an `error-context.md`). With the upload gated on
 * `steps.e2e.outcome == 'failure'`, the expected outcome is:
 *
 *     failure   E2E (Playwright driving the Electron app)
 *     failure   Upload Playwright traces on failure   ← no: SUCCESS, see below
 *
 * Precisely: the e2e step is red, the upload step RUNS (the gate lets it) and
 * SUCCEEDS (the directory is not empty), and artifacts are attached.
 *
 * This is the arm that control 3 cannot give: control 3 showed the upload
 * still goes red on an EMPTY directory, which proves the check was kept.
 * This one shows it goes green on a populated one, which proves the gate did
 * not simply break the step.
 */
test('control2 fails inside the e2e step so test-results is written', () => {
  expect('a deliberate failure').toBe('with artefacts on disk')
})
