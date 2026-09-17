---
title: "`inspect` says a `visibility: visible` child of a hidden parent is not drawn, and it is"
column: backlog
kind: bug
order: 71
---

FOUND BY WREN'S 0.61.0 RELEASE SWEEP 2026-09-17: a classifier's read of #85, **confirmed by reading**,
**not measured**. It's listed under "Known, not fixed" in the 0.61.0 release notes.

## What happens

#85 made `inspect` say when the element it measured isn't drawn. `src/shared/inspect.ts` decides that by
walking from the element up through its ancestors:

```ts
for (let node: Element | null = el; node !== null && hidden === null; node = node.parentElement) {
  const cs = getComputedStyle(node)
  if (cs.display === 'none') hidden = 'display'
  else if (cs.visibility === 'hidden' || cs.visibility === 'collapse') hidden = 'visibility'
}
```

The walk is right for `display`: `display: none` on an ancestor removes the subtree, and the child's own
computed `display` doesn't show that. **It's wrong for `visibility`.** `visibility` is inherited, and a
descendant can set it back to `visible`, which draws it. The element's own computed value already accounts
for its ancestors. So a `visibility: visible` child under a `visibility: hidden` parent is drawn, yet it
gets *"this element is not drawn: … the contrast verdict is not a verdict about anything a reader sees"*.
The same happens with `--at` pointing at it.

**It also breaks #85's own claim that audit and inspect "now apply the same rule".** Audit's `shown` reads
only the element's own computed style (`src/shared/audit.ts`), so for this element audit measures it and
inspect says it isn't drawn.

## What a fix has to show

- **The rule:** read `visibility` on the element alone, and walk ancestors only for `display: none`.
- **Arms, on a fixture page:**
  1. a hidden parent with a `visibility: visible` child: **no** note;
  2. a hidden parent with a child that doesn't override: the `visibility` note;
  3. a `display: none` ancestor: the `display` note;
  4. nothing hidden: no note.
- **Control:** put the ancestor walk back for `visibility`. Arm 1 must fail, and arms 2–4 must keep passing.
- **Surfaces:** `inspectReadout` is shared by the CLI, headless MCP and the live app. One arm per surface
  isn't needed if the shared function is what the test calls. Say which it is.

## Not established

- Not measured on a real page; the classifier and Wren read the code.
- How common the pattern is. A `visibility: visible` child under a hidden container shows up in menus and
  in reveal animations, but nobody has counted.
