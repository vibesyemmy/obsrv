---
title: "The onion skin dies silently on a trip through a big screen, and still reads back as on"
column: next
kind: bug
order: 49
---

FOUND BY HENRY 2026-09-16, re-observing `bug-onion-skin-zero-means-three-things` on `main`. **Unowned.**

**Surface observed:** a local build of `main` at `120a94c`, through the control server. The skin
value is `status`'s `onionSkin`, main's mirror of the renderer's store. Whether a reference exists
is read in main (`session.reference`). The slider isn't read. It shows the same store value, which
is expected from reading the code, not observed.

## The defect

On one tab, sampling `status` and the reference every 50 ms for 3 s after each step:

| step | `onionSkin` | reference | viewport |
| --- | --- | --- | --- |
| `setOnionSkin 0.5` on `laptop-768` | 0 → **0.5** | false → **true** | 1366x768 |
| `setPreset ultrawide-34` | 0.5 | **false** | 3440x1440 |
| `setPreset laptop-768`, back | **0.5** | **false** | 1366x768 |

**Back on a screen that can have the skin, the value still says 50% and nothing is blended.** It
stays that way until the value is changed, because only a *change* of the renderer's value asks
main for a reference again. Setting the same 0.5 again should change nothing, since the store's
`setOnionSkin` ignores a value already in force. That is read in `store.ts`, not observed.

## Why

`TabSession.syncReference` drops the reference when a resize leaves a viewport it can't fit. Its own
comment says what follows: *"the renderer's skin then draws nothing over the target until the
viewport fits again and the skin is set anew."* Nothing tells the renderer. That breaks the rule the
renderer applies to a refusal at the moment the skin is set (`App.tsx`): a refusal turns the skin
off *"rather than leaving a menu that says 50% over a canvas showing nothing of the kind."*

## What a fix has to decide

1. **Off.** The drop tells the renderer, which sets the tab's skin to 0, as a refusal already does.
   The readback is true at every step. Coming back to a small screen needs the skin set again.
2. **Resume.** Main re-creates the reference when a resize makes the viewport fit again. The user's
   50% survives the trip. But on the big screen in between, the value says 50% over nothing, which
   is exactly what the renderer's rule refuses, unless the panel and `status` learn to say
   "set, but not drawn here".

Option 1 follows the rule the code already states, and needs a main-to-renderer message. Option 2 is
the nicer behaviour for someone flipping presets, and needs a UI for the in-between state.
**Opeyemi's call if option 2 is wanted**, since it's a visible change to the panel. Option 1 is the
engineering default.

Not affected by `bug-onion-skin-zero-means-three-things`'s fix, which changes how `setOnionSkin` is
confirmed and refused, not what a resize does to a skin already on.
