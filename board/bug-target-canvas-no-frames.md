---
title: "The target canvas goes blank in CI and the app says why — No frames from target renderer"
column: doing
kind: bug
owner: "Kenya"
order: 35
---

SPLIT OUT of `bug-flakes-gate-the-gate` 2026-09-15 by Kenya, on Opeyemi's word. **This is the one failure in that card's set with a proven mechanism, and it is the product's own subject matter rather than the harness's.**

## What the trace says, rather than what the summary line says

`tests/e2e/panes.spec.ts:83` — *"the target canvas shows the page, not a blank"* — failed **both attempts** in run `34988828712`. The assertion is a 10 s poll for white pixels on a canvas that is black when nothing has drawn into it.

The uploaded Playwright context carries the app's own UI at the moment of failure:

    - generic [ref=f1e73]: No frames from target renderer

**That is Obsrv's stall notice, not a test message.** Blank target plus *No frames from target renderer* is the documented signature of a lost WebGL context after GPU helper deaths — `docs/gpu-reset.md`, measured 2026-09-08, where the switch-and-recover path was validated.

So this is not a flaky test. **The suite caught the product failing on a loaded macOS runner, and reported it as noise because it was counted rather than read.**

## Why it is its own card

The parent card grouped five failures as one condition. The traces split them:

    panes:83        THIS CARD — lost context, product signature, proven from the trace
    vision:47       cause unknown; the failure message discards the channel that decides it
    controls:85     one root, with :109 and :115 as cascades of it — three rows, one failure
    stall:42        the app CLOSED under the test: "Target page, context or browser has been closed"
    devtools:92     already read and carded (bug-devtools-toggle-reopens)

Folding them produced a tally of "three distinct tests defeated the retry" that over-counts cascades and mixes four mechanisms. Each of the others is its own question.

## What is NOT known

- **Whether the GPU helper actually died in this run.** The notice is the app's report of no frames; the console line that names a GPU process exit is not in the uploaded artefact. The signature is documented and consistent, and consistent is not proven.
- **Whether recovery ran.** `docs/gpu-reset.md` describes a switch-and-recover path. Whether it fired here and failed, or never fired, is unread.
- **The rate.** One observation. `bug-sync138-no-url-changed` is the standing lesson on what a handful of observations can carry.

## What would settle it

The console lines from a failing run — a GPU process exit, or a context-lost event — which the current artefact does not upload. That is a harness change rather than a product one, and it is the cheapest next step: the evidence exists at failure time and is discarded.
