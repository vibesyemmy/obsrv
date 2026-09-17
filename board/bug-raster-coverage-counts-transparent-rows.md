---
title: "A raster capture can call a frame fully painted while a band of it is transparent, and say nothing"
column: backlog
kind: bug
criterion: C5
order: 96
---

FOUND 2026-09-17 by Kenya's own assertion, and hidden by the suite's retry. **Kenya's lead** on
`bug-live-raster-uncovered-said-as-painting` said the unpainted band under a preset cycle is exactly
the rows the frame grew by. Her `NOT A FLAKY BASELINE` assertion in `live-capture-notes.spec.ts` was
written to catch the mask and the bytes disagreeing. **It did, on `main` code, and the run still
concluded `success`**, because `playwright.config.ts:29` sets `retries: 1` for the whole suite. Found
by Henry reading every run he merged on for `✘`, after Wren pointed out what a green conclusion does
and does not claim.

## Two sightings, on two heads, one with none of `#314` in it

| run | head | reply | PNG | the band vs the growth |
| --- | --- | --- | --- | --- |
| `35238786585` | `docs/release-gate` (#313, no `#314` code) | `timeout`, covered | **158,720 transparent, `1280x124 at 0,900`** | 1024 − 900 = **124** |
| `35242350343` | `#314` at `b43e7fc` | `resizing`, covered | **40,960 transparent, `1280x32 at 0,768`** | 800 − 768 = **32** |

In both, **the coverage mask said every pixel had painted** — `timeout` and `resizing` are only reached
with `covered` true (on `main`, the deadline branch at `cli/capture.ts:324` answers `timeout` only
inside `if (covered)`; on `#314`'s branch, `resizing` is guarded the same way) — and the
PNG has a transparent band exactly the size of the growth. The first sighting fired Kenya's assertion
directly: *"this capture's coverage mask said every pixel was painted, and its PNG has transparent
ones, so the mask and the bytes disagree"*. Its retry reached `uncovered` cleanly, and the run went green.

**So it is on `main`, not something `#314` introduced.** What `#314` may have changed is how often the
arm samples it (its gate makes a capture run to its budget more often); that is a reading, and nothing
here depends on it.

## Why it is a defect and not a test's problem

The reply says the page was still painting, or still resizing, about a PNG that is **12.1% transparent
pixels** — which the same capture path elsewhere calls *"never painted … those pixels are transparent,
not page content"*. A caller reading the reply has no way to know a band of the image is not the page.
That is class 1 under `release-gate.md`: a wrong answer nothing in the reply discloses. And every
`uncovered` percentage is computed from the same mask, so it can undercount by the same band.

## The mechanism — reasoned, NOT measured

`captureQuiescent` fills its coverage mask from the **rectangles** paints arrive with, not from what the
bytes in them are. The candidate: during a grow, Chromium delivers a paint whose rectangle spans the new
size while the newly exposed rows have not been composited, so the rectangle marks them painted and
their bytes are transparent. Two sightings fit it; neither proves it. **This is a code reading and
should be quoted as one** until a probe logs the rectangle and the alpha of the rows it claims.

## Candidate fix, for whoever picks this up

Make the answer true of the bytes **by construction**: before answering, count the fully transparent
pixels in the buffer, and if there are any, the verdict is `uncovered` with the share and region taken
from the bytes rather than the mask. That puts Kenya's baseline invariant in the product instead of in
one test. **Measure first** that an offscreen target never paints alpha-0 as page content — it composites
onto an opaque background, but that is also a reading — or the check will call a legitimately
transparent page unpainted.

**Headless too, probably:** the mask is `captureQuiescent`'s, which the CLI shares. Unmeasured there.

## Acceptance, each with a control

- a probe that logs, for a paint during a grow, the rectangle and the alpha of the rows it covers —
  confirming or killing the mechanism above, written down either way;
- a capture never answers `timeout`, `resizing` or `settled: true` about a PNG with fully transparent
  pixels, pinned by construction in `cliCapture.test.ts` (a fake paint whose rectangle covers rows whose
  bytes are alpha 0). **Control:** reverting the fix reds it;
- Kenya's `NOT A FLAKY BASELINE` assertion stays exactly as it is, and stops firing.

## And the reading rule this came with

A green run in this repo was never a claim that nothing failed, only that nothing failed twice. The
first sighting was in a run that concluded `success` and was merged on. Read the `✘` lines before any
merge.
