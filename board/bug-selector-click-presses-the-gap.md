---
title: "a click by selector can press a point the element does not paint, land on its parent, and still report ran"
column: done
kind: bug
owner: "Henry"
criterion: B5
order: 46
---

FOUND 2026-09-30, on the **first real drive of 0.63.0**, in the selector click 0.63.0 shipped. Opeyemi
asked for a user flow and a report; this is what the report exposed.

## What was seen

A five-step flow on `books.toscrape.com` at `android-65` (360×800 @2×): navigate → click a category →
click a product title → audit → lint. **Every step reported `ran`**, every one settled, and the stated
text for step 3 was **found** — while the journey did not advance: steps 4 and 5 are still on the
category page.

Reproduced identically on a second run — same box, same scroll to `0, 1526`, same press at `116, 285` —
so it is not a race.

## The mechanism, measured twice by two instruments

Scrolling to that offset and asking Obsrv's own inspector what is at the pressed point:

```
inspect { at: { x: 116, y: 285 } } → element: h3 "It's Only the Himalayas"
```

Not the `<a>`. Idris then measured the same anchor in a plain browser at 360 px:

```
getClientRects(): line 1 bottom 531.2 · line 2 top 534.2   ← ~3 px gap
getBoundingClientRect(): 514.2 → 551.2                      — both lines AND the gap
bbox-centre 532.7 → strictly inside the gap
elementFromPoint(bbox-centre) → <h3>, not the <a> or any descendant
```

**So the border box of a wrapped inline element legitimately contains points the element does not
paint.** The union box spans every line box plus the leading between them; the gap paints as the parent
block. `visibleCentre` (`src/shared/flowClick.ts`) takes the centre of that box, so for any inline link
whose text wraps, the press can land on an ancestor.

## Why the tests said nothing

`tests/fixtures/selector-click.html` uses **block-level buttons**, and a block element's border box is
its painted area — a shape that *cannot* exhibit this. 18 green runs across three sweeps plus CI were
all evidence about block elements. The fixture was written to prove the scroll-into-view decision, and
it proved exactly that and nothing more.

## The class

**Class 1 by `docs/release-gate.md`.** *"The link was clicked"* and *"the gap between its lines was
clicked"* produce an identical `ran`, and nothing in the reply separates them. A flow then reports a
journey it did not make — the worst version, because the later steps' evidence is real, settled, and
about the wrong page.

Same silence this board has been chasing all week, authored by me, inside the fix for a different one.
[[review-the-fix-harder]] names this exactly: the N+1th defect gets written while fixing the first N.

## FIXED 2026-09-30 — and three mistakes were made inside the fix, which is the part worth reading

**The fix.** `candidatePoints` (`src/shared/flowClick.ts`) offers several points inside the box instead
of only its centre, and the runner asks the app **what is actually drawn at each one**, pressing the
first that resolves to the element it measured. The check is a call Obsrv already ships — `inspect` at a
point — which is how the defect was diagnosed, so it needs no new machinery and no new public shape.

**Identity is the element's own box, not its name**: two links in a list are both `a` with the same
classes, and what separates them is where they are.

### Mistake 1 — the probe sent the wrong payload shape, and the silence hid it

The first version called `inspect { at: { x, y } }`. That is the **MCP tool's** shape; the control
command takes `{ x, y }` flat (`parseInspectRequest`). Every probe answered **400**.

It did not look broken, because the catch fell back to "press the centre anyway" on the reasoning that
*the probe is not the product*. So the check ran, failed, was swallowed, and pressed the exact point the
card is about. The e2e failed identically before and after the fix, and only printing the chosen point
showed it was still the centre.

**The fallback is now a refusal.** "Could not check" and "checked and fine" must not produce the same
press — that is this card's own defect one level up.

### Mistake 2 — the premise arithmetic was wrong, and the guard said so

The e2e asserts the link *wrapped*, because on a screen where it does not there is no gap and the test
would pass on a broken build. The first floor was `2.2 × fontSize × 1.6`, assuming the union box is two
`line-height`s tall. It is not: `line-height` spaces the lines, while the union runs from the first line
box's top to the last one's bottom — **47.5 px measured, against a 49.3 px floor**. The guard failed on
a working build, which is a guard doing its job.

### Mistake 3 — the assertion was wrong about the DOM

`toEqual(['wrapped'])` failed on a **correct** press, because the click bubbles from the link to the
paragraph, so a hit reads `['wrapped', 'host']`. What separates hit from miss is the **first** entry: a
press in the gap reaches only the paragraph and reads `['host']`.

### What is measured

- unit: 1759 passed / 1 skipped, three consecutive clean runs. A fourth run, the first of the four, had
  one file fail and was not captured; it did not reproduce. Recorded rather than dismissed.
- e2e `flow-selector-click.spec.ts`: **21 passed** over a 3× sweep, including the new wrapped-inline test.
- The fixture gained a wrapped inline link inside a paragraph **that logs its own hits**, so a press
  landing in the gap is visible rather than silent — the same trick as the fixed header beside it.

### What this does not claim

The check answers *what is drawn at this point*, which is what a click hits. It does **not** enumerate
the element's line boxes: a shape whose painted area misses all five candidates would refuse rather than
find the point that exists. Exposing `getClientRects()` through the inspector would make it exact, and
that is a follow-up with a measurement behind it rather than a guess — no such shape has been seen.
