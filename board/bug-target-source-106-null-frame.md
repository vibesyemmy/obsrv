---
title: "Once in a while, target-source's dirty-rect test finds no frame to read"
column: backlog
kind: bug
criterion: B5
order: 83
---

**Waiting on a recurrence:** `target-source.spec:106` failing with *"no full 400x300 frame within 10 s"* or *"no partial frame within 10 s of the change"*, and its frame record. Nothing can be done until it fires.

FILED BY HENRY 2026-09-17, closing `chore-flaky-leaders-0917`. This is its shape 2, given a home of its
own under the sweep's rule: a question that only a recurrence can answer gets a card whose `waiting`
names the message that recurrence will print.

**Seen three times** as a first-attempt failure that passed on retry: `35159915364` (093d1c3),
`35160475615` (d6e808a) and `35177291404` (10cd219). The first line was
`TypeError: Cannot read properties of null (reading 'frame')`, inside the test's own `app.evaluate`
rather than at an assertion. The test asked for a frame, and there wasn't one.

**What `#240` changed:** the test keeps a timed record of every frame and step, with runs of identical
geometry collapsed, and on failure throws one of two named sentences with the record attached:
- *"no full 400x300 frame within 10 s"*, where the first full frame never came;
- *"no partial frame within 10 s of the change"*, where a full frame came but the small change produced
  no dirty rect.

**Not established:** the cause. The one run shared with `panes:230` (d6e808a) shares a machine and nothing
else, per Kenya's read, so this is not the toolbar defect `#239` fixed.

**What to do when it fires:** the record says which of the two it was and when each frame arrived. A
record with **no frames at all** points at frame delivery, the territory of `bug-target-canvas-no-frames`
and `bug-canvas-blank-without-notice`. A record **with full frames and no partial** points at dirty-rect
emission.
