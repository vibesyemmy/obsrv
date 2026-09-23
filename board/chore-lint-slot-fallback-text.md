---
title: "lint's own-text collection has the same display:contents blind spot audit just fixed"
column: review
kind: chore
owner: "Henry"
waiting: "Idris: the gate on the PR"
criterion: B2
order: 101
---

FILED BY KENYA 2026-09-20, closing `chore-shadow-collection-edges`. Noticed while fixing the same
shape in `audit.ts`; not yet measured against a lint fixture.

`audit.ts`'s own-text-node loop measured a `<slot>`'s fallback content as a zero rect, because a
`<slot>` is `display: contents` by default and `getBoundingClientRect()` on an element with that
display value is always zero regardless of what it renders. Fixed there with a `Range` over the
element's contents when `cs.display === 'contents'`.

`lint.ts`'s own-text loop (`src/shared/lint.ts`, around line 266-272) is the same shape — same `SKIP`
set, same "collect direct text-node children, then `el.getBoundingClientRect()`" pattern — so a
`<slot>` fallback should be invisible to lint's text findings for the same reason.

**Not folded into `chore-shadow-collection-edges`:** `lint.ts`'s loop shares one `r`/`rect` between
text, edges, images and spacer detection, all keyed off the same `getBoundingClientRect()` call —
substituting a `Range`-based rect there could change more than the text finding, and none of that is
measured yet. Needs its own look before a fix, not a copy-paste of `audit.ts`'s.

**Acceptance:**
- measure first: does lint's own-text loop actually reach a `<slot>` with fallback content, and does
  it currently drop it (a fixture, not a reading of the source);
  - the control for the measurement, since it isn't hypothetical anymore: `audit.ts`'s fixture in
    `tests/browser/shadowTree.test.ts` ("an unassigned slot's fallback text is measured...") is the
    twin to build lint's own fixture from;
- if it reproduces, decide whether the same `Range`-based rect is safe for edges/images/spacers too,
  or whether the text finding needs its own rect separate from the rest of the loop.

## MEASURED AND FIXED 2026-09-23 by Henry

**Measured first, as the acceptance demanded — three browser cases, not a reading of the source:**

- the audit finds a `<slot>`'s fallback text (`auditPage`): **the control, and it passed**
- **lint did not.** A `<slot>` is `display: contents`, its `getBoundingClientRect()` is zero, and
  `shown()` requires width and height above zero — so the element was dropped **before the text branch
  ever ran**, not inside it
- lint finds the same words in a plain `<span>` in the same open root: **the control for the control**,
  so "lint found no Buy now" could not be satisfied by a lint that found nothing

### The second question the card asked, and it has a measured answer

> *"decide whether the same `Range`-based rect is safe for edges/images/spacers too, or whether the
> text finding needs its own rect"*

**It is not safe, and the card was right to forbid the copy-paste.** `display: contents` generates no
box, so **nothing of that element is painted** — no border, no outline, no shadow. Handing the whole
loop a `Range` rect makes the edge rules report a hairline Chromium never draws.

**That is measured, not argued.** A fixture with `<slot style="border:1px solid red">` and the loop
sabotaged to use the `Range` rect throughout **fails** on the border finding; with the fix as shipped
it reports the text and no edge.

### What shipped

`addOwnText` is extracted from the loop so the `display: contents` path can reach **the text finding
and nothing else**. The contents branch computes a `Range` rect, checks it has a size, and passes it
only there; `r` stays the box rect for edges, images and spacers, which keep skipping an element that
paints nothing.

**Both directions of the fix are guarded.** Removing the branch fails two tests; widening it to the
whole loop fails the edge test. Full suites: unit 1455 passed, browser 156 passed, typecheck clean.
