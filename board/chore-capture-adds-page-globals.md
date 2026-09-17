---
title: "The full-page capture leaves its helpers on the page, where a page of its own can collide with them"
column: backlog
kind: chore
criterion: B2
order: 91
---

FILED BY HENRY 2026-09-17, out of Wren's adversarial read of `#293` (N6), who asked for it as a card
of its own rather than a line inside another one. Reasoned from the code; not yet measured.

The full-page capture evaluates `SCROLL_HOST_SCRIPT` at the **top level of the page's own main world**
(`src/cli/main.ts`), so every function in it becomes a page global: `findScroller`, `scrollOffset`,
`canScroll`, `isVisible`, `rootScrolls`, `overflowHidden`, `inDialog`, `framesInViewport`, `clipTest`,
plus the two constants — and, since `#293`, `shadowParent`, `shadowContains`, `shadowElements`,
`shadowElementFromPoint` and `shadowStackFrom`.

**What can go wrong:** a page whose own script declares one of those names with `const` or `let` makes
the evaluation throw (`Identifier 'shadowParent' has already been declared`), and the capture that
depends on it fails or falls back. `#293` widened the surface from ten names to fifteen, and
`shadowElements` is a plausible name for a page's own helper.

**The fix is a scope, not a rename:** wrap the script in an IIFE that hangs one object off `window`
(the stuck-chrome script already does this with `window.__obsrvChrome`), or evaluate it in an isolated
world as `AUDIT_SCRIPT` and `LINT_SCRIPT` are.

**Acceptance, with a control:**
- a fixture whose page script declares `const shadowElements = 1`: the capture still works;
- the control is the same fixture before the change, where it throws.
