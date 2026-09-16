---
title: "A test that skips on CI turns a regression green, and nothing states which skips are expected"
column: next
kind: bug
order: 61
---

FOUND BY WREN 2026-09-16, on the cold read of #141, and filed at Henry's request. **Unowned.**

## What happened

#141 made the harness window unable to become key. That silently disarmed `live-drive.spec.ts:349`,
*"focusWindow answers ok and fronts the window"*. With the window unfocusable, the fronting never
happened. The test's own guard then excused it with `test.skip(!focused, 'the runner did not grant
window focus')`, blaming a runner that does grant focus.

- **[Run `35144092875`](https://github.com/vibesyemmy/obsrv/actions/runs/35144092875)** (#141 at
  `eb2b114`), green: `- 221 tests/e2e/live-drive.spec.ts:349:5`, with totals `1 flaky, 1 skipped, 551
  passed`.
- **[Run `35144821829`](https://github.com/vibesyemmy/obsrv/actions/runs/35144821829)** (main at
  `08c116c`, just before): `553 passed`, **no skips at all**.

The skip count went **0 → 1 on a green run**. Rook caught it, and I confirmed it, only by reading the
log. Henry's fix on #141 (`focusWindow` makes the window focusable first, and the test asserts
`isFocusable()`) closes **that cause**. It does not close the class: any future change that stops a
test from doing its job, and trips one of its runtime `test.skip(...)` guards, is green on CI in
exactly the same way.

## Why this is the board's recurring shape

A skip is a silence that fits two facts: *this environment can't run the test* and *the product
stopped doing the thing the test checks*. Locally the first fact is common: desk state
(`hideEventsFire`), a non-HiDPI host, capture scaling. **On CI it is not: main's last full run before
#141 (`35144821829`) skipped nothing.** That is one run, so check a few more before relying on it. If it
holds, CI is the place where every skip is a finding until someone says otherwise.

## What a fix has to show

**A CI check that compares the run's skipped tests against a stated list, and fails on any test not
on it.** This is the `EXPLAINED` table in `surface-parity.spec.ts`, applied to skips:

- **The list likely starts empty**, going by `35144821829`. Confirm it against several recent main
  runs first. Each entry names the test and why it may skip there.
- **It fails on an unlisted skip**, naming the test and its skip reason.
- **It also fails on a stale row**, a listed test that no longer skips, as the `EXPLAINED` staleness
  test does. Otherwise the list becomes a place skips go to be forgotten.
- **It reads the run's own results**, e.g. Playwright's JSON reporter, not a grep of the list output.
  A reporter line is exactly the kind of text match this board has watched fail by matching nothing.
- **It must be shown to fire before its silence counts.** Control: re-apply #141's first head
  (`setFocusable(false)` without `focusWindow`'s `setFocusable(true)`) on a throwaway branch. The check
  must go red naming `live-drive.spec.ts:349`. Then the vacuity arm: remove the reporter output, and
  the check must fail loudly rather than pass on an empty set.

## Not established

- **Whether locally-run specs belong in the same check.** They skip for real desk reasons, so a local
  list would mostly be noise. The proposal is CI only.
- **Whether a retried test that skips on its retry counts as a skip.** Measure how the reporter
  records that before deciding.
