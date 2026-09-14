---
title: "Run the suite on a host unlike this laptop, more than once a release"
column: next
kind: chore
criterion: B5
---

obsrv-e7's proposal, 2026-09-14, and the evidence points both ways at once:
  • the Retina trio (fit-cap:43, onion-skin:96, onion-skin:116) failed on this laptop and passed on CI — documented since 2026-09-12
  • the `moves` pageHeight comparison PASSED on this laptop on every run and FAILED on CI

One host cannot tell you which of those you are looking at. Today the slow machine found a real bug before a human did, and the only reason it was a discussion rather than a shipped defect is that CI ran before the next merge.

B5 established the tool does not drift run to run ON THIS MACHINE, with a control that made the zero mean something. This is the same question across hosts, and nobody has asked it: the fixture sweep run somewhere unlike this laptop, compared against the numbers already published in docs/research/2026-09-14-b5-repeatability.md. If they differ, B5's number is about this machine rather than about the tool.

Cheapest version is probably a CI workflow that runs the fixture half of the B5 sweep on a schedule rather than a full second suite.

---

CORRECTED AND SHARPENED 2026-09-14 evening, and the correction is the reason this card is worth more than it looks.

**"Fails on this laptop" was the wrong axis.** Kenya measured it: the Retina trio PASSES on this machine whenever an external 1x monitor is attached, and the 2026-09-12 reds happened when the built-in Liquid Retina XDR was alone. Verified here — `system_profiler` reported the main display as a 3440x1440 ultrawide at 1x while the three were green. They track WHAT IS PLUGGED IN, not which machine it is. `fix/retina-desk-skip` (merged 98d3f82) now skips them where the capture is scaled, measured by probe rather than inferred from a host list.

**Which changes what this card has to ask for.** "Run it on a second host" is not sufficient if a result can turn on a monitor being plugged in. Two hosts that differ only in hardware still tell you nothing if nobody recorded the display state of either. So the sweep must capture the DESK, not just the host: `captureScale` (tests/e2e/helpers/captureScale.ts) already measures the ratio that matters, and it exists because of this.

CI is the useful second desk precisely because its display never moves — that is what made the 09-12 comparison legible at all, and it is also why CI alone cannot answer the question: a fixed desk is one sample, not a range.

**What would make B5 a claim about the tool rather than about this machine:** the fixture half of the B5 sweep, run somewhere unlike this laptop, compared against the published numbers in `docs/research/2026-09-14-b5-repeatability.md`, with the desk's capture scale recorded beside every number. Fixtures first because their bytes provably do not change, so any movement is ours.

**And the honest null result is worth as much as a difference.** If the numbers match, B5 survives and says so with two desks behind it. If they differ, B5's zero is about this machine and every before-and-after measured against it inherits that. Either way the card is done when the comparison exists — not when it comes out the way anyone hoped.
