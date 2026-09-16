---
title: "The trace upload step fails on every run that dies before Playwright starts"
column: review
kind: bug
owner: "Rook"
waiting: "Wren: the cold read, then Henry merges"
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

Traces matter most when e2e **hangs** — and a hang does not end in a failure, so
`steps.e2e.outcome == 'failure'` could be false exactly when you most want them. Checked rather
than assumed: **the e2e step has no `timeout-minutes` of its own**, and the `test` job has
`timeout-minutes: 30`. So a hang here can only end as a job-level timeout, which GitHub records as
`cancelled`. [Run `35115147209`](https://github.com/vibesyemmy/obsrv/actions/runs/35115147209) is a
deliberately hanging test, cancelled once e2e was genuinely running:

    cancelled   E2E (Playwright driving the Electron app)
    skipped     OLD GATE probe                        ← a throwaway step holding the OLD `if: failure()`
    skipped     Upload Playwright traces on failure   ← the new gate

The probe step is why this is worth the run. The easy answer — *"`failure()` is false on a
cancelled job too, so nothing is lost"* — is correct, and it is also reasoning about a step that
looks like a check, which is the exact mistake this card exists to correct. **Both gates skipped,
so "not a regression" is observed rather than argued.**

It also names a real gap, which is not this card's to close: **a hung run produces no traces under
either gate.** Filed as `bug-no-traces-when-e2e-hangs`.
