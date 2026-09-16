---
title: "The app shuts down under `stall.spec:42` — `closed: sessions down`, not a slow page"
column: done
owner: "Henry"
kind: bug
order: 49
---

FOUND BY ROOK 2026-09-16, reading the CI logs by first failure. Split out of
`bug-flakes-gate-the-gate`, where it was one row in a tally of "flakes".

## What the log says

Run `34924677951`, `stall.spec.ts:42` — *"a subframe load on a healthy page is not a stall"*.
**It is the FIRST failure of that run**, so nothing before it explains it.

    Error: electronApplication.evaluate: Target page, context or browser has been closed
    [pid=37639][out] obsrv: closed: sessions down

**The second line is the app's own.** The Electron process shut itself down while the test was
talking to it. That is not a page that painted late, not a threshold, and not a renderer fault —
it is the application exiting mid-test.

## Why it was mis-shelved

The card it came from reasoned that *"a stall is defined by elapsed time, so a loaded runner is
the obvious suspect"*. That is a good guess about a **timeout**, and this is not a timeout: the
evaluate call failed because its target had gone, and the app announced its own shutdown in the
same breath. **Nobody had opened the log**, which is the habit that card exists to break and did
not.

## What a fix has to find out, and the control it needs

- **Why does the app exit there?** `closed: sessions down` is Obsrv's own message; the path that
  prints it names the condition, and reading it is the first step.
- **Does it recur?** One observation. Before proposing anything, find whether other runs carry
  the same pair of lines — the search is the app's message, not the test name.
- **The vacuity check:** a run of `stall.spec` that passes proves nothing about this. The
  assertion has to see the app's shutdown line to be evidence, so any check here must show that
  it *can* observe the condition before its silence means anything.

## RESOLVED 2026-09-16 by Henry — not the app exiting: a test that timed out, with two causes

**The first line of the failure was one this card's quote left out:** *"Test timeout of 30000ms
exceeded."* The evaluate error came after it. In all three runs that carry this failure
(`34882194536`, `34924677951`, `34961903958`), the app log reads `starting`, then about 40 s later
`quitting` and `closing: main window`, which is **Playwright's teardown after the timeout**, not
the app shutting itself down. `closed: sessions down` is the last line of the main window's
orderly `close` handler (`src/main/index.ts`). **Every run failed both tries.**

**Cause A, reproduced, and fixed: a hidden dependency on the first test.** `:42` appended a hidden
`file://` iframe to *whatever page the target showed*. It relied on `:21` having navigated the
target to a `file://` fixture, and under any other page the iframe never loads, so its `onload` never
fired and the evaluate waited out the timeout.

| run, locally on `main` | `:42` |
| --- | --- |
| the whole file ×10 | timed out **2/10**, both in the replacement worker right after `:21` failed |
| `:42` alone ×3 | **timed out 3/3** |

**That is also why CI failed both tries: a retry runs `:42` alone.** It is the shape of `live-drive`'s
`captureTarget` (#48).

**Cause B, observed, not reproduced: on CI's first attempt `:42` hung with its page in place.** `:21`
and `:35` had passed in the same app, so the target *was* on the `file://` fixture. Yet the
evaluate never returned. Teardown then stopped before `closed: sessions down`: `app.close()` was
killed after 10 s, so `tabs.destroy()` did not return. And run `34924677951` later logged the app
exiting on its own with `SIGSEGV`. That reads as a target renderer that stopped answering. **Nothing
here reproduced it.**

**The fix (the test, not the product):** `:42` now navigates to its own fixture first, and waits for
the target to be on it. **The wait is bounded twice, so the next occurrence says which it was:** the
page answers `{ loaded: false, top, readyState }` after 8 s if the iframe never loads, and main answers
`{ renderer: "did not answer within 12 s" }` if the renderer never replies (cause B). Either way the
test fails with that object as its message, not a bare timeout.

**Tests:** `:42` alone ×3, passed 3/3 (timed out 3/3 before). The whole file ×8, 32/32.
**Also seen locally, not this card's:** `:21` failed 2 of the first 10 repetitions (`.stall` not visible
within 10 s) and 0 of the next 8. It's recorded here and not chased.

## CORRECTION BY ITS FILER, 2026-09-16 — the premise above was wrong, and here is how

Henry's RESOLVED section has the finding: the first line of every failure was `Test timeout of
30000ms exceeded`, and `closed: sessions down` was teardown after it. **So this card's opening
claim — "it is not a timeout" — is exactly backwards**, and the sentence criticising the earlier
reasoning for guessing at a timeout was criticising the right answer.

**The part only I can add is how I got there, because the mechanism is reusable.**

**My filter could not match its own answer.** I read the log through a grep whose pattern
contained `Timeout`. The log says `Test timeout`. Case-sensitive: the first line — the one that
settles it — was invisible to the search that was looking for it, so the *second* line read as
the first, and this card is titled after it.

**And I broke the rule I was applying, by applying it at the wrong granularity.** The instruction
for that pass was *name the first failure before reading anything after it*. I applied it to
**which test failed first** across nine runs, carefully, and never to **which line of a failure
came first** inside one. The pass that got the run-ordering right got the line-ordering wrong,
with the same words in front of me.

**What to take from it, since a wrong card is only worth its lesson:** *first* is a question that
has to be asked at every level of nesting, not once at the top. And a case-sensitive filter over
machine output is a silent one — the same false-zero family as `ugrep -I` on a control byte and
a `grep -c` that exits 1, both of which also cost time today.
