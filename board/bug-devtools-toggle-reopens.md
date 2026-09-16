---
title: "The devtools guard tests were decided by one sample racing the inspector's open — the close poll never saw a close"
column: done
owner: "Henry"
kind: bug
order: 33
---

FILED 2026-09-15 by Henry, from CI run `34956013490` (PR #10).

## RESOLVED 2026-09-16 by Henry — the reading below is wrong, and the log it was filed from said so

**The inspector never closed and re-opened. The close poll at `:108` has never observed a close,
in any CI run, passing or failing.**

Swept every CI attempt since the test landed on 2026-09-13: 334 attempts, 178 reached
`devtools.spec`.

- **`:92` — 181 tries, 9 failed. Every try took 505–624 ms, and the test sleeps 500 ms.** The
  10 s close poll was satisfied within ~124 ms every time.
- **A real open-then-close never took under 337 ms** — `:31`, which waits on the events: 178
  passing tries, median 540 ms, p95 964 ms, max 1.4 s.
- So the poll read `false` **before either toggle had run.** Both are deferred a tick, and
  `isDevToolsOpened()` answers for the request, not the window (`docs/e2e-flakes.md`). Measured
  locally: the poll was satisfied after 2–10 ms; the close arrives at ~360 ms.
- **Each try was decided by one sample 500 ms after the clicks**, racing an open-then-held-close
  of 340 ms to 1.4 s. A slow runner reads `true` there exactly as a dropped close would.
- **`:116` — three clicks — has the same shape and failed 9 of 181 too**, never carded or
  counted. In four runs the retry failed as well; 10 of the 14 runs with a failure were on `main`.

**The run this card was filed from carried the answer:** its two failed tries took **523 and 529
ms**. The line number was read and the duration beside it was not. *A check that looked at nothing
passes* is already in `CONTRIBUTING.md`; this card is an instance of it.

### The fix, and the controls that make it one

Both tests now record the target's `devtools-opened` / `devtools-closed` events, poll until exactly
`opened, closed` however slow the machine, and check it stays that way 500 ms **after the close**,
with the request flag false. **No product change**: tracing the guard, two or three clicks have no
re-open path, and nothing measured here points at one.

The committed spec, run against sabotaged builds of `src/main/menu.ts` (retries off; the old tests
through an identical harness):

| build | old tests | new tests |
| --- | --- | --- |
| real | pass — poll satisfied in 2–10 ms | pass — close seen at ~360 ms |
| held close delayed 700 ms: a slow runner, made deterministic | **fail** | **pass** |
| held toggle dropped | fail | fail — stuck at `opened` |
| re-open queued behind the close | fail | fail — an event after the close |

The second row is the one that separates them. The last two show the new tests still catch what
the guard exists to prevent.

### What is still not known

**Whether any of the 18 failures was a real re-open.** The durations cannot tell a slow cycle from
a close and re-open inside the same 500 ms, so that is ruled out by the code and by parsimony, not
by the logs. The new tests fail on one. If they never do, that is the evidence.

---

*The original filing follows, kept as the record of the reading.*

`tests/e2e/devtools.spec.ts:92` — *"a toggle that arrives while the inspector is opening is
applied when it opens, not dropped"* — failed **both attempts** on a macOS runner.

## What actually failed, which is not what it looks like at a glance

The test clicks the `target-devtools` menu item **twice in one tick**, so the inspector opens
and then closes. It then checks twice:

    108  await expect.poll(opened, { timeout: 10_000 }).toBe(false)   ← PASSED
    111  await new Promise(r => setTimeout(r, 500))
    112  expect(await opened()).toBe(false)                            ← FAILED: Received true

**The close poll succeeded. The inspector then re-opened within 500 ms.** *(Wrong — see the top:
the poll succeeded before anything had opened.)*

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
