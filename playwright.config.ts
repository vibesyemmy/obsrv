import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  /**
   * One retry, for contention — not for hiding failures.
   *
   * This suite drives a real Electron app that rasterises offscreen, composites
   * through the GPU and streams frames over IPC, and a few of its failures come
   * from that stack rather than from the app: a capture returning
   * `UnknownVizError`, a synthesised drag landing short, Playwright's inspector
   * reporting `Resulting promise was garbage collected`. Every one of them
   * passes alone and on a re-run, and none could be reproduced deliberately —
   * see docs/e2e-flakes.md for what was tried and ruled out.
   *
   * A retried test that passes is reported as **flaky**, not as passed, so this
   * names the problem rather than swallowing it: a real failure still fails
   * twice and still reports failed. The alternative is that one blip turns a
   * good branch red, which teaches everyone to re-run without reading — a worse
   * outcome than a labelled flake.
   *
   * A rising flaky count means something changed in the app, not in the
   * weather. That is the signal to reopen it.
   */
  retries: 1,
  reporter: [['list']],
})
