---
title: "The trace upload step fails on every run that dies before Playwright starts"
column: doing
kind: bug
owner: "Rook"
waiting: ""
order: 52
---

FOUND BY ROOK 2026-09-16, checking whether `bug-trace-upload-empty` could close. **Unowned.**
A consequence of that card's fix, and a mild one — worth fixing, not worth reverting anything.

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
