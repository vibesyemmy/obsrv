---
title: "A test that skips on CI turns a regression green, and nothing states which skips are expected"
column: done
owner: "Henry"
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

## PROGRESS 2026-09-16 by Henry: the check, and its controls

**Measured first, as the card asked:** eight main CI suite runs on 2026-09-16 (`35144253768` through
`35152238927`), and **none reports a skipped test**. Some had flaky tests and one had failures. So
the list starts empty.

**The check:**
- On CI, Playwright also writes a JSON report, to `playwright-report/`. It can't go in
  `test-results/`: the trace upload's `if-no-files-found: error` exists for a failing run that wrote
  nothing there, and a report file would silence it.
- After a *passing* e2e step, `scripts/check-e2e-skips.js` compares the report's skipped tests with
  `tests/e2e/expected-skips.json`, keyed by file and full title (lines move).
- It fails on an unlisted skip, naming the file, line, title and the test's own skip reason. It also
  fails on a listed row whose test ran, and on a report that is missing or accounts for no tests.
- It runs only after a passing e2e step, because a failure in a serial group skips the rest of that
  group, and that is the failure's news.

**Controls (unit), one run each:** four sabotages, each red on exactly its test. Ignoring unlisted
skips, ignoring stale rows, accepting an empty report and dropping describe titles from the key. The
report fields read (`suites`, `specs`, `tests[].status`, `annotations`, `stats`) are confirmed against
Playwright's own `JSONReport` types.

**Wren's cold read, all three taken:**
- **The walk is cross-checked against the report's own count.** If the nesting changes, the walk finds
  nothing while `stats.skipped` still counts skips, and the check would have printed "0 skipped, all
  listed" over a run that skipped tests. Now it fails, naming both numbers.
- **A test that failed and then skipped on its retry is flagged.** Playwright reports it as flaky,
  not skipped, and the run stays green.
- **A skip's reason is read from each result's annotations as well as the test's.** A runtime
  `test.skip(condition, reason)` may land on the result only.

Each has its own unit arm, and removing each check turns its arm red.

**The CI control Wren asked for:** a draft PR carrying this check on #141's first head (`eb2b114`,
whose CI skipped `focusWindow`'s test) must go red, naming that test.

## DONE 2026-09-17, merged as `#156` (093d1c3) on 2026-09-16; closed a night late

**The CI control went red, naming the test.** Draft `#157` (closed, never merged) carried the check on
#141's first head. In run [`35154669669`](https://github.com/vibesyemmy/obsrv/actions/runs/35154669669)
the E2E step **passed** (`553 passed`, `1 skipped`), and the new step failed with:

    skipped and not listed: live-drive.spec.ts:351 › focusWindow answers ok and fronts the window (takes the desk: CI, or locally with OBSRV_E2E_FRONT=1) (its reason: "the runner did not grant window focus")

**Checked, because a pull_request run doesn't test the head alone.** The suite checked out `b80450b`,
GitHub's merge of the control into main at `ae0cfa6`. `ae0cfa6` doesn't contain #141's merge
(`3a919be`), so nothing from #141's fix was in that tree. Rebuilt locally with `git merge-tree`,
`git grep` finds **one** `setFocusable` under `src`: `win.setFocusable(false)` at
`src/main/window.ts:32`. `focusWindow` has no `setFocusable(true)`, so the sabotage was in force. The
merge also explains `:351`: main had two more lines above the test than `eb2b114`. The list is keyed
by file and title, so the line doesn't change which row a skip matches.

**The script changed after the control, and the control still applies.** The control's copy is
byte-identical to `9e5a442`. Wren's reads (`7c03197`) and the retry rule (`6a36222`) came after it.
Diffed against the control's copy, neither changes how a plain skip is found:
- the `t.status === 'skipped'` test is unchanged;
- the reason is still read from the test's annotations (the result's are added);
- the new walk-vs-`stats` cross-check would have agreed on that run: the list reporter counted
  `1 skipped`, and the walk found one.

Playwright is `1.62.1` in both trees, so the report shape is the one the control read.

**The vacuity arm, on CI rather than only in the unit arm.** The check throws on a report it can't
read, and on one that accounts for no tests. Every completed main push run since `#156` merged
(22:54Z, 85 runs, attempt 1) breaks down as:
- **30** ran E2E and passed it, and the check passed on every one, so the report is written where
  the check reads it;
- **53** were board-only, with both steps skipped;
- **2** failed E2E (`35170587213`, `35182050784`), where the check doesn't run, by design.

**Neither "Not established" item is still open:**
- **Local specs:** the check runs only in `ci.yml`, as proposed.
- **A retry that skips:** the last attempt decides (`6a36222`). Run `35155348601` showed why. Under
  the "any attempt skipped" rule, the check named `surface-parity.spec.ts:578`, which skipped behind a
  failing serial sibling and then passed on its retry.

`tests/e2e/expected-skips.json` is still empty. With an empty list, a passing check means no skip.
**So none of those 30 runs skipped an e2e test**, and the first row added will be a decision someone
writes down.

