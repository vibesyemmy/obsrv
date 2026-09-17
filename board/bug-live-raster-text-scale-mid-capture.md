---
title: "A live raster taken while the text scale changes may come back settled, showing the layout before it"
column: backlog
kind: bug
criterion: C5
order: 95
---

FOUND BY IDRIS 2026-09-17, reviewing `#314`, in the not-checked list of that verdict. **Reasoned from
the code and not run** — it is a candidate, and it should not be quoted as a measurement until
something runs it. Split out of `bug-live-raster-settled-while-resizing` rather than folded into its
fix (Henry).

## The shape

`#314` closed two ways for a raster capture to vouch for a layout the pane has left:

- a **size** change, caught by comparing the frame's device extent with the one the source is heading
  for;
- a **density** change at the *same* extent, caught by `TargetSource.layoutEpoch()` — a counter of
  accepted layout changes, bumped by `setViewport` when the CSS viewport, the density or phone-ness
  actually moves.

`setTextScale` (`targetSource.ts:580`) is a third: it re-applies device emulation on the **same**
window at the **same** extent and invalidates. Every pixel of the layout can move, and nothing the
capture watches changes. So a raster capture running across a text-scale change can settle on the
layout from before it, at the dimensions that were asked for, with no warning — the same class 1 as
the density case.

## Why `#314` did not simply bump the epoch there

Because the fix would be wrong in a way that is hard to see. `applyEmulation` reaches the renderer
through CDP, asynchronously; the `invalidate()` beside it can produce a full frame **before** the new
emulation has taken. That frame would arrive under the new epoch, re-earn coverage, and be settled on
— the same defect with an extra counter in front of it. A correct fix needs the repaint to be tied to
the emulation having landed, not to the request having been made.

Henry's call: a fix that closes the window from 400 ms to a few milliseconds, while reporting itself
as closed, is worse than a known hole. So this is a card.

## What to do first

1. **Measure whether it happens at all.** Drive `setTextScale` during a `captureRaster` and read what
   comes back: does the reply's PNG show the old scale? `OBSRV_TEST_RESIZE_DELAY_MS`
   (`targetSource.ts:807`) is the existing precedent for a harness-only delay that makes such a race
   deterministic; a text-scale equivalent would do the same here.
2. **Only then decide the fix.** The candidate is to have `applyEmulation` report when the renderer
   has acknowledged it, and bump the layout epoch at that point rather than at the request.

## Acceptance, each with a control

- a run that shows a raster capture returning the pre-change text scale, or a measurement that says it
  cannot — either answer closes step 1, and a null result is written down rather than dropped;
- if it happens: a raster capture across a text-scale change does not come back `settled: true`
  without saying so, pinned where it can be pinned by construction (the fake `FrameEmitter` in
  `cliCapture.test.ts` already carries the epoch);
- the fix does not make an ordinary capture wait: a still page at a steady text scale still settles.
