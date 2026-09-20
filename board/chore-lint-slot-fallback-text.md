---
title: "lint's own-text collection has the same display:contents blind spot audit just fixed"
column: backlog
kind: chore
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
