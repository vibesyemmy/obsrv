---
title: "The trace upload step fails on every run that dies before Playwright starts"
column: done
kind: bug
owner: "Rook"
order: 52
---

FOUND BY ROOK 2026-09-16, checking whether `bug-trace-upload-empty` could close. **Owned by Rook**
since the claim; the fix is up for review. A consequence of that card's fix, and a mild one —
worth fixing, not worth reverting anything.

## What happens

`.github/workflows/ci.yml`'s upload step now carries `if-no-files-found: error`, which is what
gave it the ability to fail at all. It runs on `if: failure()` — **any** failure, including one
that happens before Playwright has run and created `test-results/`.

Observed on run `35102701577`:

    failure   Unit tests                            ← the real cause
    skipped   E2E (Playwright driving the Electron app)
    failure   Upload Playwright traces on failure   ← nothing to upload; there never was

**Nothing is masked** — the unit failure is reported, and listed first. The cost is a **second red
step that means nothing**, named after an artefact the run never had the chance to produce, on
every typecheck, unit or build failure.

## Why it is worth fixing rather than tolerating

The step's whole purpose, per `bug-trace-upload-empty`, is that **a step which cannot fail is not
a check**. It can fail now — and a check that cries wolf on runs it has no opinion about is on its
way back to being ignored, which is where it started. A reader who learns to skip that red will
skip it on the day it means something.

## The fix, and the thing it must not lose

Gate the upload on the e2e step having actually run — give that step an `id` and use
`if: failure() && steps.<id>.outcome == 'failure'`, or equivalent.

**What the fix must NOT do is drop `if-no-files-found: error`.** That setting is the entire
check. A fix that quiets the noise by making the step unable to fail again puts the week this
card came from back on the table.

## The control

**A run that fails in the unit step must show the upload step as skipped, not failed** — and a run
that fails in e2e must still show it uploading, and still fail it if the directory is empty. Both
arms: without the second, the fix cannot be told from deleting the step.

## What was run

Wren set the shape: on CI, from a throwaway branch (`verify/upload-gate`, never merged), not
locally. Each control was a real run, and each is linked so the next reader can check the claim
rather than take it.

| # | the run is | e2e | upload | |
| --- | --- | --- | --- | --- |
| 1 | red **before** e2e | `skipped` | **`skipped`** | [`35114104912`](https://github.com/vibesyemmy/obsrv/actions/runs/35114104912) — was `failure` before the gate |
| 2 | red **in** e2e, artefacts written | `failure` | **`success`** | [`35114819591`](https://github.com/vibesyemmy/obsrv/actions/runs/35114819591) — `playwright-traces`, 5347 bytes |
| 3 | red **in** e2e, `test-results/` empty | `failure` | **`failure`** | [`35114327271`](https://github.com/vibesyemmy/obsrv/actions/runs/35114327271) — `artifacts: none`; the check still bites |

Control 1 is the defect closing. Control 2 says the gate did not simply break the step. **Control 3
is the one that matters most**, because it is the arm that tells this fix apart from quietly
deleting `if-no-files-found: error` — the outcome this card was written to forbid.

## The fourth control, which was Wren's question and not mine

Traces matter most when e2e **hangs** — and a hang need not end in a failure, so
`steps.e2e.outcome == 'failure'` could be false exactly when you most want them. Checked rather
than assumed: **the e2e step has no `timeout-minutes` of its own**, and the `test` job has
`timeout-minutes: 30`.

**My first answer here was too wide, and Wren's second read narrowed it.** I wrote that a hang *can
only* end as a job-level timeout. It usually doesn't: every spec has a finite timeout (30 s by
config, describe-level overrides to 900 s, none zero), so a hanging test ends as a **test** failure
and the upload runs — runs `34995218008` and `35086053288` are that shape. What ends `cancelled` is
a run that exhausts the job's 30 minutes.

[Run `35115147209`](https://github.com/vibesyemmy/obsrv/actions/runs/35115147209) is a deliberately
hung test (`test.setTimeout(0)`, which no real spec does). **It was not stopped by hand.** My
terminal recorded `gh run cancel` reporting `✓ Request to cancel workflow 35115147209 submitted`
about 90 s after the e2e step began — that is where the request is attested, not in the run's own
record — and the job then ran 15:24:59 → 15:55:20 and ended on its own limit, *"The job has
exceeded the maximum execution time of 30m0s"*. So the control observed a real job-level timeout
rather than a stand-in for one. **Nothing here says why the cancel did not stop it**, and one run
could not establish that; do not read this as "GitHub cancels cannot stop a hung e2e run".

    cancelled   E2E (Playwright driving the Electron app)
    skipped     OLD GATE probe                        ← a throwaway step holding the OLD `if: failure()`
    skipped     Upload Playwright traces on failure   ← the new gate

The probe step is why this is worth the run. The easy answer — *"`failure()` is false on a
cancelled job too, so nothing is lost"* — is correct, and it is also reasoning about a step that
looks like a check, which is the exact mistake this card exists to correct. **Both gates skipped,
so "not a regression" is observed rather than argued.**

**What that run does not show is the mechanism.** Both steps skipped fits "the gate evaluated and
the outcome test was false" and equally fits "nothing runs after a job-level timeout at all". The
conclusion is the same either way — nothing uploads — but anyone later trying `outcome ==
'cancelled'` needs to know which, and this run does not say.

It also names a real gap, not this card's to close: **a run that outlasts the job's 30 minutes
produces no traces under either gate.** Filed as `bug-no-traces-when-e2e-hangs`.

## What the fix's own justification got wrong

Worth keeping, because it was wrong in the direction that flatters the change. I wrote — and #29's
paragraph in `ci.yml` said before me — that `if-no-files-found: error` is what stops the week of
silence recurring if the `trace` setting is dropped again. **It isn't.** I sampled four runs; Wren
then checked all of them — and then **re-checked the scope of his own numbers and corrected them
twice**, which is the only reason the figure here is right:

- his first sweep filtered the window by comparing ISO strings with **mixed UTC offsets**, silently
  dropping the first hour after `1b0be8f`, which contained a failed run — 57 became **58**;
- `--status failure` reads only each run's **latest attempt**, the trap this repo already had
  written down. **13 more runs failed e2e on attempt 1 and were re-run to green**, so they never
  appeared in the sweep at all.

**The complete statement:** every e2e failure between `1b0be8f` (2026-08-25) and #29's merge — **71
attempts**, 58 runs plus those 13 first attempts — uploaded a *non-empty* `playwright-traces`. None
missing, none zero bytes, from 1,235 B (`34249494196`) to 178,059 B (`34107042439`). `error` never
fires on a non-empty directory, so it was silent through the whole week and would be silent again.

Wren also established the other half: **from `1b0be8f` until this change the step had exactly one
`if:`, `if: failure()`** — which is what control 4's probe carried. So "no version of this step has
ever uploaded traces for a timed-out run" is a statement about every version there has been.

`error` still earns its place: it is the only thing that speaks when a failing e2e run writes
**nothing at all**, which is control 3. But the reason had to be corrected in both paragraphs, and
**a dropped `trace` setting has no guard today** — which is a card of its own, deliberately not
grown into this change.
