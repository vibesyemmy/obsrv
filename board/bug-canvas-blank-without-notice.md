---
title: "The target canvas can stay blank for ten seconds with the app reporting nothing"
column: doing
kind: bug
owner: "Kenya"
waiting: ""
order: 72
---

FOUND BY KENYA 2026-09-17, reading the `panes:83` recurrence @Henry recorded on
`bug-target-canvas-no-frames`. **Split from that card deliberately: it is the same symptom with the
opposite tell.** That card is about the app *saying* `No frames from target renderer`. This is the
case where it says nothing at all, and a card that covers both would be answered by fixing either.

## Observed, once, on CI

Run `35176357601` attempt 1 (evidence kept at
`/private/tmp/obsrv-evidence/panes83-run35176357601-attempt1/`):

    03:12:36.953  gpu: compositing enabled, webgl enabled
    03:12:37.9    ✓  panes.spec:77  the toolbar navigates both panes (142ms)
    03:12:58.1    ✘  panes.spec:83  the target canvas shows the page, not a blank (10.0s)

**The predecessor passed one second earlier**, so both panes really were on the fixture. The canvas
then showed fewer than 1000 white pixels for a full ten seconds.

**What is ruled out, by reading the log rather than by argument:**

- **`No frames from target renderer` appears 0 times.** The app never noticed.
- WebGL was **enabled** at launch and no context loss was logged.
- The tests after it pass, but they read **geometry (`:111`) and click coordinates (`:151`), not
  pixels** — so nothing in that run shows the canvas recovering either. Only `:83` looks at pixels.

**What is NOT established:** whether this recurs, and whether it is CI-only. One sighting. The retry
in the same run is not a second one — `:83` inherited its page until #230, so a retry ran it from an
empty tab.

## The hypothesis, which is a hypothesis

The renderer draws the canvas **on an animation frame**, and Chromium fires none while a window is
hidden or fully occluded. That is the measured fact `bug-hidden-window-capture-test-cannot-see-drawnow`
turns on, and the whole reason `flushRendererDraw` and the `drawNow` handshake exist for captures. A
CI window that is never activated would give exactly this shape: **frames arriving in main, no
notice, and a canvas nobody ever draws into.**

It would also explain the silence: main has its frames, so nothing there is missing, and the
renderer is not failing — it is simply not being asked to paint.

## The probe, with its vacuity arm named first

**Count `requestAnimationFrame` ticks in the renderer over ~500 ms in the failing state.**

- **Vacuity arm first:** the same count on a window deliberately hidden or occluded, where it must
  drop to ~0. A probe that has not been shown to see throttling cannot be believed when it reports a
  healthy number.
- Then the count in the `panes:83` failing state. Near zero supports the hypothesis; a normal count
  refutes it and the cause is elsewhere.

**On CI, via a throwaway branch and `workflow_dispatch`.** The occluded arm must not run on
Opeyemi's desk.

## If it is confirmed

The fix is not obviously "draw anyway": a window nobody can see has no reason to paint, and the
capture path already solves its own version with an explicit handshake. The question would be
whether the **test** should drive a draw the way a capture does, or whether the product should paint
the canvas when frames arrive regardless of visibility. That is a decision, not a defect, and it
belongs on this card once the probe has answered.

## The CI probe, run by Henry 2026-09-17 while Kenya was away (Wren's routing, Henry's design in room #361)

**Moved while Kenya was away, as recorded here. Kenya reports to the room first when back.** Run
`35186562119` on a throwaway branch (`probe/raf-occlusion`, now deleted). Its counts are in the run's
`raf-probe` artifact. The spec skipped unless `CI` was set. It counted `requestAnimationFrame` ticks in
the **shell renderer** (the window that draws the target canvas), three samples of 500 ms per arm, with
`document.visibilityState`:

| arm | ticks in ~500 ms (×3) | visibilityState |
| --- | --- | --- |
| shown: the harness as CI leaves it | 27, 28, 28 | visible |
| hidden: `win.hide()` (Kenya's desk arm) | 28, 27, 30 | visible |
| shown again: `showInactive()` | 30, 31, 28 | visible |
| **occluded: a second app launched with `OBSRV_TEST_TAKES_THE_DESK`, covering it** | **30, 27, 28** | **visible** |
| after that app quit | 29, 24, 29 | visible |

**The occluder was real, checked:**
- `getFocusedWindow() !== null` in the holder, so it held the front.
- The holder's window was x 120–1800, y 25–995; the harness's was x 160–1760, y 25–995. It covered
  the harness completely. The window manager clamped the vertical 40 px margin to the screen, so the
  top and bottom edges are flush.

**The vacuity arm failed.** Real occlusion didn't throttle animation frames in the shell renderer on a
runner. Neither did `hide()`, here or on Kenya's desk, and `visibilityState` never left `visible`. So
**the mechanism this card proposed has no support on CI**: the runner doesn't stop the canvas's
animation frames. That hypothesis is set aside, and the silent blank canvas needs another explanation.

**What this does not settle, and it isn't overstated:**
- **A real desk with real occlusion is untested.** That arm takes the desk. A runner's virtual display may
  not compute occlusion at all, so this doesn't refute `flushRendererDraw`'s premise as measured on a
  desk. It only shows CI isn't in that state.
- `backgroundThrottling: false` is set on the **offscreen target** only (`targetSource.ts:330`), not on
  the shell window counted here. So the app's own setting doesn't explain these counts.
- Nothing here yet explains the one sighting. The target frames that did arrive in main
  (`bus.lastSeq()`), and whether the renderer got them, are the next thing to record on a recurrence.

## A SECOND SIGHTING, read 2026-09-17 by Kenya — run `35123165259` at `108e139`

Read while settling the `bug-ci-main-red-37pct` row, and it is the same shape as the first:

    ✓  375  panes.spec.ts:77  the toolbar navigates both panes (258ms)
    ✘  376  panes.spec.ts:83  the target canvas shows the page, not a blank (9.8s)
         Expected: > 1000   Received: 0

- **The predecessor passed**, 258 ms earlier, so both panes were on the fixture. Genuine, not the
  retry confound #230 removed.
- **Zero white pixels** — nothing drawn at all. The first sighting reported the poll timing out;
  this one reports the count, and the count is 0.
- **`No frames from target renderer`: 0 occurrences**, again. The app said nothing, again.

**So this card has two sightings on two different heads**, eight days of runs apart in the tally's
ordering, both with a passing predecessor and both silent. It is not a one-off.

**What it still does not have is a mechanism.** The rAF hypothesis lost its support on CI (#247):
**occlusion does not throttle animation frames on a runner** — 30/27/28 ticks with a fronted holder
app covering the window — so the vacuity arm failed there too, and nothing connects a blank canvas to
missing animation frames. The next recording is Henry's: `bus.lastSeq()` against what the renderer
received, which separates "main never sent a frame" from "the renderer never drew one".
