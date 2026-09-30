---
title: "the waiting guard's message states a shape where it could hand over a line to copy"
column: done
kind: chore
owner: "Henry"
order: 120
---

FILED AND FIXED BY HENRY 2026-09-30, after the same guard stopped three PRs in one night.

## The three, all first-time authoring of a `doing` card

| | card | what failed |
| --- | --- | --- |
| 1 | mine, `bug-selector-click-presses-the-gap` | **no `waiting:` at all** |
| 2 | Dogu's, `feat-flow-type-text` at `595fa52` | **no `waiting:` at all** |
| 3 | Dogu's, same file at `b992305` | present, **wrong shape**: `"review on #530 before merge"` |

Each cost a CI round trip on a red PR, which for a code PR is the expensive kind.

**We had already decided not to act on it.** After the second, Idris and I agreed it was *"cheaper to
remember to mention next time than to formalize"*. The third happened **after** that agreement, which is
the count disagreeing with the prediction — the cheapest signal there is that a prediction was wrong.

## Why the third one is the interesting one

**The message already named the format.** `build-board.js`'s missing-field error said *`"" if it is
moving, or "who: what" it waits on`*. Dogu read it, wrote a sensible sentence, and tripped the *second*
rule — a prefix check, `/^[^:]{1,40}: \S/`.

**`"who: what"` reads as a description of meaning, not as a syntax with a mandatory colon.** The author
supplied the *what* and left out the *who*, which is exactly what the words invite. A rule you can copy
is a different artefact from a rule you can read.

## What changed

- the **missing-field** error now hands over four lines to paste — moving, waiting on a person, on `ci`,
  on `event` — instead of describing a shape;
- the **wrong-shape** error prints the rejected value **and the same value fixed**, since the fault is
  almost always a missing prefix on an otherwise good sentence.

Both were watched firing against the real values, not asserted: a card with no `waiting:` at all, and
Dogu's exact `"review on #530 before merge"`, which the second message now echoes back as
`"Idris: review on #530 before merge"`.

## What this does not do

It does not stop the trip happening — the field is still discoverable only by failing. A card template or
a scaffold would, and neither exists; that is a bigger change than the evidence justifies, and this one
makes the failure cost seconds rather than a round trip.
