---
title: "Two page-side queries still stop at the shadow boundary: stuck chrome, and the iframe count"
column: done
kind: chore
owner: "Henry"
criterion: B2
order: 87
---

FILED BY HENRY 2026-09-17, left over from `feat-measure-open-shadow-roots`, which entered open roots
for the four things its card named (collection, ancestors, hit-testing, the walk) and nothing else.
Two more page-side queries use `document.querySelectorAll` and so still stop at a shadow boundary:

- **Stuck chrome** (`src/shared/stuckChrome.ts`, `candidates()`): a `position: fixed` or `sticky` bar
  inside a web component isn't a candidate, so a tiled capture repeats it on every band. A component
  app header is the common case.
- **The iframe count** (`framesInViewport` in `src/shared/scrollHost.ts`): an iframe inside a component
  isn't counted, so a consent wall mounted inside one isn't named by the empty-page or walk sentences.

Neither has been seen on a page yet. Each needs a fixture first. The traversal already exists as
`shadowElements`.

**Acceptance, each with a control:**
- a fixture with a fixed header inside an open root: the tiled capture hides it on bands after the
  first, and reverting to `querySelectorAll` repeats it;
- a fixture with a full-viewport iframe inside an open root: the empty-page sentence names it, and
  reverting stops naming it.

## MEASURED AND FIXED 2026-09-23 by Henry

**Each half measured before it was touched, with its light-DOM twin as the control** — the card
required that, since *"neither has been seen on a page yet."* Headless Chromium at 1280x800, the
**shipped strings** evaluated rather than the modules, because a serialised script is what the app
runs and that distinction cost 14 CI failures earlier the same day.

| query | light DOM (control) | inside an open root |
| --- | --- | --- |
| stuck chrome, `mark()` then `settle()` | **1 bar** — `div#bar`, fixed, 56 px tall | **0** |
| `framesInViewport()` | **count 1**, coverage 1 | **count 0**, coverage 0 |

Both defects reproduced exactly as filed: a component app header was never a stuck-chrome candidate,
so a tiled capture repeated it on every band; an iframe inside a component was never counted, so a
consent wall mounted in one went unnamed by the empty-page and walk sentences.

### The fix, and the thing it had to carry

Both now walk with `shadowElements`, which already existed. `STUCK_CHROME_SCRIPT` gained
`SHADOW_TREE_SCRIPT` at its head, because **the traversal has to ship with the function that calls
it** — `toString()` carries a body and nothing around it.

After the fix each root case matches its light-DOM control exactly: **1 bar, and count 1 with full
coverage.**

### Guarded in both directions

Four browser tests, in `tests/browser/shadowTree.test.ts` where the real roots and real layout are.
Sabotaged back to `document.querySelectorAll` both halves fail **and both light-DOM controls stay
green**, so neither test is vacuous.

Full suites: unit **1449 passed**, browser **156 passed**, typecheck clean.

### What the acceptance asked for and this does not do

The written acceptance is end-to-end — *"the tiled capture hides it on bands after the first"* and
*"the empty-page sentence names it"*. **This proves the query, not the sentence.** Both behaviours sit
behind a CLI capture and an e2e run; the queries they are built on are now correct and directly
tested, and the end-to-end pair is worth its own pass rather than an assertion I have not made.

## CLOSED 2026-09-23 — merged, board column was never flipped

`#449` merged (`2187cb54`), after a `CONFLICTING`-PR detour that cost a false "no run" reading along
the way. Idris PASS'd the real head (room #1958-1959): fresh `pull_request` run `35838826196` on
`29c7feb`, `success`, one unrelated flake (`cli-walk.spec.ts:192`, retry-rescued). Code and gate were
both done; only the card's own `column`/`waiting` fields still said `review`.
