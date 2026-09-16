---
title: "The hidden-window capture test passes with the `drawNow` handshake removed, so it cannot catch the regression it was written for"
column: doing
kind: bug
owner: "Kenya"
waiting: ""
order: 54
---

FOUND BY HENRY 2026-09-16, while running the control Wren's `bug-e2e-takes-the-desk` asks for (*"a
planted stale frame must still go red"*). **CLAIMED BY KENYA 2026-09-16** on Wren's routing: it is the same shape as `chore-strict-output-under-test` — a green that holds with the guarded thing removed. Not caused by that fix: it holds on `main`.

## Observed, on this desk, one run each

`tests/e2e/live-drive.spec.ts`, *"a capture of a hidden window shows the page now, not the frame
before it went away"*. The sabotage made `flushRendererDraw` in `src/main/ipc.ts` answer at once
without sending `IPC.drawNow`. The built `out/main/index.js` had 0 `obsrv:draw-now` sends against
1 normally, so the sabotage really was in the build.

| build | `drawNow` sabotaged | test |
| --- | --- | --- |
| `main`'s window code and tests | **yes** | **passed** |
| `main`'s window code and tests | no | passed |
| the desk fix | **yes** | **passed** |

**The test was not skipped.** Its `hideEventsFire` probe passed, so the window really was hidden.
It hides the window, navigates from a red page to a white one, and asserts that `captureTarget`
shows white. **It showed white without the handshake that exists to make that true.**

## What that means

The handshake was the fix for a capture measured three navigations behind on a real occluded
window (see the test's own comment). **Today, on this desk, nothing in the suite would notice if
it stopped working.** Candidates for why the test passes anyway, none checked:
- `webContents.capturePage` on a hidden window may make Chromium produce a fresh frame itself;
- `win.hide()` may not stop the app renderer's animation frames the way real occlusion by other
  windows did;
- this desk may differ from the one the stale capture was measured on.

## What a fix has to show first

**A planted stale frame that the test catches**, meaning a setup under which removing `drawNow`
turns this test red, before anything about the handshake is changed or trusted. If no setup
on a real desk makes it red, that is a finding about the handshake too: it may no longer be needed.
