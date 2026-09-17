---
title: "No e2e drags a tab: the reorder test calls moveTab directly, so the strip's drag handlers are untested"
column: doing
owner: "Rook"
waiting: ""
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

## Pulled by Wren 2026-09-17, claimed by Rook

Pulled from Backlog by Wren in a sweep rather than picked by me — recorded because the board reads
differently if a card walks itself out of Backlog.

**What is actually uncovered, confirmed by reading `TabBar.tsx` before starting:** `Tab` is
`draggable` and carries `onDragStart` (sets `effectAllowed`, writes `text/plain`, lifts `dragId`),
`onDragOver` (**`preventDefault()` — without it the drop never fires, because the default answer is
"no"**), `onDrop` (`preventDefault()` then `onDrop(index)`), and `onDragEnd`. `TabBar` holds `dragId`
and `overIndex`, and `drop(index)` calls `window.obsrv.moveTab(dragId, index)` only when `dragId` is
not null. **None of that is reached by `moveTab` being called directly**, which is where #204 left the
test.

So the gap is precisely: the index the gesture computes, and the state that survives from `dragstart`
to `drop`. Both are things an edit can break silently.

**The open question is whether the tool can reach it at all**, and the card is right that it is
unmeasured: Playwright drives HTML5 drag through CDP `Input.dispatchDragEvent`, and whether that
reaches an Electron `BrowserWindow`'s renderer is not something reading settles. **If it does not, that
goes on this card as a finding** — a `dispatchEvent` stand-in would exercise my own synthetic events
rather than Chromium's drag, which is the same shape as the `moveTab` call this card exists to replace.

**Where it runs:** CI. `tabs.spec` relaunches the app, and after tonight CI is the right default for
anything in that file from me.
