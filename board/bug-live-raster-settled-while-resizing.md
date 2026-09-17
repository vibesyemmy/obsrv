---
title: "A live raster taken while the preset changes can come back settled, with no warning"
column: doing
owner: "Henry"
waiting: ""
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


## THE MECHANISM 2026-09-17 by Henry: it is a poll landing in the silence between two sizes

**Claimed, and the first acceptance item is done.** Probe `35238313231` — the paused cycle with the
settle window cut to 120 ms, six captures — recorded every frame `captureQuiescent` saw. The card
asked for that measurement on both cycle shapes; this is the paused one, and the mechanism it found
does not depend on the shape, which is why the back-to-back sighting fits it too.

**What the frames say.** A **straddle** is a frame arriving at a new size while `covered` is still
true from the previous one — the probe prints it with the *old* size's area in `uncoveredPx`. There
were **16 straddles across 6 captures**. Four had a quiet gap before them at or past the settle
window: **124, 138, 140 and 143 ms**.

**The code, read after the frames rather than before them:**

| line | what it does |
| --- | --- |
| `cli/capture.ts:238` | clears `covered` when a frame at a new size **arrives** |
| `cli/capture.ts:285` | settles on `covered && now - lastPaint >= settleMs` |
| `cli/capture.ts:356` | polls that test every `min(50, settleMs)` ms |

Between the last frame of the old size and the first of the new one, **`covered` and `lastPaint` both
still belong to the old size**. A poll landing in that gap, past the settle window, breaks out
`settled: true` and returns the old size's `buffer`, `width` and `height` — with no warning, because
nothing was wrong as far as the frames go. `main/ipc.ts:1782` calls this same function, which is why
it is the live raster that was seen.

**Why the probe saw none of it.** The hit window is `gap - settleMs` against a 50 ms poll, so the four
qualifying straddles were 8%, 36%, 40% and 46%: **1.3 sightings expected, 0 seen** (P(zero) ~ 19%).
The run was too small, not the reading wrong. **So the lottery is over:** `captureQuiescent` takes a
`FrameEmitter`, and a fake can script the gap exactly. `tests/unit/cliCapture.test.ts` does, in
163 ms, with no Electron.

**The fix, and why it cannot live in the capture alone.** The capture cannot tell a page that has
gone quiet from a surface that was asked for a new size and has not painted it: both are silence
after a covered frame. Only the source knows it was asked. So `FrameEmitter` gains an optional
`expectedFrameSize()`, `TargetSource` answers it with the steady-state `paintedExtent`, and a caller
opting in with `awaitExpectedSize` will not settle until the frame is that size. `captureRaster`
opts in; the CLI does not, so `resizing` stays live-only and `docs/public-shape.json` is unchanged.

**A hole in the first version, found by Wren and confirmed by control.** Gating only the settle test
leaves `covered` true from the old size, and the steady-painting exit reads it too: a page painting
on at the size the pane had left came back **`animating`** with that buffer — the same wrong answer
wearing a different label. Both exits are gated now. Control: removing the animating gate reds that
test at `expected 'animating' to be 'resizing'`.

**Controls (unit, local):** removing `atExpectedSize()` from the settle test reds two tests at their
own assertions — `expected [128,102] to deeply equal [144,90]` and `expected true to be false` —
while the two arms that pin *unchanged* behaviour stay green.

### The third acceptance item was wrong, and is replaced rather than dropped

It read: *"`live-capture-notes.spec.ts` stops treating a settled capture as a stray to retry, and
asserts it cannot happen."* **It cannot happen is false.** With `STEP_PAUSE_MS = 700` and a 400 ms
settle window, a pane that reaches the newest preset's size and goes quiet settles **correctly** —
`settled: true` there is the capture working, not the defect. The defect was always settling at the
size the pane had *left*, and the e2e cannot see which size was current at the moment the reply was
built without racing the cycle it is measuring.

**What replaces it, and what it is worth.** The e2e gains the arm the fix actually needs: a still page
must still come back `settled: true` at the size the pane is on. If `expectedFrameSize()` ever
disagreed with the frames for an ordinary capture — a fractional density floors the paint and ceils
the bitmap, which is exactly where a size comparison goes wrong — **every** live raster would run to
its budget and answer `resizing`, and nothing else in that file would notice, because its other pages
never settle on purpose. The wrong-size answer itself stays pinned where it can be pinned by
construction, in the unit tests.

### Which preset can actually catch a wrong `expectedFrameSize`, counted

Wren's cold read of `#314` found the still-page arm capturing on whatever preset the pane was already
on, and proposed `laptop-1080-125`, `laptop-1080-150` or `4k-27-150` as fractional-density covers.
**All three would have stayed green.** What breaks a size comparison is not a fractional
`deviceScaleFactor` but a fractional **product**, and those three are 1536x1.25, 1280x1.5 and
2560x1.5 — 1920x1080, 1920x1080 and 3840x2160, every one whole.

