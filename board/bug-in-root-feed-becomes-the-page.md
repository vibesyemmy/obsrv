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

## MEASURED 2026-09-23 by Henry — the defect is real, and there is no geometric line

**First measurement on a page.** The card was *"reasoned from the code, not yet measured"*; nine
fixtures at 1280×800, `findScroller` bundled with esbuild and evaluated in headless Chromium, so no
app and no desk. `truth` is what a reader would say the box is.

| case | truth | width %vw | **area %vp** | visible text outside host |
| --- | --- | --- | --- | --- |
| small feed in an open root, beside real content | widget | 25% | **9%** | 175 |
| the same feed, nothing else on the page | **?** | 25% | 9% | 0 |
| compact app shell, 1280×150 scroller, bare | **page** | 100% | **19%** | 0 |
| the same shell with a real header and footer | **page** | 100% | **19%** | **167** |
| full-bleed carousel, 1246×180, beside real content | widget | **97%** | **22%** | 70 |
| tall feed, 500×680, beside real content | widget | 39% | **33%** | 57 |
| `shell-with-one-root.html` (the control) | page | 100% | 38% | 22 |
| centred article shell, 832 wide | page | 65% | 65% | 0 |
| two-pane app shell | page | 79% | 79% | 3 |

**The defect is confirmed:** on the first row a box at **9% of the viewport** is chosen as the page
while the document's real content sits visible beside it.

### Every discriminator tried fails, including the card's own

- **Area against the viewport** — the card's proposal. Sorted by area the classes **interleave**:
  pages at 19% and 19%, then widgets at 22% and 33%, then pages at 38, 65, 79. No threshold exists.
- **Width against the viewport** — sharper on the first six shapes, and **the carousel kills it**: 97%
  wide and a widget, wider than either genuine shell at 65% and 79%.
- **Small area AND visible text outside the host** — separated all five decided cases until the last
  fixture, which was built to break it and did on the first run: *compact shell + real chrome* is 19%
  area with 167 characters outside, and it is the whole page.

### Why the search stops here rather than continuing

Compare the two full-bleed short boxes: the carousel (widget) and the compact shell (page). **Same
width, near-identical height, both with real text outside.** The only difference is what the outside
text *is about* — the storefront's header and blurb are the page's subject, the terminal viewer's
header and footer are **chrome describing the box**. That is semantic, and no ratio of client rects
reaches it.

`widget, nothing else` makes the same point from the other side: a small feed on an otherwise empty
page reads as the page, and arguably **is** the page's only content. **The line is not a property of
the component.** It depends on whether the document has anything else to show, and sometimes on what
that something is.

### The fix this argues for — the card's own second clause, not its first

> *"the walk does not call the feed the page, **and says what it did**"*

**Report, do not decide.** Where the chosen host is small against the viewport and the document has
visible content outside it, say so — *"measured the scroller at 318×300, a quarter of the viewport;
the page has content outside it"* — and let the reader judge. A warning is honest where a threshold is
a coin flip, and this repo's standing line is that the warnings are the product. It also leaves
`widget, nothing else` alone, because there is nothing else to mention.

**What must not ship: a constant fitted to nine fixtures**, two of which sit four points apart on
opposite sides of the answer.

**This rewrites the acceptance** from *find the line* to *describe the choice*, so it waits on
Opeyemi rather than being written. The nine fixtures are dimensioned above and rebuildable in ten
lines each; they stay out of the tree until a fix consumes them.
