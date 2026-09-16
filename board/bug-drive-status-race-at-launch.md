---
title: "At launch, `obsrv_drive`'s status contradicts its own field description"
column: next
kind: bug
order: 43
---

FOUND BY ROOK in run 19, 2026-09-16 — the first call of the run. Mechanism supplied by Henry.
**Unowned.**

## The defect

`obsrv_drive` with no arguments, on the call that also launched the app, answered:

    presetId: "pixel-8"    orientation: "portrait"
    cssWidth: 1920   cssHeight: 1080   screenShape: "landscape"
    loading: false

`pixel-8` is 412×915 (`obsrv_presets`). **`driveOutputShape` promises `cssWidth` is "the CSS
viewport the target is rendering at, already rotated".** At launch it is not — so this is a
defect against the tool's own stated contract rather than a confusing pair of fields.

`presetId` comes from the restored store; `cssWidth` comes from the offscreen surface
(`src/main/ipc.ts:1493-1499`). At launch those are two different moments, and the reply presents
them as one. `loading: false` asserts nothing is pending.

**Both halves are internally consistent** — `orientation` follows the preset, `screenShape`
follows the dimensions — which is exactly why the reply reads as settled rather than as a page
still catching up.

## Why it is worth more than a stale number

`obsrv_drive`'s `click` takes "CSS-viewport px of the page (the valid range is 0 up to but not
including the viewport size)". **An agent that reads the viewport size from the status it just
received uses 1920×1080**, and every click past x=412 is off the screen. The tool's own reply is
what misleads it.

## One observation, unreproduced, and why

Reproducing it means quitting Obsrv and relaunching, which closes the window the user is working
in — the user's call, not an agent's. **For whoever takes it:** quit the app, leave a phone
preset selected on the active tab, call `obsrv_drive` with no arguments, read the first status.

Every later call in run 19 was correct: `laptop-768` → 1366×768, `pixel-8` → 412×915,
`ultrawide-34` → 3440×1440. Henry's discriminator — an empty `drive` call once the app is up —
returned 1366×768, which is what settles it as a launch-time race rather than a wrong source.

## The first account of this was wrong, and that belongs on the card

Rook first reported that `drive` was describing the native pane or the window under unqualified
field names. The next two calls refuted it. **Had it been filed at the first reply, the card
would have carried a coherent, specific, wrong mechanism** — on a run whose subject is whether a
reply lets a reader form a correct picture. It is the same reply doing the same thing to the
person reading it.
