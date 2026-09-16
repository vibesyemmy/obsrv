---
title: "A preset sent straight after a tab switch landed on the tab just left: reproduced with the gap forced open, and fixed"
column: done
owner: "Henry"
kind: bug
order: 58
---

FOUND BY KENYA 2026-09-16, reading #87 after it merged (room #215). **Filed by Henry, unowned. It is a
hypothesis, not a finding. Reproduce it before writing a fix.**

## What the reading says

- `TabBar.tsx:170` sends `activateTab` to main and does not touch the store. Main changes its active
  tab at once, and the renderer learns about it afterwards through `onTabsChanged`. So the renderer's
  active tab can lag main's, and it can never lead.
- Every agent patch applies through `patchTabWith(s.activeId, …)`, the renderer's idea of the active
  tab.
- **So, suspected:** an agent that calls `activateTab(B)` and then a preset command, fast enough to
  land inside that lag, patches tab A in the store and sends A's dimensions. Main applies them to
  **B's** target.
- If that happens, the viewport goes to the wrong tab. That is worse than #87's onion-skin flag, which
  rides the same invariant and adds no new assumption (Kenya's read).

## Not established, and load-bearing

- **Reachability.** Nothing Kenya could see closes the window. The setPreset confirmation handshake
  from agentic pass 4 may already close it. Not checked.
- **Ordering between `ipcRenderer.send` (`activateTab`) and `ipcRenderer.invoke` (`setViewport`).**
  Assumed, not measured.

## The control, which needs no desk

`activateTab(B)`, then a preset command with no wait, then assert which target resized and what each
tab's store holds. Run it enough times to see a lag-sized window. A green run proves nothing unless a
variant that forces the lag (a delayed `onTabsChanged`) goes red first. Without that arm, the
window may simply never have been open during the runs.

## REPRODUCED AND FIXED 2026-09-16 by Henry: forced, then closed

**Reproduced, with the gap forced open.** `tabsChanged` was held back 600 ms by a test-only hook
(`OBSRV_TEST_TABS_CHANGED_DELAY_MS`), in a new spec, `tests/e2e/tab-switch-preset.spec.ts`:
- **`activateTab(B)` then `setPreset(iphone-61)`:** B stayed 1366×768 and the reply said
  `applied: false`. Brought back to front, **A rendered 393×852, and the strip named A `iphone-61`.**
  The preset landed on the tab just left, as Kenya's reading predicted.
- **`openTab({ preset: iphone-61 })`:** the new tab stayed 1920×1080, and the tab in front before it
  took the preset. **The reply was `ok`.**

**With no forced gap:** 16 of 16 runs on an idle machine were clean. The natural gap needs a
lagging renderer, which is plausible while a heavy page paints. The consequence, when it happens, is
silent corruption of a different tab. That makes it worth fixing rather than calling rare.

**Found while reproducing, beyond the card:** `openTab` with a preset is the same race inside a single
command, and there the renderer hasn't heard of the new tab at all.

**The fix:**
- Main names the tab in every agent patch (`AgentApplyPatch.tabId`, set by main only).
- For a tab that is open but not in front, the renderer writes the patch to that tab, using the same
  writes the front-tab setters make (`applyAgentPatchToTab`).
- For a tab it hasn't heard of yet, it holds the patch until `tabsChanged` brings that tab, bounded
  at 16.

**Measured with the gap forced:**
- both arms pass: the front tab takes the preset (393×852, `applied: true`) and the tab left keeps its
  own; the new tab from `openTab` takes it;
- **three sabotages, one run each:**
  - ignoring `tabId` in the renderer turns the `activateTab` arm red;
  - dropping the hold turns the `openTab` arm red;
  - main sending no `tabId` turns both red;
- unit tests cover the background-tab write, including a highlight surviving a preset in the same
  patch, and the no-op cases.

**Not covered:** the renderer's own `setViewport` still carries no tab, so any other change made in
the gap (a window resize, say) would be applied by main to its front tab. No such case has been
observed. It's the same shape, and it would take a separate change to the viewport IPC.

