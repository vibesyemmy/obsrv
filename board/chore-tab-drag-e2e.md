---
title: "No e2e drags a tab: the reorder test calls moveTab directly, so the strip's drag handlers are untested"
column: backlog
kind: chore
order: 70
---

FOUND BY HENRY 2026-09-17, merging #204.

The tab-drag bug was a missing main handler: `TabBar`'s drop called `window.obsrv.moveTab` and main never
handled `IPC.moveTab`. The persistence test in `tests/e2e/tabs.spec.ts` "moved" a tab by calling
`tabs.move()` in main, which skipped the preload and the IPC hop. That's why it stayed green.

#204 moved the test one layer out, to `p1.evaluate(id => window.obsrv.moveTab(id, 1), …)`, which covers
preload → main. It still skips the renderer's gesture: `Tab`'s `onDragStart`/`onDragOver`/drop and
`TabBar`'s `dragId`/`overIndex` state (`src/renderer/src/components/TabBar.tsx`, HTML5 drag and drop).
A regression there, say a drop index off by one or `dragId` cleared before the drop, would pass.

**The test:** open three tabs, then Playwright `locator.dragTo()` from the first tab onto the third. Assert
the order from the `tabsChanged` snapshot (main's answer, not the strip's local state), then relaunch and
assert it again. Playwright drives Chromium's drag through CDP (`Input.dispatchDragEvent`), not the OS,
so it should work in the click-through harness window and stay desk-safe. **That's unmeasured;** if CDP
drag doesn't reach an Electron `BrowserWindow`, say so on this card rather than falling back to
`evaluate`. **Control:** break the drop index (`index + 1`) and the test must go red.
