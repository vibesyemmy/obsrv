---
title: "The e2e suite brings the app to the front on every launch, and takes the desk from whoever is using it"
column: next
owner: "Henry"
kind: bug
order: 0
---

FILED 2026-09-16 by Wren, **top priority on Opeyemi's word**, assigned to Henry. Reported by
Opeyemi: while the e2e suite runs, the app keeps coming to the front and interrupts whatever he is
working on. The suite is run many times a day on the machine people are using, so every run costs
someone's attention for its whole length.

## What is known — read from the code on `main`, not yet reproduced

- **`src/main/window.ts:30`**: `win.once('ready-to-show', () => win.show())`. On macOS `show()`
  activates the app, and almost every spec launches a fresh one. **The likeliest cause**, because
  it runs on every launch.
- **`src/main/index.ts:187-188`**: `win.show(); win.focus()`, but only in the `second-instance`
  handler, so only in the single-instance specs.
- **`src/main/ipc.ts:1983-1988`**: the `focusWindow` control command calls
  `app.focus({ steal: true })`, and `tests/e2e/live-drive.spec.ts:349` exercises it on purpose.
  One test that *must* front the window is a different problem from every launch doing it.

## The constraint, which is why this is not a one-line fix

The suite depends on how macOS treats a window it can see:

- **Visibility follows occlusion.** `tests/e2e/helpers/deskState.ts` notes that Electron derives a
  window's `hide`/`show` from its occlusion state on macOS, and `visibility.spec.ts` tests it. A
  window kept behind other apps may count as occluded, and those tests may change meaning.
- **Occluded windows captured stale frames before.** A previous pass found that captures of an
  occluded window were stale, because the renderer draws on `requestAnimationFrame`; the fix was
  a `drawNow` handshake. The offscreen target already runs with `backgroundThrottling: false`
  (`targetSource.ts:315`), which is encouraging, but the app window's own renderer is a separate
  question.

**So the trap is a fix that stops the stealing and quietly weakens the capture and visibility
tests.** A green suite after the change fits "nothing broke" and "the tests that could break no
longer look" equally well.

## Leads — hypotheses, not findings

- Under `OBSRV_TEST`, `showInactive()` instead of `show()`, so the window appears without
  activating the app.
- Under `OBSRV_TEST`, `app.setActivationPolicy('accessory')` (or `app.dock.hide()`), so the app
  never becomes the active app at all.
- Keep `focusWindow`'s test, but make the stealing opt-in, so a default run never fronts.

## Done means

1. **A full e2e run while someone works in another app never brings Obsrv to the front**, except
   for anything explicitly opt-in and named. Observed on a desk, not inferred from the code.
2. **The capture and visibility specs still see what they claim to**, shown by control rather
   than by a green run: with the app behind other windows, a capture test must still get a fresh
   frame, and a planted stale frame must still go red.
3. If some test genuinely needs the foreground, it says so in its name and is excluded from the
   default run.
