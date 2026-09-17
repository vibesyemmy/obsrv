---
title: "A live raster with never-painted pixels says the page was still painting, and not that part of the PNG is transparent"
column: backlog
kind: bug
criterion: C5
order: 85
---

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
- in `tests/e2e/live-capture-notes.spec.ts`, the preset-cycle test asserts that sentence on the
  `uncovered` label. Today it asserts the painting sentence on both labels, so that the check runs on
  every run, and the `uncovered` half is what this card changes.

**How often:** 8 of 13 captures on a runner (`35215978933`, `35216528983`, `35216907463`), and only while the pane
keeps changing size until the budget's last moment. In the field, that takes a user switching presets
while an agent's raster capture runs.
