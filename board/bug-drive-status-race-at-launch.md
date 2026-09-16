---
title: "At launch, `obsrv_drive`'s status contradicts its own field description"
column: done
owner: "Henry"
kind: bug
order: 43
---

FOUND BY ROOK in run 19, 2026-09-16 — the first call of the run. Mechanism supplied by Henry.

## RESOLVED 2026-09-16 by Henry: two halves, each shown necessary by its own control

**Re-observed on main first, as the surface note below asked.** A new spec
(`tests/e2e/status-at-launch.spec.ts`) seeds `tabs.json`, launches with agent control, and reads
`status` as fast as the app answers from its first reply. Every reply must carry the size of the
preset that same reply names. On main it passed 6/6 with one tab and with three tabs, about 55k
replies each, every one `pixel-8/portrait 412x915`. **The race is real on main but did not show on
this desk.** A build whose renderer delayed its viewport went red with Rook's exact pairing, which
proved the instrument could see it.

**The mechanism, measured with a probe logging every `setViewport` main received:** the renderer
sends two viewports at launch, its own store's default `1920x1080` and then the restored tab's
`412x915` 16 ms later. The restored tab's surface is born at the default size. Until the second
viewport lands, `status` pairs the restored `presetId` with the default surface.

**The first fix failed its own control.** Control commands waited until main applied the *first*
viewport since startup. The spec's third variant uses a test-only knob,
`OBSRV_TEST_FIRST_VIEWPORT_DELAY_MS`, read only under `OBSRV_TEST`, to hold that viewport back and
make the window wide on purpose. It still went red 2/2. The probe showed why: the wait released on
the default viewport at +1514 ms, 28 ms before the restored one was applied. That fix passed
typecheck and `live-drive` 45/45, and read correctly.

**The fix, in two halves:**
- **The renderer holds its viewport until main's tab list has arrived** (`App.tsx`), exactly as its
  mirror report already did, for the same reason: before then the store describes a screen nobody
  chose. The first viewport at launch is now the restored one.
- **Every control command waits, bounded at 5 s and once per app lifetime, until main has applied
  that first viewport** (`ControlServer.route` → `launchSettled`, `ipc.ts`). On expiry the reply is
  what it was before.

| build | held variant | other variants and specs |
| --- | --- | --- |
| both halves | **green 2/2**, only `412x915` | green 4/4; `orientation`, `tabs`, `text-scale`, `live-drive` 95/95 |
| main's wait removed | **red 2/2**, Rook's pairing | — |
| renderer hold removed | **red 2/2**, Rook's pairing | — |

**Not covered, stated so it is not read into the fix:**
- The wait is for the *launch*. An agent's own `setPreset` already makes captures and scrolls wait
  (`viewportPending`). A preset changed by hand, or a new tab, has no wait for `status` at all, and
  is untested here.
- The published 0.60.0 keeps the race until a release carries this.
- `docs/breaking-changes.md` names the new launch latency under *not breaking*: timing only, no
  field changes.

**Unowned** until 2026-09-16, when Henry claimed it (#58).

**Surface observed**, added 2026-09-16 by Henry on Rook's own catch: the `obsrv` MCP tools in this
repo run the package pinned in `.mcp.json`, `getobsrv@0.60.0` (tag `v0.60.0`, `31b77e8`), not `main`
or a local build. **So this was observed on the 0.60.0 release.** **Expected to hold on `main`, by
diff and not by observation:** between `v0.60.0` and `main` at `3552349`, no changed line in
`src/main/ipc.ts`, `src/mcp/server.ts`, `src/main/controlServer.ts` or `src/shared/control.ts`
matches `getViewport`, `cssWidth` or `screenShape`. The diff over those files is not empty, the
pattern matches `main`'s source, and the same method finds #49's routing change, so the result is
not a blind search. It is still a reading, not an observation: behaviour can change through lines
that do not use these words. **Re-observe on a local build before fixing.**

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
