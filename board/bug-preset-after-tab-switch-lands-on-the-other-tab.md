---
title: "A preset sent straight after a tab switch may resize the new tab with the old tab's settings: read from the call chain, not reproduced"
column: next
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
