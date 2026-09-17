---
title: "The raster's resizing sentence has now fired on CI, and nothing asserts it"
column: backlog
kind: chore
criterion: C5
order: 97
---

FOUND BY KENYA 2026-09-17, reading #325's own CI run for retry-hidden failures.

**The sentence**, from `src/cli/capture.ts` through `src/main/rasterWarnings.ts`:

> the target was still resizing when the capture budget ran out; this frame is 720x1600, not the
> 1640x2360 it was asked for

**It fired on run `35262788372`** (PR #325, `live-capture-notes.spec.ts:231`, try 1 of the paused
preset cycle, `applied=15`, `capture=10376ms`). **Nothing asserts it:** `git grep` finds the wording in
`capture.ts` and `ipc.ts` and in no test. So it is an unfired sentence in the c5 sense — except that it
has now been seen to fire, once, by accident, in a test that treated it as a defect.

**Why that matters here rather than in the inventory alone.** The sentence is the product's answer to
`bug-live-raster-settled-while-resizing`, which was closed today. The fix's own value is that a capture
of the wrong size says so; a sentence with no test is one rewording away from silence, and this card is
about the same shape as `bug-live-raster-uncovered-said-as-painting`.

**The lever exists and is known.** A preset cycle that steps to a much larger preset (`ipad-109`,
1640x2360) and issues `captureRaster` across the step. The paused cycle in `live-capture-notes.spec.ts`
reached it once in 8 tries; the back-to-back cycle reaches `uncovered` about half the time and
`resizing` sometimes. **Rate unmeasured**, which is the first thing a test for it has to establish —
see the loop bound and its measured rates on `bug-live-raster-uncovered-said-as-painting`.

**Acceptance, each with a control:**
- a test reaches `resizing` on purpose and asserts the whole sentence, including both sizes;
- the sizes in the sentence are the frame's own and the one asked for, checked against the reply's
  `width`/`height` rather than pinned as constants;
- **control:** rewording the producer reds it;
- if no bounded lever reaches it at a workable rate, that is a finding for the card, and the unit path
  (`cliCapture.test.ts`, which pins the reason by construction) owns the wording instead.
