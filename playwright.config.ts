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
  // Trace the RETRY attempt, which under `retries: 1` is exactly the
  // population every flake card here is about: a failure that survived one
  // re-run, plus the first-attempt failures that a retry rescues and the
  // summary line calls flaky.
  //
  // Until now this file set no `trace`, `screenshot` or `video` at all, so
  // Playwright's defaults applied and all three were off. A failing run left
  // `error-context.md` and nothing else, while `ci.yml`'s step named "Upload
  // Playwright traces on failure" uploaded an empty directory and passed —
  // uploading nothing succeeds. Three sessions spent a day reasoning from an
  // artefact that was never going to hold the answer: the blue channel on
  // vision:47, the focus state on controls:85, the console line that would
  // name a GPU process exit on panes:83. Found by Rook, 2026-09-15.
  //
  // `screenshot` is here because the trace ALONE does not carry one. Measured
  // rather than assumed: with `trace: 'on-first-retry'` the Electron trace
  // holds `context-options`, the action log and the error, and NOTHING else —
  // no console entries, no DOM snapshots, no per-action screenshots, with
  // `screenshots: true, snapshots: true` explicitly set and ignored. So the
  // trace would not have answered either question this week: no picture for
  // vision:47's white-or-yellow pixel, no console for panes:83's GPU exit.
  // `screenshot: 'only-on-failure'` writes a real PNG per page at failure —
  // five of them for this app, shell and both panes — which is what answers a
  // question about what was on screen. Electron's own stdout already reaches
  // the report as `[pid=…][err]` Browser logs when the app dies.
  use: { trace: 'on-first-retry', screenshot: 'only-on-failure' },
  /**
   * `OBSRV_DESK_SAFE=1` leaves out the specs that boot Electron through the
   * CLI. `npm run test:e2e:desk-safe` sets it.
   *
   * **Why this is here rather than in each agent's command line.** The rule
   * that these run on CI was real, was enforced by everyone remembering it,
   * and was written down nowhere. On 2026-09-17 a sweep excluded them with
   * `/cli-/` — the pattern anyone would write — and about fourteen
   * `cli.spec.ts` tests ran on Opeyemi's desk, because sixteen files in that
   * family are `cli-*` and exactly one is `cli.spec.ts`. The glob that is
   * right is `cli*`, and the difference is one character.
   *
   * `testIgnore` matches FILE PATHS. `--grep` matches test titles, which is
   * what makes a hand-written pattern a guess about what it is matching
   * against. See `bug-cli-specs-have-no-gate-of-their-own`.
   */
  ...(process.env['OBSRV_DESK_SAFE'] === '1' ? { testIgnore: ['**/cli*.spec.ts', '**/throttle-refused.spec.ts'] } : {}),
  // On CI, a JSON report as well, which scripts/check-e2e-skips.js reads to fail
  // a green run that skipped a test nobody listed (bug-ci-skips-are-unlisted).
  // It goes to playwright-report/, not test-results/, because the trace upload's
  // `if-no-files-found: error` exists for a failing run that wrote nothing into
  // test-results/, and a report file there would silence it.
  reporter: process.env['CI'] ? [['list'], ['json', { outputFile: 'playwright-report/results.json' }]] : [['list']],
})
