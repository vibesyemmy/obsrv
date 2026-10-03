---
title: "the inspector reports an element's line boxes, so a click by selector picks a real one instead of guessing"
column: doing
owner: Dogu
waiting: "Idris: gate #543 before merge"
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

## BUILT, 2026-10-03 — Dogu, `#543`; Idris gates (Wren, room `#3089`)

`readout.lineRects` is `Element.getClientRects()` in the space of `rect`: one box for a block, one per
line for a wrapped inline and **not the leading between the lines**; document order, empty boxes dropped,
at most 32. A click by selector now tries the centre of each line box first, **largest visible first, and
the five fixed fractions after them**, and still asks the page what is drawn at each point.
`obsrv_inspect` gains five key paths (optional, "absent from an app older than the field");
`public-shape.json` and `breaking-changes.md` carry them.

**The first version of this PR dropped the fractions, and a reviewer found the regression.** It probed the
line boxes alone, which for a block is one point, so a `<button><span>Label</span></button>` (label painted
over the centre, resolves to the `<span>`) and an icon-plus-label button went from pressed to refused. Idris's
gate reproduced it before the suite finished; my fixture's buttons were plain text, which is why 89/89 were
green. Line boxes say where an element's *text* is; they cannot say where an element is pressable when a
child covers it. The fix keeps the fractions after the boxes, so the old behaviour is a strict subset of the
new one (a structural unit test pins that), and the fixture gained both buttons, each run with and without
the field and required to press the same point.

**Absent and `[]` are different facts and the code keeps them apart.** An app older than the field sends
none, and the click uses the five fractions alone, so a newer server on an older app behaves as before.
`[]` is a measurement. The parser is strict where `editable` was lenient, because a report without the
field comes from the app's own script and is malformed, not old.

**Measured on the offscreen app:** a two-line wrapped link costs **1** hit check with the field and **2**
without it (a control arm strips the field, which is what an older app sends). The card said "up to four
wasted probes"; that is the ceiling, and on this fixture the walk wasted one. A link that wraps past two
lines lands on the link in one check. Sabotaged a dozen ways, each caught by the tests written for it.

**Found on the way, not fixed here:** a below-the-fold selector click under a text scale of 1.5 scrolls past
the element and refuses, on `origin/main` too — `bug-selector-click-over-scrolls-under-text-scale`. The
text-scale arm that proved the line boxes are scaled with `rect` therefore uses a link above the fold.

**Not done, stated:** the flow report does not say whether the point came from a line box or a fixed point
(its wording now says only "a point the page confirmed belongs to this element"). That would be a report
field, and nothing here needed it.

