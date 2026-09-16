---
title: "Once on main, `ipc.spec:31` waited 30 s for a url-changed that never came, and two later tests found the native pane invisible on both tries"
column: next
kind: bug
order: 60
---

FOUND BY HENRY 2026-09-16, reading why main's CI went red at `5e426fb` (#139's merge). **Unowned.
Observed once, cause unknown.**

## Observed, in run [`35145262453`](https://github.com/vibesyemmy/obsrv/actions/runs/35145262453), attempt 1

    ipc.spec.ts:31   reports the URL the native pane navigated to   30.0 s, both tries
                     first line: "Test timeout of 30000ms exceeded." (the "Target page … closed"
                     under it is teardown)
    ipc.spec.ts:134  image mode hides the native pane …   1.2 s, both tries
                     :167  expect(native.isVisible()).toBe(true)   → false
    ipc.spec.ts:173  ignores malformed payloads           217 ms, both tries
                     :191  expect(after.visible).toBe(true)        → false

`:31` navigates the native pane to `about:blank` through `window.obsrv.navigate` and waits for
`onUrlChanged`. It never came. **`:134` and `:173` failing on their retries too** means each failed
alone in a fresh worker. So this is not only a dependency on `:31` having left state behind: the native
pane read as invisible in a freshly replaced worker too.

## How often, measured rather than guessed

Every CI attempt in the API's last 96 runs (2026-09-16, 16:05Z–20:49Z), searched for `ipc.spec.ts:31`.
The detector was checked against this run first, where it finds both tries:

    attempts that ran ipc.spec:31     44
    failed                             1   (this run)
    before #129 merged (19:25:45Z)    28 ran, 0 failed
    after                             16 ran, 1 failed

**One against zero is not a difference.** #129 changed `NativePane` (load and commit recording) and
merged 48 minutes before this run. That makes it the obvious suspect, and nothing here supports it
over coincidence. The window also starts at 16:05Z, so anything older is unswept.

## Not established

- Why `url-changed` never arrived for `about:blank`, and why `isVisible()` read false in fresh workers.
  Both point at the native pane on that runner at that time, not at one test's state.
- Whether it is new. A wider sweep (older runs, via the per-attempt logs) is the first step, before
  any reading of `NativePane`.