Counted over the whole table: **26 presets, and exactly one** where the floor and the round of the
product differ — `pixel-8`, 412 x 915 at 2.625, which is 1081.5 x 2401.875 and paints 1081 x 2401.
The arm uses that one and pins those numbers, so a disagreement between `paintedExtent`, the
`pixel-8` comment and the surface is a red test rather than a stale comment.

### Where `resizing` can and cannot arrive, so the next caller need not re-derive it

`resizing` reaching a schema that does not list it is the `0.61.0` failure shape, so Wren checked the
three: the live snap enum (`mcp/server.ts:439`) carries it, drive's field is a free `z.string()`
(`:832`), and **the report's enum (`:2174`) does not**. The report is headless and
`awaitExpectedSize` defaults to false, so nothing on that path can produce it today. **That is a
constraint, not a coincidence:** wiring the gate into a headless caller means adding `resizing` to
the report's enum in the same change, and `docs/public-shape.json` with it.

## FAIL 2026-09-17 by Idris on `b43e7fc`, and what it cost the fix

**Acceptance item 2 was not met by the first fix**, and the gap was **run, not read**: seven of the 26
presets share a device extent with another at a different density — 1920x1080 is `1080p-24`,
`1080p-27` and `laptop-1080-15` at 1x, `laptop-1080-125` (1536x864) and `laptop-1080-150` (1280x720);
3840x2160 is `4k-27` and `4k-27-150`. A switch between two of those recreates the window and reloads
the page **at the same extent**. The frame size never changes, so `covered` never resets and the
extent gate answers yes at once. Idris's run through the real `captureQuiescent`, with a source using
`TargetSource`'s own formula:

| switch | answer |
| --- | --- |
| 48x27@1 → 40x25@1 (different extent) | settled, **new** layout, 562 ms |
| 48x27@1 → 32x18@1.5 (same extent) | settled, **pre-change** layout, no warning, 151 ms |

**The PNG carries the dimensions that were asked for, so the caller cannot tell.** That is class 1
under `release-gate.md`, and it is the card's own title — a live raster taken while the preset changes
coming back settled, with no warning. Not a regression: `main` does the same today.

### The fix: coverage is earned under a layout epoch, not a size

`TargetSource` counts accepted layout changes (`layoutEpoch()`), bumped once per change that actually
moves the layout — CSS viewport, density or phone-ness — and **not** on a no-op `setViewport`, which
would make a capture in flight wait for a repaint an idle page has no reason to produce. The capture
records which epoch its pixels belong to, starts coverage again when that changes, and will not settle
under an epoch older than the source's.

**A size cannot see this and a request can**, which is the same shape as the original defect one level
up: the capture cannot distinguish a page that has gone quiet from a surface that was asked for
something and has not painted it. Both answers come from the side that did the asking.

**Two smaller things the finding forced:**

- **The paint handler drops frames from a window this source has replaced** (`targetSource.ts:368`).
  `recreate()` swaps `this.win` before destroying the old one, so a paint already queued from the old
  webContents could still arrive — carrying the layout just left, at the same extent, and it would
  have re-earned coverage under the new epoch. Dropping it is what makes the epoch mean what it says.
- **The budget sentence needed a second wording.** *"not the 1920x1080 it was asked for"* is absurd
  about a 1920x1080 frame. At a shared extent the capture now says the frame is from before the
  change and that **its dimensions do not show it**, which is the fact Idris's finding turns on.

**Controls, both halves load-bearing:**

| removed | red |
| --- | --- |
| the epoch half of the settle gate | 3 tests, at `expected 7 to be 9`, `expected true to be false`, `expected 'blank' to be 'uncovered'` |
| the coverage reset on an epoch change | 2 tests, one of them by running the full budget — `expected 'resizing' to be 'uncovered'` |

### What is still not covered, named rather than implied

- **No e2e reaches a same-extent switch during a capture.** Neither preset cycle contains two presets
  that share an extent, and the control server would have to interleave a `setPreset` with a capture
  in flight to drive it. The unit tests pin the capture's half by construction; `TargetSource`'s half
  (the bump and the stale-window drop) is read, not run.
- **The field case remains unmeasured:** whether a recreate leaves a settle window of silence while a
  capture is in flight. The fix makes the question moot rather than answering it, which is the right
  order for a class 1 — but it is not an answer, and this card does not claim one.
- **Text scale during a capture is the same shape and is NOT fixed here** (Idris, read not run): it
  changes the layout at the same extent through the same window, and `setTextScale` does not bump the
  epoch. It gets its own card rather than a quiet inclusion, because bumping there has a race of its
  own — `applyEmulation` reaches the renderer asynchronously, so a forced repaint can still paint the
  old layout. Orientation goes through `setViewport` and is covered by the epoch.
