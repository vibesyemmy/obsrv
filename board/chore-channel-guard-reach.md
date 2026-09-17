---
title: "The preload-channels guard sees only app.ts's IPC.x sends, so six channels could lose their handler unnoticed"
column: doing
owner: "Henry"
waiting: ""
kind: chore
order: 69
---

FOUND BY HENRY 2026-09-17, reading the reach of `tests/unit/preloadChannelsHandled.test.ts` (#204). The
guard exists because the tab strip's `moveTab` was sent by the preload and handled nowhere in main, so
dragging a tab did nothing and no test noticed.

**What it checks:** `ipcRenderer.(send|invoke|sendSync)(IPC.x` in `src/preload/app.ts`, against
`on|handle|once(IPC.x` anywhere in `src/main`.

**What it can't see (all handled today, checked by reading):**
- **`src/preload/sync.ts`** sends through local constants typed `const SYNC_SCROLL = 'obsrv:sync-scroll' satisfies
  typeof IPC.syncScroll`: `syncScroll` (handled in `tabs.ts`), `scrollResult`, `selectOpen` and `pickerOpen`
  (handled in `ipc.ts`). The guard doesn't read the file, and wouldn't match `IPC.` in the call if it did.
- **`frameChannel(IPC.frame, IPC.frameSubscribe)`** and **`(IPC.referenceFrame, IPC.referenceSubscribe)`** in
  `app.ts` send the subscribe channel through a parameter. Main handles them indirectly:
  `attachFrameBus`'s `channels.subscribe` (`frameBus.ts`, default `IPC.frameSubscribe`; `tabs.ts` passes
  `IPC.referenceSubscribe`).

**Fix direction:**
- Resolve sync.ts's `satisfies typeof IPC.name` constants to their names.
- Count `frameChannel(…, IPC.x)`'s second argument as a send.
- Count `subscribe: IPC.x` in a `FrameChannels` object, plus frameBus's default, as a handler.
- Keep the "not vacuous" floor per file.
- **Control:** rename one handler in each of the three shapes; each must go red.

## Claimed by Henry 2026-09-17, routed by Wren

Unit-level and desk-free, per the card's direction:
- resolve `sync.ts`'s `satisfies typeof IPC.x` constants;
- count `frameChannel(…, IPC.x)`'s subscribe argument as a send;
- count `FrameChannels.subscribe` (including frameBus's default) as a handler.

Control: rename one handler in each shape, and each must go red.

