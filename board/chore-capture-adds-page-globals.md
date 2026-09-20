---
title: "The full-page capture leaves its helpers on the page, where a page of its own can collide with them"
column: done
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

## DONE, 2026-09-20 by Kenya — a scope, not a rename, matching the pattern already on three of the four call sites

**The fix wasn't new: `LINT_SCRIPT`, `AUDIT_SCRIPT` and `WALK_STEP_SCRIPT` (shared/lint.ts, shared/audit.ts,
shared/scrollHost.ts) already wrap `SCROLL_HOST_SCRIPT` in an outer `(() => { ... })()`.** Grepped every
consumer before writing anything: `cli/main.ts`'s full-page capture was the ONE call site that concatenated
`SCROLL_HOST_SCRIPT` at the true top level instead of inside that same wrapper. So the fix is one more
`(() => {` around the existing template, not a namespace object — which also means it doesn't need the
`window.__obsrvChrome`-style handoff the card's first option suggested: everything inside stays a bare-name
call (`findScroller()`, `overflowHidden()`), just scoped to the outer IIFE's function body instead of the
page's real top level, so `pageScriptsAreSelfContained.test.ts`'s "never through a namespace" rule still
holds — checked by running it, not assumed.

**Reproduced the actual defect mechanism before fixing it, then reproduced the fix's absence of it.**
`webContents.executeJavaScript` is Chromium's CDP `Runtime.evaluate` under the hood, so headless
`playwright` + a raw CDP session reproduces it with no Electron needed (Electron doesn't boot in this
session anyway, per tonight's other disclosures). Measured along the way, since it wasn't obvious going in:
`page.evaluate` (Playwright's own API) does **not** reproduce the collision — it goes through
`Runtime.callFunctionOn`, not top-level `Runtime.evaluate` — and CDP's `replMode: true` deliberately
tolerates redeclaration (that's what makes a DevTools console usable); only plain `Runtime.evaluate`
collides, which is the mode `executeJavaScript` actually uses. New test,
`tests/unit/scrollHostScriptScoping.test.ts`, five cases: the unscoped (old) form colliding on
`shadowElements`, the scoped (new) form not colliding on the same page, the same pair again on
`findScroller` (a plainer name, so the fix isn't shown working for one conveniently-obscure identifier
only), the scoped form run twice on one page without colliding with itself, and the scoped form still
returning a correct answer on an ordinary page.

Full suite green after: `npm run build && npm test` — 103 files, 1433 passed, 1 skipped. `npm run typecheck`
clean.
