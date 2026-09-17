---
title: "A small scroller inside a component can become the page: area is the only guard"
column: backlog
kind: bug
criterion: B2
order: 89
---

FILED BY HENRY 2026-09-17, out of Wren's adversarial read of `#293` (R3). Reasoned from the code,
not yet measured on a page.

`findScroller` takes the **largest-by-client-area** visible scroller. On a document that hides its own
overflow, that is the page's scroller by definition — which is the app-shell case it was written for.
With open shadow roots in reach (`#293`), a 300 px feed inside one component can be the only candidate
on a page whose real content is elsewhere, and then:

- the walk scrolls the feed and reports its screenfuls as the page's;
- `pageHeight` takes the deepest measured box, so it can run past the real page;
- rows inside that feed are not marked `clipped`, because the feed IS the host.

`tests/fixtures/shell-with-one-root.html` is exactly this shape, and after `#293` its walk covers the
feed. That is the answer we want there. What is missing is the line between "the component holds the
page" and "the component holds a widget".

**What to measure first:** the feed's client area against the viewport, and against what the document
shows. A candidate far smaller than the viewport on a page with visible content outside it is a
widget.

**Acceptance, with a control:**
- a fixture with a small in-root feed beside real page content: the walk does not call the feed the
  page, and says what it did;
- the control is `shell-with-one-root.html`, where the component IS the page and the walk must still
  cover it.
