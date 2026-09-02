# A white target pane after a GPU reset

The report reads: *"No frames from target renderer", the target pane is white
with a broken-image glyph in its corner, Reload does nothing, and quitting and
reopening the app clears it.* This records what that is, how it was found, and
what the app now does about it, so the next report of a blank target starts
from here.

## What it is

Not the target. The offscreen window paints throughout; main's frame stream is
fine. The **shell renderer's WebGL context** is gone, and the canvas that draws
the target is WebGL.

The chain:

1. The app's GPU process dies. A driver reset, a dock or display change,
   memory pressure — anything. Chromium starts a new one; every WebGL context
   in every renderer is lost.
2. `TargetCanvas` handled `webglcontextlost` by tearing the renderer down
   **and unsubscribing from frames**, and only resubscribed on
   `webglcontextrestored`.
3. Chromium restores a context after one GPU reset. After the **second** it
   blocked WebGL for the renderer's domain for the rest of the session — a
   browser policy, where the page gets an infobar whose button lifts the
   block. Electron has neither the infobar nor the API. `webglcontextrestored`
   never fired, `getContext('webgl2')` returned null even on a fresh canvas.
4. Nobody was listening for frames. The next navigation armed the stall
   watchdog, no frame reached it, and it said "No frames from target
   renderer" — the one thing that was not true — over a Reload button that
   reloads the target, which was never the problem.

The white pane with the broken-image glyph is how Chromium draws a canvas
whose context is lost and not coming back.

## How it was pinned

Killing the app's `--type=gpu-process` helper with `SIGKILL`, on a throwaway
instance of the built app:

| Kills | Old context | Fresh canvas gets WebGL2 | Stall on next navigation |
| --- | --- | --- | --- |
| 1 | lost, restored in under 3 s | yes | no |
| 2 | lost, never restored | **no** | **yes**, Reload useless |
| 3+ | lost | no; GPU compositing falls to software, WebGL off for the session | yes |

Main's own paint stream was checked separately at each step (`invalidate`,
`reload`, resize, recreate) and delivered a frame every time.

## What the app does now

**Main** passes `--disable-domain-blocking-for-3d-apis`. Resets one and two
now both restore. The switch exists for a browser sandboxing hostile origins
from the GPU; this app is one bundle on one `file:` URL. Chromium's crash
limit — three, then software compositing — is left alone: an endlessly
restarting GPU process is worse than an honest notice. Main also logs
`child-process-gone` for the GPU with Chromium's reason, so the next report
carries the evidence this one lacked.

**The canvas** treats a lost context as a recovery, not a stop:

- The watchdog is disarmed with the subscription, so a lost context is never
  reported as a target that stopped painting.
- Chromium gets `RESTORE_GRACE_MS` to restore the context. On restore, the
  renderer is rebuilt on the same canvas and resubscribes; a new subscription
  is answered with a full frame, so the watchdog is re-armed to watch for it.
- No restore inside the grace period, and the **canvas element is replaced**
  (`epoch` is its React key). A written-off context belongs to its element;
  a fresh element is the only route to a fresh one. One retry after a pause,
  since the GPU process may itself still be restarting.
- Still no context, and WebGL is gone for the session. The notice says so —
  *Graphics reset: WebGL is unavailable until Obsrv restarts* — with a
  **Restart Obsrv** button (`app.relaunch()` + `app.quit()`), because a new
  process is the only thing that gets it back.

The canvas carries a `data-gl` attribute (`ok`, `lost`, `none`) for the e2e
suite. A test that asked `getContext` itself would create a context on a canvas
that has none and report a health the app never had — and a page may hold only
sixteen WebGL contexts, past which Chromium loses the oldest, which is the
target's. (An early version of the investigation's own probe did exactly that
and manufactured two extra losses.)

`tests/e2e/gpu-reset.spec.ts` kills the helper for real. Crashes are counted
per session, so the order is the budget: two in quick succession must recover
with the page on the canvas and no stall notice; the third must never produce
the notice that blames the target, whichever way Chromium goes on the machine
running it. Against the code before this change the burst test fails as the
field did — the context stays lost — and the third-crash test fails because
no notice exists.

## The log file

The report above came with no evidence because there was nowhere for any to
go: a packaged app launched from the Dock has no stderr, and Chromium's own
logging is off in packaged builds. Main now writes its own log —
`~/Library/Logs/Obsrv/obsrv.log`, revealed by **Help → Show Log File**, one
megabyte and one predecessor at most — with the things the renderer cannot
see: the version at boot, Chromium's GPU verdict when it reports it and again
whenever it changes (not at `ready`, where the answer is placeholders — the
0.18.3 line said "disabled" on a healthy machine for that reason), every
child process that dies and Chromium's reason, the window going hidden and
coming back. The
renderer reports through it what main cannot see: a WebGL context lost, and
whether it was restored, replaced, or written off. Under the e2e suite the
file lives in the throwaway user-data directory instead.

A field example, from the instance that raised the report:

```
… warn  GPU process gone (abnormal-exit, exit code 8704)
```

8704 is Chromium result code 34, *GPU exit on context lost*: the process
chose to restart because its own Metal context was lost. 512 is code 2,
*hung*: the watchdog killed a frozen GPU process, and the seconds before it
are the hang the user felt.

## Rasterising only while someone is looking

The active target paints at 30 fps with `backgroundThrottling` off, by
design: the pane must not stutter when the app is merely unfocused. Left
alone, it also painted a full viewport at 30 fps for nobody the whole time
the window was hidden, minimised or entirely behind another app. On a machine
whose GPU is already struggling, that is the load wanted least while the user
is elsewhere — and "it hangs when I come back to it" was the second report.

`TabManager.setShellVisible` now pauses the active target on the window's
`hide`/`minimize` events and resumes it on `show`/`restore`, invalidating so
the frame that changed while nobody looked arrives at once. macOS sends
`hide`/`show` for occlusion too, so a window fully behind another app counts.
Main tells the renderer when it pauses (`IPC.targetPaused`), and the stall
watchdog stays quiet meanwhile, since a navigation made then owes no frame
until the window returns. Told, not inferred: the shell's own page
visibility was measured staying `visible` through hide and minimise. An agent capture
of a hidden window takes a painting hold for its duration, so it sees the
page as it is, not the last frame before the window went away.

## Why the GPU process dies

Unknown, and out of the app's hands. The instance that raised the report had
its GPU helper restart eight minutes after launch, with no crash report and
nothing in the unified log. The machine runs a DisplayLink dock, a known source
of GPU-process instability on macOS. If it recurs, the `obsrv: GPU process
gone` line in the app's stderr now says what Chromium saw.
