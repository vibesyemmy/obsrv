---
title: "A run that outlasts the job's 30 minutes uploads no traces — and that is the run you cannot read"
column: doing
owner: "Rook"
waiting: ""
kind: bug
order: 55
---

FOUND BY WREN 2026-09-16, as a question on the cold read of `bug-trace-upload-errors-when-e2e-never-ran`;
measured by Rook, and **narrowed by Wren on a second read that removed most of its original scope**.
**Unowned.**

## Claimed by Rook 2026-09-16, assigned by Wren. First step is a measurement, not a fix.

Both candidate shapes rest on something unestablished, so those come first and cheap. **Pre-registered
before either runs, so neither result can be re-read afterwards as the one I expected:**

**A — does GitHub record a step killed by its own `timeout-minutes` as `failure` or `cancelled`?**
A throwaway job whose step sleeps past a 1-minute `timeout-minutes`; read the *step's* conclusion.

- I **expect `failure`**, on the reasoning that a step timeout is the step's own outcome while a job
  timeout is the runner giving up on the job. That is a guess, and the card exists because nobody has
  looked.
- **If `failure`:** the step-level-timeout shape is viable and becomes the leading candidate.
- **If `cancelled`:** that shape is **dead** — it would end in exactly the state that already uploads
  nothing — and `globalTimeout` is the only candidate left. This is the outcome that would cost the
  most to discover after building on it, which is why it is measured first.

**B — what does Playwright's `globalTimeout` leave in `test-results/`?**
One short spec under a tiny `globalTimeout`, then list the directory.

- I **expect it to leave something** — Playwright stopping itself should write what it has, unlike
  being killed from outside — but *what*, and whether any of it is a trace rather than only
  `error-context.md`, is exactly the open question. The distinction matters: an artefact with no
  trace in it is what started this whole family (`bug-trace-upload-empty`), and a directory that is
  merely non-empty would satisfy `if-no-files-found: error` while carrying nothing worth reading.
- **If it leaves nothing:** `globalTimeout` is dead too, and both shapes fall — which would be the
  most useful possible result, because it says the fix is not in this direction at all.

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

## How often this has actually happened: once, and that once was the control

Measured by Wren across the workflow's **entire history**, not a window — he asked for the last 100
cancelled runs and then found the workflow has only ever had about 30, so the true claim is stronger
than the one he first wrote:

- across the **latest attempt of every run** (591), the only run of 29 minutes or more that did not
  succeed is control 4; the rest at 29–37 minutes all concluded `success`, so none of them can be
  holding a timed-out job;
- across the **earlier attempts of all 17 re-run runs**, the longest was 25 minutes and none was
  cancelled.

**So, as of a sweep at ≈17:55 WAT on 2026-09-16 covering 591 runs, control 4 is the only job in
this workflow's history to have hit the 30-minute limit.** Re-read at 18:40 WAT against 607 runs:
still only control 4, and still 17 re-run runs.

**The date is not decoration.** An unqualified "ever" is exactly as time-bound as the population
count warned about below, and a later reader finding 700 runs would otherwise have to work out
whether the claim had been checked against their tree or mine. Two lines apart, the same mistake:
the first draft of this section warned about drifting counts and then wrote an unbounded quantifier
underneath it (Wren).

Two things this does *not* say. **Why the other cancellations happened is not established** — they
ended within 11 minutes, and nobody has looked at their causes, so do not write "superseded pushes
and hand-cancels" as if it were measured. And **the count of cancelled runs is a moving target**: it
read 29 for Wren and 31 an hour later for me, because superseded PR pushes cancel runs continuously.
Cite the invariant above, never the population size.

**So the case this card describes has not occurred on its own in that window.** That is the honest
frame for ordering it: the gap is real, the mechanism is measured, and the event is rare. It is not
an emergency, and a fix that risks the cry-wolf defect
(`bug-trace-upload-errors-when-e2e-never-ran`) to close it would be a bad trade.

## Why it is worth a card

A timed-out run is the one you cannot read. A test that fails an assertion says what it wanted and
what it got, in the log. A run killed at 30 minutes stops mid-sentence, and the artefact that would
show what the app was doing is exactly the one not collected.

**It is not, however, the cause of the traceless diagnoses on this board.**
`bug-app-closes-under-stall-spec` looks like a candidate and is not one: its log shows the app
exiting mid-test (*"Target page, context or browser has been closed"*, *"closed: sessions down"*),
and it had no traces because run `34924677951` predates the `trace` setting entirely — not because
the upload was skipped.

## BOTH MEASURED, 2026-09-16. One candidate survives; the other would rebuild the original defect.

Outcomes were written down before either ran (see the claim note above).

### A — a step killed by its own `timeout-minutes` reads `failure`

[Run `35153858367`](https://github.com/vibesyemmy/obsrv/actions/runs/35153858367), a throwaway ubuntu
job whose step slept 120 s under `timeout-minutes: 1`:

    probe outcome=failure conclusion=failure

**Both**, which matters because `outcome` is what an `if:` reads. **As pre-registered**, and it keeps
candidate 1 alive: a step-level timeout does *not* end in the `cancelled` state that already uploads
nothing.

### B — `globalTimeout` leaves nothing worth reading, and would pass the check anyway

A deliberately hung spec under `--global-timeout`, run locally:

    playwright exit code     1
    test-results/ contains   .last-run.json      ← one bookkeeping file, and nothing else

No trace, no `error-context.md`. The hung test is reported as *"did not run"*.

**Follow that through the gate now on main and the result is the defect this family started with.**
Playwright exits 1, so the e2e step is `failure`; the gate fires; `test-results/` is **non-empty**, so
`if-no-files-found: error` does **not** fire; the upload **succeeds** and attaches a bookkeeping JSON.
A green upload step carrying nothing anyone can read — `bug-trace-upload-empty`, rebuilt by the fix
for its sequel.

**My pre-registration said "I expect it to leave something", and that was true and useless.** The
clause that saved it was the one asking *whether any of it is a trace rather than only
`error-context.md`* — without that, one file would have read as a pass. It also compounds with a gap
already on this card: `trace` is `on-first-retry`, and `globalTimeout` prevents the retry, so that
path cannot produce a trace by construction.

**So candidate 2 is not merely dead, it is a trap**, and it is written here so nobody re-proposes it
from the reasoning that made it attractive — "Playwright stopping itself should write what it has".
It does not.

### What A does NOT establish, and it is the next measurement

`failure` answers the **gate** question, not the **artefact** question. A step killed by its own
timeout is still a process killed from outside, so whether Playwright flushes anything useful before
it dies is unmeasured — and this card's control demands the upload *attach whatever Playwright
managed to write*, not merely run.

**Next: a throwaway run with a step-level `timeout-minutes` below the job's 30 and a hung spec, then
read `test-results/`.** If it holds only `.last-run.json`, candidate 1 lands in exactly the same trap
as candidate 2 and both shapes on this card fall — which would be the most useful outcome available,
because it says the fix is not in this direction at all.

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
