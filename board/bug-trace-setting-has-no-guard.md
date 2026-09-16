---
title: "Nothing would notice if the `trace` setting were dropped again — the week of silence has no guard"
column: next
kind: bug
order: 57
---

FOUND BY WREN 2026-09-16, on the cold read of `bug-trace-upload-errors-when-e2e-never-ran`, while
demolishing the reason I had written for keeping `if-no-files-found: error`. **Unowned.** Filed
separately on his instruction, so the gate change did not grow to hold it.

## The belief that was wrong

`ci.yml` has said since #29 (`cd52660`) that `if-no-files-found: error` is *"the only part of this
that survives someone dropping the trace setting again"*. **It isn't, and it never was.**

The week of silence was not an empty directory. `playwright.config.ts` set no `trace`, so
`test-results/` held `error-context.md` files and nothing else — **a non-empty directory**, which
`if-no-files-found: error` is by definition silent about.

Measured across every e2e failure between the upload step's creation (`1b0be8f`, 2026-08-25) and
#29's merge — **71 attempts**, being 58 runs plus 13 first attempts that were re-run to green and so
never appear under a latest-attempt query: **every one uploaded a non-empty `playwright-traces`**,
from 1,235 B (`34249494196`) to 178,059 B (`34107042439`). Not one empty. `error` would have fired
on none of them.

## So the gap

**If `trace` is removed from `playwright.config.ts` tomorrow, nothing goes red.** The upload keeps
succeeding, the artefact keeps being non-empty, the step keeps its name, and the traces are simply
gone — which is exactly the week `bug-trace-upload-empty` was filed about, reproduced in full, with
the check that was supposed to prevent it looking on.

The step's name is the part that misleads. *"Upload Playwright traces on failure"* asserts a
capability the config may or may not provide, and the green tells you the upload happened, not that
what it uploaded was a trace.

## What a fix has to do

**Assert the thing the name claims: that a trace is actually in there.** The obvious shapes, none of
them measured yet:

1. **Check the config**, in a unit test — `playwright.config.ts` must set `trace`. Cheap, and tests
   the setting rather than the outcome: it would pass on a config whose `trace` value never produces
   a file.
2. **Check the artefact**, in the upload step — after a failing e2e, `test-results/` must contain at
   least one `*.zip`. Tests the outcome, and can only run on a red run, which is the run you least
   want to add a new failure mode to.
3. **Both**, with the config check carrying the weight and the artefact check as the control that
   the config check is not vacuous.

## The control, which this card exists to insist on

**Delete `trace` from the config and watch the check go red.** A guard that has never been shown to
fire on the condition it guards is the same defect as the step it is guarding — and this card's
whole history is a check that everybody believed in and nobody had watched fail.

Then restore it and watch the check go green, so the guard is not merely always-red.
