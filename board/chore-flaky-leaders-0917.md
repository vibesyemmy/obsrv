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

## READ 2026-09-17 by Kenya — four leaders, THREE shapes, and the shared runs do not share a cause

**The hidden-predecessor check is negative for all four.** Each does its own setup: `tabs:266` calls
`reset()` and `activate()`, both `panes` tests fill and submit their own address, and
`target-source:106` loads its own `data:` URL. So the defect that explained `panes:83` and
`sync:139` tonight does **not** explain any of these — worth stating, because it was the first thing
to look for and the answer is no.

### Shape 1 — `panes:230` and `panes:259`: the window state never renders, while the badge does

Both, in run `a6af19e`, identical to the line:

    Error: expect(locator).toBeVisible() failed
    Locator: locator('.load-error-state')
    Timeout: 15000ms
    Error: element(s) not found

**`element(s) not found`** — not present-but-hidden. And `panes:230` fails the same way in `d6e808a`,
so the shape is consistent across runs.

**What rules out the obvious environmental guess:** `panes:197` — *the same invalid host*, in the
same app, **294 ms earlier** — passed, as did `:216` at 527 ms. So the bad-host load was failing fast
right before. The retries then passed in **649 ms and 328 ms**. A slow resolver would have to have
been slow for exactly two adjacent tests and fast either side of them.

**The difference between the tests that pass and the two that fail is which element they wait on:**
`:197` waits for `.badge-error`, the toolbar; `:230`/`:259` wait for `.load-error-state`, the
window-level empty state. **The error reaches the toolbar and not the window.**

**A lead, unmeasured:** `:230` navigates good → bad, and `:216` immediately before it is the test
that *clears* the badge with a successful navigation. A latch left by clearing an error, so the next
failure renders no state, would fit — and would fit `:259` too, which runs straight after. Nothing
here measures that; it is where I would point a repro.

### Shape 2 — `target-source:106`: a null frame in the test's own evaluate

    TypeError: Cannot read properties of null (reading 'frame')

Inside `app.evaluate`, not an assertion. Unrelated to anything in shape 1.

### Shape 3 — `tabs:266`: one frame got through the gate

    expect(received).toBe(expected)   Expected: 0   Received: 1

A frame was delivered that the image-mode gate should have dropped, inside the test's 600 ms window.

## So the card's own suggestion does not hold, and that is the useful part

It asked us to look for one cause behind the shared runs. **In `d6e808a`, `panes:230` and
`target-source:106` fail with unrelated first lines** — a missing DOM element and a null frame — so
that run shares a machine and nothing else. **In `a6af19e` the two `panes` tests do share a shape**,
but they are the two tests that wait on the same element, which is a shared *subject*, not evidence
of a shared environment.

**Four leaders, three shapes, and only one pair is related.**
