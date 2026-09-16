---
title: "The inspector closes, then re-opens 500 ms later — and it defeats the retry"
column: doing
owner: "Henry"
kind: bug
order: 33
---

FILED 2026-09-15 by Henry, from CI run `34956013490` (PR #10). **Unowned.**

`tests/e2e/devtools.spec.ts:92` — *"a toggle that arrives while the inspector is opening is
applied when it opens, not dropped"* — failed **both attempts** on a macOS runner.

## What actually failed, which is not what it looks like at a glance

The test clicks the `target-devtools` menu item **twice in one tick**, so the inspector opens
and then closes. It then checks twice:

    108  await expect.poll(opened, { timeout: 10_000 }).toBe(false)   ← PASSED
    111  await new Promise(r => setTimeout(r, 500))
    112  expect(await opened()).toBe(false)                            ← FAILED: Received true

**The close poll succeeded. The inspector then re-opened within 500 ms.**

That matters because the obvious reading is wrong. The test's own comment records a previous CI
failure — *"0.59.0's bump run, devtools.spec:92 failing its close poll twice at 10 s"* — and
that was the poll at 108 timing out, a slow-machine race. **This is the opposite end of the
test.** Line 112 exists for a different reason, stated in the line above it: *"And it stays
closed: the pending toggle is one, not a queue that re-opens behind it."*

So the failure is the guard admitting a **third** state change from two clicks, which is the
specific defect the test was written to catch — not the timing flake its comment describes.
Henry initially reported this as the same symptom as 0.59.0 and was wrong; the line number in
the error is what separates them, and it is worth reading before excusing this as known.

## Why it is not simply a flake, stated as evidence rather than conviction

- **It defeated `--retries=1`.** `ci.yml` carries that retry expressly to absorb flakes on
  loaded runners. A failure that survives it is outside what the current mitigation covers.
- **The test is designed to be speed-independent.** Two clicks in one tick put the second inside
  the open window *by construction, whatever the machine's speed* — that is the comment's own
  claim, and this failure is a counterexample to it or to the guard.
- **It passed on `main` this morning**, before tonight's log regression, so it is not
  consistently broken either.

Intermittent and real are not exclusive. A race that resolves the wrong way occasionally is
both.

## What is NOT known, and should be established before a fix is designed

- **Whether the re-open is the second click arriving late, or a third event entirely.** The
  guard is meant to collapse a pending toggle to one; if what arrives at 500 ms is the *second*
  click being replayed, that is a queue. If it is something else, the guard is not the subject.
- **Whether this reproduces off CI.** Nobody has seen it on a desk. `OBSRV_TEST=1` and a loaded
  machine may be required, which makes it a candidate for the fixture-sweep treatment rather
  than for staring at the code.
- **How often.** One double-failure is one observation. `bug-sync138-no-url-changed` is the
  cautionary case: a flake seen once, six clean runs after, and a sizing decision nobody had
  made. Do not hunt this until someone decides how many runs would settle it — the interval on
  one observation is enormous.

## Do not put it on the known-reds list yet

`docs/known-reds.txt` is currently **empty**, which is a legitimate state meaning nothing is
excused. Adding a row here would excuse a red that may be a real defect, and the list's own
header says a row exists for *a reason already understood*. This reason is not understood; only
the symptom is. A row now would convert an open question into a permission.

## The general point, for `CONTRIBUTING.md` if it survives scrutiny

A test's own comment describing a past failure is the **most** persuasive thing available when
the same test fails again, and that is exactly what makes it dangerous. The comment here is
accurate, about the same test, from the same CI, and describes a different failure. Read the
line number in the error before reading the comment.
