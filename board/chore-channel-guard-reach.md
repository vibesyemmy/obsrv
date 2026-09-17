---
title: "The preload-channels guard sees only app.ts's IPC.x sends, so six channels could lose their handler unnoticed"
column: done
owner: "Henry"
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

## In review 2026-09-17: the guard reads all three shapes

`tests/unit/preloadChannelsHandled.test.ts` now collects sends from:
- `ipcRenderer.send|invoke|sendSync(IPC.x` in `src/preload/app.ts` (more than 30, as before);
- `frameChannel(IPC.x, IPC.y)` in `app.ts`, whose second argument is the channel sent on first subscribe
  (at least 2);
- `src/preload/sync.ts`'s `ipcRenderer.send(NAME` through `const NAME = '…' satisfies typeof IPC.x`
  constants (at least 4). **A send through a name the guard can't resolve fails**, so a new shape can't
  pass unread.

It counts as handled `on|handle|once(IPC.x` in `src/main`, plus `subscribe: IPC.x` in a `FrameChannels`
object (frameBus's default, and `tabs.ts`'s reference bus). The latter counts only while `frameBus.ts`
still registers `ipcMain.on(channels.subscribe`, which the test asserts.

**Controls, one per shape, each red at its own name:**
- (a) main's `scrollResult` handler renamed → `unhandled: scrollResult`;
- (b) `tabs.ts`'s `subscribe: IPC.referenceSubscribe` removed → `unhandled: referenceSubscribe`;
- (c) frameBus registering `channels.frame` instead → "attachFrameBus no longer registers…";
- (d) the original shape, `moveTab`'s handler renamed → `unhandled: moveTab`.

All four were restored from copies; the test passes on the clean tree.

## Merged 2026-09-17: #237 (3d9d040)

The preload-channels guard reads all three send shapes, and fails on a new preload file or on a sendToHost or postMessage send.
