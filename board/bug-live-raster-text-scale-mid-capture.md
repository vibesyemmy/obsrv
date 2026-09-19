---
title: "A live raster taken while the text scale changes comes back settled, showing the layout before it"
column: doing
owner: "Henry"
waiting: ""
kind: bug
criterion: C5
order: 95
---

FOUND BY IDRIS 2026-09-17, reviewing `#314`, in the not-checked list of that verdict. Split out of
`bug-live-raster-settled-while-resizing` rather than folded into its fix (Henry).

**MEASURED, not reasoned.** This card was opened as a code reading, and the reading was wrong about
its own status within the hour: Idris ran it rather than leaving it in the not-checked list and
**confirmed it** — `settled: true`, the pre-change pixels, **no warning**. So it is a defect, not a
candidate, and the first acceptance item below is already met. It is the same class 1 as the density
case `#314` closed: a wrong answer the caller cannot detect.

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

## What is left, now that it is measured

**The fix**, and it is the part that needs care: have `applyEmulation` report when the renderer has
acknowledged the new emulation, and bump the layout epoch **at that point** rather than at the
request. Bumping at the request shrinks the window from a settle interval to a few milliseconds while
reporting itself as closed, which is worse than a hole anyone can read about here.

**Until it is fixed it is a class 1 that nothing discloses**, which `release-gate.md` does not let
through on the escape hatch (Idris): the hatch needs the caller to be told, and the reply says
nothing. So either the fix lands, or the capture says it cannot vouch for the scale — the second is
not cheaper than the first.

## Acceptance, each with a control

- ~~a run that shows a raster capture returning the pre-change text scale~~ **met**: Idris's run,
  2026-09-17, `settled: true` with the pre-change pixels and no warning;
- if it happens: a raster capture across a text-scale change does not come back `settled: true`
  without saying so, pinned where it can be pinned by construction (the fake `FrameEmitter` in
  `cliCapture.test.ts` already carries the epoch);
- the fix does not make an ordinary capture wait: a still page at a steady text scale still settles.
