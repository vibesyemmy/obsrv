---
title: "Two page-side queries still stop at the shadow boundary: stuck chrome, and the iframe count"
column: backlog
kind: chore
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
