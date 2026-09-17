---
title: "A live raster with never-painted pixels says the page was still painting, and not that part of the PNG is transparent"
column: done
kind: bug
owner: "Kenya"
criterion: C5
order: 85
---

**CLAIMED BY KENYA 2026-09-17** from Backlog, queued by Henry in #453 and routed by Wren.

**Why the fix's e2e test is a bounded loop:** a single-change lever was measured and does not reach
`uncovered` (`animating` 16 of 16, since one resize gets fully painted). No deterministic lever exists
without a hook in the capture path. See "The lever, and why it is a bounded loop" below.

FOUND BY HENRY 2026-09-17 while measuring row 9 of `chore-live-app-race-sentences` on CI (run
`35215978933`, repeat 2 of 6; then seven of seven across two control runs).

**What was seen.** A `captureRaster` taken while the pane was cycled through eight presets came back
`settled: false`, `unsettledReason: 'uncovered'`, 1920x1080, with one warning:

> the page was still painting when the capture budget ran out; the PNG may show a transitional frame

**Why that sentence is wrong for that label.** `uncovered` means `captureQuiescent` reached its budget
before every pixel of the frame had been painted once (`src/cli/capture.ts`, the `!covered` branch).
The unpainted pixels are transparent BGRA, not page content. The CLI says so through `onWarn`: *"<n>% of
the <w>x<h> frame never painted within <t> ms (uncovered region …); those pixels are transparent, not
page content. Returning the frame as captured (settled: false)"*.

`captureRaster` (`src/main/ipc.ts`) passes no `onWarn`. Its ternary maps every reason that isn't
`animating` or `blank` to the painting sentence. So the reply talks about motion and leaves out the
one fact a reader of the PNG needs: a transparent region, which an agent can take for a black or empty
band of the page. The field says `uncovered` and the sentence doesn't, so this reply fits two different
facts.

**Acceptance, each with a control:**
- on `uncovered`, the raster reply carries the capture's own uncovered sentence and not the painting
  one. Share the text with the CLI rather than copying it;
