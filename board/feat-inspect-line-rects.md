---
title: "the inspector reports an element's line boxes, so a click by selector picks a real one instead of guessing"
column: backlog
kind: feat
order: 119
---

FILED BY HENRY 2026-09-30, as the exact fix for the heuristic `bug-selector-click-presses-the-gap`
shipped instead.

## Why the current thing is a heuristic

A selector click picks its point from **five fixed fractions** of the element's border box, and asks the
app what is drawn at each until one resolves to the element. That works because the box of a wrapped
inline contains its line boxes as well as the gap between them — but the runner never learns *where the
line boxes are*. It guesses five places and checks.

**The bound, which is why this is a follow-up and not an incident** (checked by Idris on `#523`): if an
element's painted area misses all five candidates, the step **refuses** — `noPointHitsRefusal` — rather
than pressing a point nobody verified. So the property that matters holds even where the heuristic is
incomplete. A three-or-more-line wrap is the shape to suspect; **none has been seen**, and that is worth
saying plainly rather than implying one has.

## What would make it exact

`Element.getClientRects()` is the list of line boxes. With them on the inspect readout, the runner takes
the centre of the largest visible one and the guessing disappears, along with up to four wasted probes
per click.

**It is a public shape addition**, so it costs the four-places sweep plus `docs/public-shape.json` and
the two documents a user reads. That is the price of exactness here, and it is why this is a card rather
than a line in the fix.

## Acceptance

- the inspect readout carries the element's client rects, and the new key is named everywhere the
  four-places rule requires;
- the runner picks its point from a rect rather than from a fraction, and still verifies what is drawn
  there — the check is what makes a wrong answer impossible, not the geometry;
- the wrapped-inline e2e keeps passing, and a three-line wrap is added to it, since that is the shape
  the heuristic could not promise;
- the refusal for an element with no reachable point survives, because a rect list can still be empty.
