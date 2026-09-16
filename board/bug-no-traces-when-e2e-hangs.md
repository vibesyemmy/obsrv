---
title: "A hung e2e run uploads no traces — the one case where you most want them"
column: next
kind: bug
order: 55
---

FOUND BY WREN 2026-09-16, as a question on the cold read of `bug-trace-upload-errors-when-e2e-never-ran`,
and measured by Rook while verifying that card's fix. **Unowned.**

## What happens

The trace upload step fires on the e2e step having **failed**. A hang is not a failure.

`.github/workflows/ci.yml`'s e2e step has no `timeout-minutes` of its own, and the `test` job has
`timeout-minutes: 30`. So an e2e run that hangs — a target that never settles, an Electron window
that never closes, a `waitFor` with nothing coming — can only end as a **job-level timeout**, which
GitHub records as `cancelled`, not `failure`. A person cancelling the run by hand produces the same
outcome.

Measured on [run `35115147209`](https://github.com/vibesyemmy/obsrv/actions/runs/35115147209), a
deliberately hanging test cancelled once e2e was genuinely running:

    cancelled   E2E (Playwright driving the Electron app)
    skipped     OLD GATE probe                        ← a throwaway step holding the older `if: failure()`
    skipped     Upload Playwright traces on failure

**This is not a regression, and that was checked rather than assumed.** The run carried a probe step
holding the previous `if: failure()` gate beside the current one, because `failure()` is also false
on a cancelled job. Both skipped. No version of this step has ever uploaded traces for a hung run.

## Why it is worth a card anyway

A hang is the failure a trace helps with most. A test that fails with an assertion already tells you
what it wanted and what it got, in the log. A test that hangs tells you nothing: the log stops
mid-run, and the artefact that would say what the app was showing at that moment is precisely the
one not collected. The suite has had hangs before — `bug-app-closes-under-stall-spec` is one — and
each was diagnosed without traces because there were none to have.

## What a fix has to decide

Not simply `|| steps.e2e.outcome == 'cancelled'`. That would also fire when a person cancels a run
deliberately, and — more importantly — **a cancelled step may not have flushed its traces to disk**,
so the upload could then meet an empty or half-written `test-results/` and go red on a run nobody
was failing. `if-no-files-found: error` is doing real work on that step
(`bug-trace-upload-errors-when-e2e-never-ran`), and this must not be the change that makes it cry
wolf again.

The likelier shape is a **step-level `timeout-minutes` on the e2e step**, set below the job's 30, so
a hang ends as a step *failure* with Playwright given the chance to write what it has. Whether
GitHub records a step killed by its own `timeout-minutes` as `failure` or `cancelled` is **not
established here** — the workflow has no step-level timeout today, so there was nothing to observe.
**Measure that before building on it**: it is the whole hinge of this approach, and it is one
throwaway run to settle.

## The control

A run whose e2e step hangs and is killed by a short step-level timeout must show the upload step
running, and must attach whatever Playwright managed to write. And the existing controls must still
hold: a run that dies before e2e uploads nothing, and a run whose e2e fails with an empty
`test-results/` still goes red.
