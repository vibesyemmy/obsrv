---
title: "Run the suite on a host unlike this laptop, more than once a release"
column: next
kind: chore
criterion: B5
---

obsrv-e7's proposal, 2026-09-14, and the evidence points both ways at once:
  • the Retina trio (fit-cap:43, onion-skin:96, onion-skin:116) FAILS on this laptop and PASSES on CI — documented since 2026-09-12
  • the `moves` pageHeight comparison PASSED on this laptop on every run and FAILED on CI

One host cannot tell you which of those you are looking at. Today the slow machine found a real bug before a human did, and the only reason it was a discussion rather than a shipped defect is that CI ran before the next merge.

B5 established the tool does not drift run to run ON THIS MACHINE, with a control that made the zero mean something. This is the same question across hosts, and nobody has asked it: the fixture sweep run somewhere unlike this laptop, compared against the numbers already published in docs/research/2026-09-14-b5-repeatability.md. If they differ, B5's number is about this machine rather than about the tool.

Cheapest version is probably a CI workflow that runs the fixture half of the B5 sweep on a schedule rather than a full second suite.
