---
title: "When the scroll-host search runs out of budget it says nothing, and every surface inherits the answer"
column: doing
owner: "Kenya"
waiting: ""
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

## BUILT 2026-09-22 by Kenya, routed by Henry (`#1635`)

**Chose the return-value form, not the page flag.** `findScroller` now returns `{ el, truncated }`
rather than a bare `Element | null`. The page-flag route (`window.__obsrvScrollHost`, which the
capture already sets) only fits the one caller that persists a scroller across separate
`executeJavaScript` round trips; `walkStep`, `audit.ts`, `lint.ts` and `preload/sync.ts` all read the
result within the same call, so a page-global would be state with no reason to exist for them. The
function stays self-contained for `.toString()` injection — `truncated` is built and returned inside
the same closure, nothing from an outer scope.

**Every call site updated, TypeScript did the finding:** `walkStep` (`scrollHost.ts`), `audit.ts:98`,
`lint.ts:153`, `preload/sync.ts`'s `resolveScroller` (kept its own `Element | null` signature — the
live scroll path doesn't need to expose truncation, per the acceptance's two named surfaces), and the
capture's inline call in `cli/main.ts`. `npm run typecheck` caught all of them; none were missed.

**Both named surfaces now say so:**
- `WalkBlocked` gets a `truncated` field; `walkNothingNote` checks it **first**, ahead of every other
  guess, since none of the frame/shadow-root counts are honest claims when the search that measured
  them didn't finish. `mcp/walk.ts`'s `blockedFrom` decodes it from the wire; `cli/walk.ts` gets it for
  free through the shared `WalkStepResult` type.
- The full-page capture's own `!shell.found && shell.hidden` branch (`cli/main.ts`) gets a new
  `shell.truncated` arm ahead of the existing one, same reasoning.

**Fixtures and controls, each reverted and confirmed red before restoring:**
- `tests/browser/findScroller.test.ts`: extended the existing "degrades predictably past MAX_VISITED"
  test with `truncated: true`/`false` assertions on both the over-budget and control fixtures, plus a
  new assertion that a genuinely-empty page (well inside budget) reports `truncated: false` — the two
  populations `null` used to collapse into one.
- `tests/unit/walkCoverage.test.ts`: two new `walkNothingNote` cases — the sentence itself, and that it
  takes priority over a wall the same call also measured.
- `tests/e2e/cli-snap-tiled.spec.ts` + new fixture `app-shell-scroller-search-truncated.html` (2,100
  decoy elements ahead of anywhere a scroller could be, same hidden-overflow shell as the sibling
  `app-shell-unreachable.html`): the capture's new sentence fires, the old one does not.

**Full suite green:** 105 unit files (1449 passed), 9 browser files (152 passed), typecheck clean, and
the 21 tests in `cli-snap-tiled.spec.ts` (the new one plus every existing one in the file) pass.

**Not done, named rather than assumed:** `audit.ts`/`lint.ts` still silently use whatever `findScroller`
returns for page coordinates, truncated or not — the acceptance only asked the two "nothing to scroll"
sentences to say so, not for a third note on every audit/lint reply. A page that exhausts the budget
and lands on a *wrong but non-null* scroller (not just `null`) still measures coordinates against that
wrong host, with nothing surfacing it. Worth its own card if it turns out to matter in practice; not
folded in here because it isn't measured yet, only reasoned from the same mechanism.
