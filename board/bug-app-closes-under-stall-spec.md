---
title: "The app shuts down under `stall.spec:42` — `closed: sessions down`, not a slow page"
column: doing
owner: "Henry"
waiting: ""
kind: bug
order: 49
---

FOUND BY ROOK 2026-09-16, reading the CI logs by first failure. **Unowned.** Split out of
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
