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

**Acceptance, REWRITTEN 2026-09-23 on Opeyemi's word, after nine fixtures said there is no line
(see the measurement below). The original text is kept here because it is what the first half of this
card was reasoned against:**

> ~~a fixture with a small in-root feed beside real page content: the walk does not call the feed the
> page, and says what it did; the control is `shell-with-one-root.html`, where the component IS the
> page and the walk must still cover it.~~

**The walk keeps choosing the largest visible scroller, and says what it chose.** No fixture decides
anything, because no measurable property of the container distinguishes a page from a widget:

- where the walk scrolled a container rather than the document, and the page shows visible content
  outside that container, the reply says so, with the container's box and its share of the viewport;
- silent when the page shows nothing else — a small feed on an otherwise empty page is that page's
  content;
- the control is unchanged in spirit: `shell-with-one-root.html` must still be covered, and the
  sentence appears there too, because the sentence is a statement of fact rather than a warning about
  a mistake.

## BUILT 2026-09-23 — the walk says what it scrolled

`textOutsideHost` (`src/shared/scrollHost.ts`) counts visible text outside the chosen container,
leaves only, bounded by `findScroller`'s own budget and capped at 200 characters because the question
is *whether* the page shows anything else. `walkStep` reports it beside the container's box, for an
element scroller only. `walkHostNote` (`src/shared/walkCoverage.ts`) turns that into one sentence, and
`src/cli/walk.ts` emits it last, after the sentences it qualifies.

**Read across all nine fixtures — which is how the wording was settled, not by writing it well:**

| case | truth | share | what it says |
| --- | --- | --- | --- |
| feed beside content | widget | 9% | fires |
| feed, nothing else | ? | 9% | **silent** |
| compact shell, bare | page | 19% | **silent** |
| compact shell + chrome | page | 19% | fires |
| full-bleed carousel | widget | 22% | fires |
| tall feed | widget | 33% | fires |
| `shell-with-one-root` | page | 38% | fires |
| centred shell | page | 65% | **silent** |
| two-pane shell | page | 79% | fires |

**It fires on three of the six page cases, and that is the design rather than a defect in it.** The
first draft ended *"so check it is the one you meant"*; reading that output killed the clause — telling
a reader to audit a 79%-of-viewport scroller because a nav holds three characters of text is an alarm
about the commonest app shape there is. What shipped states two measured facts and stops: what was
scrolled, and that the page shows content the screenfuls do not cover. **On the two-pane shell that is
true and useful — the nav was not walked.**

**Tests:** `walkHostNote` has six unit cases, including the two-pane shell as a deliberate
fires-on-a-page example so nobody later "fixes" it into a threshold. Validated by removing the
`outside <= 0` guard: the suite fails.

**Not done, and named rather than implied:** only the **headless** walk emits this. The live walk
(`src/mcp/walk.ts` over the control server, `src/preload/sync.ts`'s own scroller resolution) needs the
same two fields in its `scroll` reply. That is a second increment, and the sentence is shared already.

**Also not done:** the nine fixtures are dimensioned in the measurement above and live in a
scratchpad. They enter the tree when a page-level test consumes them; an unused fixture is the dead
weight this card's own author reverted twice on `bug-redirect-note-missing-not-late`.
