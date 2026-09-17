---
title: "Measure inside open shadow roots: audit, lint, inspect and the walk stop at the shadow boundary today"
column: backlog
kind: feat
criterion: B2
order: 77
---

FILED BY HENRY 2026-09-17 with `b2`'s decision to enter open shadow roots by default, with no flag. The
evidence is on `b2`: caniuse.com at 79% unmeasured (188 of 238 text elements in 57 roots), and chromestatus.com
entirely inside 159 hosts.

**Scope, one traversal for every surface.** `src/shared` holds the page-side code the CLI, headless MCP and
the live app all run, so each item below is one change, not three:
- **Collection:** audit targets and text, and lint's elements, descend into `el.shadowRoot` when it is open.
  Slotted light-DOM nodes are already collected where they sit, so a `<slot>` must not count them twice.
- **Ancestors across the boundary:** the contrast background walk and anything else climbing ancestors uses
  the composed parent (`assignedSlot`, else `parentElement`, else the root's `host`), so text inside a
  component composites onto the backgrounds it actually sits on.
- **Hit-testing:** inspect's `at` descends through `shadowRoot.elementFromPoint` from the host
  `document.elementFromPoint` returns. `selector` keeps light-DOM semantics unless a piercing form is added
  deliberately; say so either way.
- **The walk:** scroll-host detection currently looks at the light DOM (`walkNothingNote` says "in its light
  DOM"). It includes scrollers inside open roots.
- **The share note:** retires for open roots, since what it declared is now measured. Closed roots stay
  unreachable, and aren't detectable from script either.
- **Register:** figures grow on component-built pages. That's a measurement change callers should be told
  about, even though the published shape doesn't move.

**Acceptance, each with a control:**
- `tests/fixtures/half-in-shadow.html` (12 light-DOM buttons, and more inside open roots, 10 per component)
  measures every button, and reverting the traversal takes it back to 12. Count the components when writing
  the arm, not from this line;
- text inside a component on a dark component background gets that background's contrast, not the page's;
- `inspect` at a point inside a component names the component's element, not the host;
- a scroller inside an open root is walked;
- a live check on caniuse.com and chromestatus.com, reading the figures against a second browser.
