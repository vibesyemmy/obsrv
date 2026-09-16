---
title: "A run that outlasts the job's 30 minutes uploads no traces — and that is the run you cannot read"
column: next
kind: bug
order: 55
---

FOUND BY WREN 2026-09-16, as a question on the cold read of `bug-trace-upload-errors-when-e2e-never-ran`;
measured by Rook, and **narrowed by Wren on a second read that removed most of its original scope**.
**Unowned.**

## What happens

The trace upload fires on the e2e step having **failed**. A run killed by the job's
`timeout-minutes: 30` is `cancelled`, so it uploads nothing.

**A hanging test is usually not this case, and the first version of this card wrongly said it was.**
Every spec has a finite timeout — `playwright.config.ts` sets `timeout: 30_000`, describe-level
overrides go up to `900_000`, and none is zero — so a test that never finishes ends as a **test
failure**: e2e goes `failure` and the upload runs normally. Runs `34995218008` and `35086053288` are
that shape: *"Test timeout of 30000ms exceeded"*, e2e red, upload green.

**The case that survives is a run that exhausts the job's 30 minutes.** e2e takes ≈17 of them on a
green main, leaving ≈12 spare, and two things spend that:

- **one hung attempt in `surface-parity.spec.ts`**, which is `mode: 'serial'` with `timeout: 900_000`
  — 15 minutes, by itself more than the slack
- **a hang that catches many tests at once**, each burning its own 30 s

Measured on [run `35115147209`](https://github.com/vibesyemmy/obsrv/actions/runs/35115147209), a
deliberately hung test (`test.setTimeout(0)`, which no real spec does) that ran the job out:
annotation *"The job has exceeded the maximum execution time of 30m0s"*.

    cancelled   E2E (Playwright driving the Electron app)
    skipped     OLD GATE probe                        ← a throwaway step holding the older `if: failure()`
    skipped     Upload Playwright traces on failure

**Not a regression, and that was checked rather than assumed.** The run carried a probe step holding
the previous `if: failure()` gate beside the current one, because `failure()` is false on a cancelled
job too. Both skipped. No version of this step has ever uploaded traces for a timed-out run.

**A second gap, same effect:** `trace` is `on-first-retry`, so a hang on attempt 1 has no trace to
upload under **any** gate.

## Why it is worth a card

A timed-out run is the one you cannot read. A test that fails an assertion says what it wanted and
what it got, in the log. A run killed at 30 minutes stops mid-sentence, and the artefact that would
show what the app was doing is exactly the one not collected.

**It is not, however, the cause of the traceless diagnoses on this board.**
`bug-app-closes-under-stall-spec` looks like a candidate and is not one: its log shows the app
exiting mid-test (*"Target page, context or browser has been closed"*, *"closed: sessions down"*),
and it had no traces because run `34924677951` predates the `trace` setting entirely — not because
the upload was skipped.

## What a fix has to decide, and what it must measure first

**Not simply `|| steps.e2e.outcome == 'cancelled'`.** A cancelled step may not have flushed
`test-results/`, so the upload would then meet an empty or half-written directory and go red on a run
nobody was failing — putting back the cry-wolf defect that
`bug-trace-upload-errors-when-e2e-never-ran` just removed.

Two shapes are worth weighing, and **each rests on something not established here**:

1. **A step-level `timeout-minutes` on the e2e step**, below the job's 30, so the run ends as a step
   *failure* with Playwright given a chance to write what it has. **Unmeasured:** whether GitHub
   records a step killed by its own `timeout-minutes` as `failure` or `cancelled`. The workflow has
   no step-level timeout today, so there was nothing to observe. One throwaway run settles it, and
   the whole approach hinges on the answer.
2. **Playwright's `globalTimeout`,** set under the job's spare time, so Playwright stops itself and
   writes its own output rather than being killed from outside. **Unmeasured:** what it leaves in
   `test-results/` when it fires.

One more thing to know before building on either: **run `35115147209` shows the outcome, not the
mechanism.** Both steps skipped is equally consistent with "the gate evaluated and the outcome test
was false" and with "nothing runs after a job-level timeout at all". Anyone trying `cancelled` in the
`if:` needs to know which, because the second would mean the step never gets the chance.

## The control

A run whose e2e is killed by whichever mechanism is chosen must show the upload step **running**, and
must attach whatever Playwright managed to write. And the existing controls must still hold: a run
that dies before e2e uploads nothing, and a run whose e2e fails having written nothing still goes red.