- a test that reaches `uncovered` on purpose and asserts that sentence there. **The lever is a
  preset cycle with no pause between applies**, which came back `uncovered` 8 of 13 times
  (`live-capture-notes.spec.ts`'s cycle adds a 700 ms pause precisely to avoid it, 0 of 12). ~~At that
  rate the test has to loop, bounded, until an `uncovered` capture lands.~~ **Corrected by Kenya
  2026-09-17:** 8 of 13 pools three heads that did 1 of 6, 3 of 3 and 4 of 4, and a CI probe then got
  3 of 8 and 4 of 8. A bound computed from the pool fits none of them. Henry's call: a deterministic
  lever, not a loop sized off a pooled rate. See "The count, read capture by capture" below.

**How often:** 8 of 13 captures on a runner under a back-to-back cycle (`35215978933`, `35216528983`,
`35216907463`), and 0 of 12 with a 700 ms pause after each apply (`35217795705`). Only while the pane
keeps changing size until the budget's last moment. In the field, that takes a user switching presets
while an agent's raster capture runs.

## The count, read capture by capture, 2026-09-17 by Kenya

**"8 of 13" adds up, but it is not one rate.** Every `raster under a preset cycle` line in the four
runs, read from the logs rather than from the summary:

| head | run | back-to-back captures | `uncovered` |
| --- | --- | --- | --- |
| `f585345` | `35215978933` | 6 | **1** |
| `b14fbde` (control) | `35216528983` | 3 | **3** |
| `bab413a` (control 2) | `35216907463` | 4 | **4** |
| `fc1be27` (700 ms pause) | `35217795705` | 12 | 0 |

**1 of 6 on one head, 7 of 7 on the other two.** If those were one rate, a split that uneven would
turn up about 0.5% of the time. So a loop bounded on "about 60%" would be sized on a pooled number: at
1 of 6, five tries still miss 40% of the time.

**What the end states share.** The raster size names the preset the capture ended on:
- **No `uncovered` capture ended on a dsf-2 preset.** All 8 ended on `1080p-24` (6), `sxga-19` (1) or
  `laptop-900-17` (1).
- **3 of the 5 back-to-back `timeout`s ended on `android-65`** (720x1600).
- **All 12 paused captures ended on `android-65` (9) or `ipad-109` (3).**

~~**The hypothesis, which is a hypothesis:** a mobile preset takes much longer to apply than a
desktop one.~~ **Measured, and it is the deviceScaleFactor change, not the mobile preset.** Probe run
`35229152084` (branch `probe/raster-uncovered-lever`) timed every `setPreset` in a back-to-back
cycle, 8 captures per arm. The medians per try:

| apply | median per try | why |
| --- | --- | --- |
| `android-65`, after `1440x900-19` | 137–158 ms | dsf 1 → 2 |
| `1080p-24`, after `ipad-109` (all eight) | 125–154 ms | dsf 2 → 1 |
| `ipad-109`, after `android-65` | 28–29 ms | dsf 2 → 2, **a mobile preset in the fast group** |
| every dsf-1 → dsf-1 apply | 29–45 ms | no dsf change |
| `1080p-24` in the dsf-1-only arm | 28–30 ms | same preset, no dsf change |

So the cycle dwells longest at the two dsf changes, and the dwell on `android-65` is where the budget
most often ran out covered. **What the same probe says about the rate:**
- all eight presets: `uncovered` 3 of 8, `timeout` 4, and one `settled: true` (recorded on
  `bug-live-raster-settled-while-resizing`);
- dsf-1 only: `uncovered` 4 of 8, `timeout` 4.

Taking the dsf changes out did not make the cycle deterministic. The heads also differ in the
restore target and a `CONTROL` prefix in `ipc.ts`, and neither should move the rate.

**The `uncovered` half this card was to change no longer exists.** #292 moved the paused test off it
and retries a stray `uncovered` there. So the fix adds its own test.

## The lever, and why it is a bounded loop, 2026-09-17 by Kenya (#302)

**Henry's call was a deterministic lever.** His suggestion: a page that animates a small region, plus
one preset change during the capture, on the reading that Chromium repaints a resized surface in
dirty slices. Probe `35229835046` (branch `probe/raster-uncovered-single-change`), change 800 ms into
the capture, 4 tries per arm:

| arm | result |
| --- | --- |
| 16 px spinner, no change (baseline) | `animating` 4 of 4 |
| 16 px spinner, one same-dsf change (`1080p-24`) | `animating` 4 of 4 |
| 16 px spinner, one dsf change (`android-65`) | `animating` 4 of 4 |
| `animated.html`, one same-dsf change | `animating` 4 of 4 |

**`uncovered` 0 of 16.** One resize gets fully painted well inside the 2 s animating exit, so there is
no deterministic lever without a hook in the capture path.

**So the work splits:**
- **The wording is owned by a unit test that needs no race.** `tests/unit/rasterWarnings.test.ts` goes
  through the real `captureQuiescent`. Control: routing `uncovered` back to painting reds 2 of 3.
- **The e2e only shows the wiring fires once.** It uses dsf-1 presets back to back, up to 8 tries,
  with the measured rates and miss chances in its comment: 4 of 8 (`35229152084`), then 2 of 7
  (`35230323442`). **Control `35230323442`** (same head, `uncovered` routed back to painting): red on
  both repeats at the sentence assertion, after reaching `uncovered` on tries 5 and 2, not at the
  lever.

## DONE 2026-09-17 by Kenya: merged in #302 (`cf13ce2`), each acceptance item with its control

- **The raster reply carries the capture's own `uncovered` sentence, and not the painting one.**
  `src/main/rasterWarnings.ts` (no Electron import) keeps the sentence the capture sent through
  `onWarn`, by reason, and routes reasons with a `never`-defaulted switch. So the text is the CLI's,
  shared rather than copied. **Controls:** routing `uncovered` back to painting reds 2 of 3 in
  `tests/unit/rasterWarnings.test.ts`, which goes through the real `captureQuiescent`; dropping a routed
  reason gives TS2322.
- **A test reaches `uncovered` on purpose and asserts the sentence there, and that it is true of the
  PNG.** `live-capture-notes.spec.ts`: dsf-1 presets back to back, up to 8 tries, with the measured rates
  and miss chances in its comment. The reply's PNG is decoded without Electron. The stated share must
  match the fully transparent pixels, the stated region must be their exact bounding box, and every
  covered try must have none. **Control `35230323442`:** red at the sentence assertion on both
  repeats, not at the lever.
- **Read on the merged head's suite (`35231915393`):** `uncovered` on try 1. The sentence said
  *"12.1% of the 1280x1024 frame never painted … (uncovered region 1280x124 at 0,900)"*. The PNG had
  158,720 transparent pixels, 12.11%, spanning exactly `1280x124 at 0,900`.

**A lead, not a finding, for whoever next reasons about `uncovered`:** in that reading, the unpainted
band is exactly the 124 rows the frame grew by (1024 − 900) when the cycle stepped from `laptop-900-17`
to `sxga-19`. One earlier probe reading fits the same shape: 30.6% of 1920x1080 is the area 1080p adds
over 1600x900. So `uncovered` under this lever may be the newly exposed region not yet painted, not a
random slice. That rests on two readings.

**Probe branches deleted 2026-09-17:** `probe/raster-uncovered-lever`,
`probe/raster-uncovered-single-change`, `probe/raster-uncovered-control`. Their runs keep the logs.

