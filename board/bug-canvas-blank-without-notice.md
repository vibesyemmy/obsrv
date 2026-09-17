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

## THE VACUITY ARM FAILED FIRST, 2026-09-17 by Kenya — and that is the result

Ran the probe locally before spending CI on it. Ticks in 500 ms:

    as the harness leaves the window   31
    hidden (`win.hide()`)              32     ← must have been ~0
    shown again                        32

**`win.hide()` does not throttle animation frames on this desk.** So the arm that was supposed to
show the probe can see throttling instead showed it cannot — and a healthy count from CI would
therefore have meant nothing. **This is the whole reason the vacuity arm goes first**, and it is the
second time today that an instrument's own control caught it before a number was believed.

**It also agrees with a measurement already on the board.** In #139 the hidden-window capture test
kept producing correct pixels with the `drawNow` handshake sabotaged out — the canvas was being
drawn while hidden. Both readings say the same thing from opposite ends: **on this desk, hiding a
window does not stop the renderer painting.**

**So the hypothesis is not supported by anything yet, and one of its premises is now doubtful.** The
comment `flushRendererDraw` carries — Chromium fires no animation frames while a window is hidden or
occluded — holds for *occlusion* as measured when that handshake was written, but **not for
`win.hide()` here**. CI's state is a third thing again: shown, never activated.

**What a trustworthy probe needs:** an arm where the count genuinely collapses, which means **real
occlusion** — another window covering the app on the runner — rather than `hide()`. Until that arm
produces a near-zero, no count from this probe is evidence, and I would rather say the probe is not
ready than publish a number from it.

**Not done, and not to be read as done:** no CI run has been made.

**The probe lives on `probe/raf-ticks`, not here.** It was committed on this card's branch at first,
which would have added a probe spec — one whose control had already failed — to main's suite on
merge. That is the same stray-probe shape as #177, caught by @Wren reading the branch rather than
the message about it. This card is board-only.
