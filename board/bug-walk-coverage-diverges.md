---
title: "The two walks cover a growing page differently — 3 screenfuls against 8"
column: next
kind: bug
criterion: C4
owner: "obsrv-e7"
order: 31
---

Measured 2026-09-14 (obsrv-a6), same file, same session, both surfaces:

  headless  3 screenfuls, atEnd true, page measures 4712, covered 3072 → coverage note FIRES
  live      8 screenfuls, atEnd true, page measures 6832, covered 6912 → no gap, SILENT

Same URL: a warning on one surface, nothing on the other, and the two measurements are of different amounts of page. Each answer is internally consistent, which is what makes it hard to notice.

FIXTURE NOW IN THE REPO: tests/fixtures/app-shell-grows.html (merged 586caab) — an app shell whose inner feed extends twice as it is walked. No existing fixture had that shape; every other app-shell fixture walks further than the page measures, so none can make walkCoverageNote fire on an element scroller.

Handed to obsrv-e7 to run through the C4 parity harness, which catches exactly this asymmetry (a note-bearing array present on one surface and empty on the other) and is how the panel silence and the inspect gap both surfaced. obsrv-e7's read: if live really never fires the coverage note on an app shell, it is a seventh defect rather than a footnote to the sixth.

Cause still open: the `hidden` divergence, the two walks scrolling differently, or the growth being timing-dependent. obsrv-a6's one-off comparison could not separate them.
