---
title: "Once in a while, a frame is delivered after entering an image-mode tab closed the gate"
column: backlog
kind: bug
criterion: B5
order: 82
---

**Waiting on a recurrence:** `tabs.spec` *"entering an image-mode tab stops delivery"* failing with *"frames delivered after the gate closed: [seq…]"*. Nothing can be done until it fires.

FILED BY HENRY 2026-09-17, closing `chore-flaky-leaders-0917`. This is its shape 3, given a home of its
own under the sweep's rule: a question that only a recurrence can answer gets a card whose `waiting`
names the message that recurrence will print.

**Seen three times** as a first-attempt failure that passed on retry, in 43 main runs before `#244`:
`35125554296` (ab39983), `35130836287` (57e999d) and `35177333642` (9e9cdab). Each read
`Expected: 0, Received: 1`.

**Why that count could not be triaged, and what `#244` changed:** a count of 1 fits two opposite facts.
Either the gate leaked a frame for the tab being **entered**, or a frame for the tab being **left** was
sent before the gate closed and arrived during the wait. `FrameMessage` carries no tab id. The test now
compares each delivered frame's `seq` against `bus.lastSeq()`, read in the **same main-process callback**
as the activation. So a failure names which frame, and a seq above the line is a real leak.
- **Green:** `35186688593`, all three tests confirmed to have run.
- **Control, red at the seq assertion:** `35186716380`, with `[10]` then `[8]`, on a sabotage that never
  closes the gate.

**What to do when it fires:** read the seqs in the message against the gate line. A seq **above**
`lastSeq()` at activation is a leak for the entered tab, which is a product defect in the gate. A seq
**at or below** it is a frame for the tab being left, which was already in flight, and that one is a
harness question.
