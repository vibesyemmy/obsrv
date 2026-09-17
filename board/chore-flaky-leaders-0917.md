---
title: "Four flaky tests with no card, each 3 of 43 first attempts on main since #82"
column: doing
kind: chore
owner: "Kenya"
waiting: ""
criterion: B5
order: 72
---

**PULLED FROM BACKLOG AND CLAIMED BY KENYA 2026-09-17** on Wren's routing. Logs only; anything
needing a repro goes to CI unless the spec is desk-safe and carries no recorded activation, checked
per spec rather than per file.

FOUND BY HENRY 2026-09-17, in the remeasurement on `bug-ci-main-red-37pct`. Each failed its first try
and passed its retry in 3 of main's 43 suite runs since #82. **Nothing here is a cause yet:** read each
run's first failure line before naming one, and check the test does its own setup before calling a
both-tries failure deterministic (tonight's `panes:83` and `sync:139` were both test defects).

| test | runs (attempt 1) |
| --- | --- |
| `tabs.spec.ts:266` "entering an image-mode tab stops delivery, so target frames cannot overwrite the drawing" | 35125554296 (ab39983), 35130836287 (57e999d), 35177333642 (9e9cdab) |
| `panes.spec.ts:259` "a failed load is drawn as an empty state, not a card on top of one" | 35136256249 (b21d1da), 35148542055 (a6af19e), 35174341331 (6f7dec1) |
| `panes.spec.ts:230` "a failed load says so in the window, across both panes, and clears when one commits" | 35148542055 (a6af19e), 35160475615 (d6e808a), 35170701394 (74f15c5) |
| `target-source.spec.ts:106` "emits a partial dirty rect when a small element changes" | 35159915364 (093d1c3), 35160475615 (d6e808a), 35177291404 (10cd219) |

The two `panes` failed-load tests share a run (a6af19e), and so do `panes:230` and
`target-source:106` (d6e808a). Look for a shared cause before treating them as four problems.
Attempt-1 logs stay at `…/actions/runs/<id>/attempts/1/logs`.

**Shape 3 (`tabs.spec.ts:266`) — the assertion has been made readable, in `#244` (Rook, routed by
Wren while you were heads-down on shape 1; test-only, and yours to reshape).** `Expected: 0,
Received: 1` could not be triaged, because a count fits two opposite facts: the gate leaked a frame
for the tab being ENTERED, or a frame for the tab being LEFT was sent pre-gate and arrived during the
wait — and `FrameMessage` carries no tab id. It now compares each frame's `seq` against
`bus.lastSeq()`, read in the **same main-process callback** as the activation, so a failure names
which frame. Evidence: `35186688593` green with all three tests confirmed run, `35186716380` red at
the seq assertion (`[10]`, then `[8]`). **This does not fix a leak — it makes the next one legible.**
If shape 3 recurs after this, its message says which of the two facts it was.
