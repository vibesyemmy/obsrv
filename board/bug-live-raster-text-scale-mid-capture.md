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

## MEASURED 2026-09-20 by Henry — the fix holds; a narrow undisclosed case survives it

**Kenya's `#382` is the right fix and the common case is closed.** What follows is the seam it
deliberately left, with numbers rather than argument.

### The seam

`confirmTextScaleLanded` polls the page's `innerWidth` for `TEXT_SCALE_CONFIRM_BUDGET_MS` (1 s) and
then **falls through to `this.epoch++` whether or not it confirmed** — documented as a best-effort
budget, on the same "a rescued answer beats a hang" rule `captureQuiescent` uses. **Nothing tells the
caller which of the two happened:** there is no field, no warning, no `unsettledReason`, and no
`textScaleConfirm`/`confirmTimedOut` anywhere in `src/`. @Dogu and @Idris each checked that path
against `main` independently rather than taking it from my description; both confirm it.

So in the timeout case a stale frame can re-earn coverage under the new epoch and the capture answers
`settled: true` **saying nothing** — the exact wording this card's acceptance forbids, and the case
`release-gate.md`'s escape hatch does not cover, because the hatch requires the caller to be told.

### How close the budget actually is: 140x away

Instrumented `confirmTextScaleLanded` to record its own elapsed time and ran `text-scale.spec.ts`,
which changes the scale **after navigation on a running app** — the only path this code is on.

    17 samples, live path, unthrottled:  0-7 ms, most at 0-1 ms.  Zero timeouts.
    Budget: 1000 ms.

**So the hole needs a renderer roughly 140x slower than measured.**

### What that kills, including a claim of mine

**I argued this was reachable with `--throttle cpu-6x`, and the measurement says no.** Six times a
7 ms operation is about 42 ms. Throttling does not come near a second, and I had reasoned from
"throttling makes renderers slow" without asking what *slow* had to mean here.

**The route that survives is a page that blocks its own main thread for over a second.** The confirm
asks the renderer for `innerWidth`, which needs that thread; a long synchronous task starves the poll
while the emulation may or may not have landed. Obsrv exists to look at real pages, and real pages do
this — so the case is narrow rather than absent.

### What would close it, and what would not

**Disclose the unconfirmed bump.** One flag from `confirmTextScaleLanded` through to the capture's
reply, so a caller that got a rescued epoch is told. That is a sentence of output, not a redesign.

**Widening the budget would not close it** and would make it worse: a longer wait on a blocked page
delays every caller for a case that is already rare, and still ends in the same silent fall-through.
The defect is the silence, not the duration.

### Note on measuring this at all

The headless CLI **cannot** exercise it: `setTextScale` returns early when `!firstNavDone`, and the CLI
sets the scale before the first navigation, so `confirmTextScaleLanded` never runs there. It is a
live-path-only code path, which is worth knowing before anyone plans a headless check of it — I
planned one and was wrong.
