---
title: "A live raster taken while the preset changes can come back settled, with no warning"
column: backlog
kind: bug
criterion: C5
order: 86
---

FOUND BY HENRY 2026-09-17, in a control run for row 9 of `chore-live-app-race-sentences`
(`35218471058`, repeat 1). Wren predicted the shape before the run: a pause in the cycle could let
the capture settle.

**What was seen.** A `captureRaster` taken while the pane was cycled through eight presets, pausing
700 ms after each apply, came back after 3.8 s:

> `settled: true`, no `unsettledReason`, 1440x900, `warnings: []`

The cycle had applied 6 presets by the time it was stopped, and kept changing the size about every
0.75 s the whole time.

**Why it is a defect and not a quiet page.** The page is `animated.html`, which paints on every frame.
`captureQuiescent` calls a frame settled after 400 ms with no paint, and a preset change recreates
the offscreen target and reloads the page. The likeliest reading is that the reload's silence passed
for quiet, and the capture returned whatever frame it held at that point. That is **not measured**,
and it is the first thing for this card to measure. The window capture (`captureTarget`) has a resize
verdict for exactly this (`settleTarget` → `resizing`). The raster path has none, so a reply can say
`settled: true` about a pane that never stopped changing size, and nothing tells the reader the PNG
may be of the previous size.

**How often:** 1 in 28 paused-cycle captures across `35217795705` and `35218471058`, and 0 in 13
back-to-back captures. So far it has been seen only under a test's preset cycle. In the field, that
takes a user switching presets while an agent's raster capture runs.

**Acceptance, each with a control:**
- measure first: record the frames `captureQuiescent` sees around a preset change during a raster
  capture (size, time since the last paint, the reload's gap), and state which frame came back;
- a raster capture across a size change does not come back `settled: true` without saying so;
- `live-capture-notes.spec.ts` stops treating a settled capture as a stray to retry, and asserts it
  cannot happen.
