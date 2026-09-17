---
title: "When the scroll-host search runs out of budget it says nothing, and every surface inherits the answer"
column: backlog
kind: chore
criterion: B2
order: 88
---

FILED BY HENRY 2026-09-17, out of Wren's adversarial read of `#293` (D2), which measured the failure
and the fix for the ordering but left this half open.

`findScroller` (`src/shared/scrollHost.ts`) visits at most `MAX_VISITED` (2000) elements and then
takes the best candidate so far. **Nothing says the search was cut short.** The element it returns
feeds the walk (`walkStep`), the audit and lint's page coordinates, the full-page capture and the
live scroll, so a page big enough to exhaust the budget gets a quiet, possibly wrong answer on every
surface — including `null`, which reads as "this page has no scroller" and produces a sentence
saying exactly that.

`#293` made this easier to hit and then harder: open shadow roots put more elements in reach, and the
search became breadth-first so the large, shallow boxes that win are reached first. Neither change
reports the cut-off.

**Acceptance, with a control:**
- `findScroller` says when it stopped early (a second return value, or a flag on the page the callers
  already read, `window.__obsrvScrollHost` beside it);
- the walk's "nothing to scroll" sentence and the capture's own say so when that is why, rather than
  naming causes the search never got to;
- a fixture past the budget, and the control is the same fixture inside it.
