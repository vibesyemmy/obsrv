---
title: "A live raster taken while the preset changes can come back settled, with no warning"
column: next
kind: bug
criterion: C5
order: 86
---

FOUND BY HENRY 2026-09-17, in a control run for row 9 of `chore-live-app-race-sentences`
(`35218471058`, repeat 1). ~~Wren predicted the shape before the run: a pause in the cycle could let
the capture settle.~~ **Struck at Wren's request, 2026-09-17:** a back-to-back cycle with no pause
settled too. See the second sighting below.

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

**How often:** 1 in 28 paused-cycle captures across `35217795705` and `35218471058`, and ~~0 in 13~~
**1 in 29** back-to-back captures (the 13, plus the 16 of `35229152084`). So far it has been seen
only under a test's preset cycle. In the field, that takes a user switching presets while an agent's
raster capture runs.

**Acceptance, each with a control:**
- measure first: record the frames `captureQuiescent` sees around a preset change during a raster
  capture (size, time since the last paint, the reload's gap), and state which frame came back;
- a raster capture across a size change does not come back `settled: true` without saying so;
- `live-capture-notes.spec.ts` stops treating a settled capture as a stray to retry, and asserts it
  cannot happen.

## SECOND SIGHTING 2026-09-17, and it kills this card's explanation — Henry, from Kenya's probe

**Run `35229152084`, the all-eight-presets arm, cycled BACK TO BACK with no pause.** One capture came
back `settled: true`, no `unsettledReason`, `warnings: []` — the same answer as the first sighting,
from the opposite cycle shape.

**What that costs the card.** The reading above says the 700 ms pause is what let the reload's
silence pass for quiet. Wren predicted that shape before the run and I wrote it down as the likeliest
reading; **it does not survive a sighting with no pause in it.** Whatever makes a capture of a pane
that never stopped resizing come back settled does not need a gap between applies.

**What both sightings share**, and all they share: a preset cycle, a page that paints continuously,
and a raster capture that answered `settled: true` with nothing in `warnings`. A preset change
recreates the offscreen target and reloads the page, so a quiet window around the reload is still the
candidate worth measuring first — but it is now a candidate, not the explanation, and the pause is
not part of it.

**Moved to Next.** Two sightings, two cycle shapes, and the answer is a silent wrong one: `settled:
true` says the capture waited for the page to stop, about a pane that was changing size throughout.
A rate is no longer the open question; the mechanism is.

**The capture itself, for whoever measures it** (Kenya, from the probe's log): try 2 of 8, 1920x1080,
158 applies, and the reply came back after 10689 ms. The other seven tries in that arm took
11.5–12.3 s and came back `timeout` or `uncovered`. The dsf-1-only arm in the same run, 8 captures,
did not settle once.

**The measurement this card now asks for, unchanged in shape but wider:** record what
`captureQuiescent` sees around a preset change during a raster capture — frame sizes, the gap since
the last paint, when coverage resets — on **both** cycle shapes, since the two now have to be
explained together.

**One guess corrected in passing** (Kenya's probe, same run): the slow applies are the ones that
change `deviceScaleFactor` — about 150 ms against about 30 ms for a same-dsf apply — and `ipad-109`
is in the fast group. "Mobile presets are slow" was wrong; "a dsf change is slow" is what the numbers
say. It belongs wherever a cycle's timing is reasoned about, this card included.

