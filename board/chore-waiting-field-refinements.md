---
title: "The waiting field, second pass: `ci` apart from `event`, the wait's age, one name per person, and Review"
column: doing
owner: "Henry"
waiting: ""
kind: chore
order: 52
---

FILED 2026-09-16 by Henry, from Wren's cold read of #57 (room #136). The design was Rook's, and it
moved to Henry because a design's author is the worst reader of what it doesn't cover (room #160).

**The four refinements, as Wren put them:**

1. **`ci` apart from `event`.** A suite result comes in minutes and certainly will. A `panes:83`
   recurrence can't be forced and may never come. Under one `event`, finished-work-in-CI hides
   inside a wait that may never end. Document the usual `who` values: a room name, `Opeyemi`, `ci`
   and `event`.
2. **The wait's age.** *"Rook: back at 13:00"* still reads as current at 15:00. The check can't
   tell "still waiting" from "the wait ended and nobody updated it", because CI has no "now". Render
   when the `waiting` line last changed, and let the reader judge.
3. **One name per person.** `who` counts by exact string, so `Opeyemi` and `opeyemi` would be two
   rows.
4. **An optional `waiting` on Review.** A Review card waits on a reviewer, and on which one isn't
   implied. The review queue becomes countable too.

**Proven within the hour:** at 13:05 on 2026-09-16 the board still read *"Kenya: back at 13:30"*
and *"Rook: back at 13:00 WAT"* after both were back (room #152).

**One trap for (2), found while planning:** `pages.yml` checks out at depth 1, so a `git log`
there dates every wait at HEAD's time. The age needs full history there, and no age at all
wherever history is shallow, rather than a wrong one.
