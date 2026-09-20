---
title: "Two collection edges at the shadow boundary: a host that wraps a control, and a slot's fallback text"
column: done
kind: chore
criterion: B2
order: 90
---

FILED BY HENRY 2026-09-17, out of Wren's adversarial read of `#293` (R5, R6). Both reasoned from the
code, neither measured on a page.

- **A host that wraps a control is counted twice.** A component written as
  `<x-button role="button" tabindex="0">` whose root holds a native `<button>` matches the audit's
  target selector twice: the host, and the button inside the root. Before `#293` only the host was
  measured. The finding then reads as two overlapping targets at the same box, and the mm figures are
  the same figures twice.
- **A slot's fallback text is never measured.** `<slot>Buy</slot>` renders its fallback when nothing
  is assigned, and a `<slot>` is `display: contents`, so its rect is zero and `shown` drops it. The
  glyphs are on the screen and no rule sees them.

**Acceptance, each with a control:**
- a fixture with a host wrapping a native control: one target, at one box, and reverting the rule
  brings the second back;
- a fixture with an unassigned slot holding fallback text: the text is measured, and the control is
  the same slot with content assigned, where the fallback is not on the screen and must not be.

## DONE, 2026-09-20 by Kenya

**Host-wraps-control**, measured first via a headless `playwright` probe (not Electron — confirmed
both `outerMatches`/`innerMatches` true and the double-match is real before writing a fix). Fix in
`audit.ts`'s target loop: `shadowHostChain(el)` walks up through `getRootNode()` for every level of
shadow nesting (a host can itself be shadow content of an outer host), and a candidate is skipped when
any host in its chain is already in `matchedTargets` — the set of elements already added, populated as
the loop goes. `shadowElements` visits a host before it descends into that host's own root (its own
comment says so), so a host is always in the set before its descendants are considered.

**Slot fallback**, same probe: confirmed `<slot>` is `display: contents` by UA default, its own
`getBoundingClientRect()` is a real zero, and a `Range` over its contents reports the actual rendered
box (26.7 × 18 in the probe). Fix: `ownRect(cs, el)` uses a `Range` instead of the element's own rect
whenever `cs.display === 'contents'` — general to the CSS value rather than special-cased to `<slot>`,
since a page can set `display: contents` on anything and the same zero-rect problem follows.

**Tests**, `tests/browser/shadowTree.test.ts` (already the home for `#293`'s own shadow-boundary
tests, alongside `auditPage`): a host that is itself a target wrapping a native control (one target,
not two), nested hosts two levels deep (one target, not three — the multi-level case the single-level
version of the fix would have missed), and the slot fixture (fallback measured when empty, not
measured once real content is assigned). **Each control run for real**, not assumed: reverted each fix
in turn and confirmed the corresponding test reds with the right count (2 not 1, 3 not 1, `[]` not
containing the fallback text) before restoring.

**Found and filed rather than folded in:** `lint.ts` has the same own-text-node collection shape as
`audit.ts` did, so its own slot-fallback text is likely the same blind spot — but its loop shares one
rect between text, edges, images and spacers, so the same fix isn't necessarily safe there without its
own look. Filed as `chore-lint-slot-fallback-text.md`.

Full suite green: `npm run build && npm test` (102 files, 1428 passed, 1 skipped) and the browser
project (9 files, 152 passed, including all 18 in `shadowTree.test.ts`). `npm run typecheck` clean.
