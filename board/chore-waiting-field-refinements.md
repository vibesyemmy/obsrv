---
title: "The waiting field, second pass: `ci` apart from `event`, the wait's age, one name per person, and Review"
column: done
owner: "Henry"
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

## RESOLVED 2026-09-16 by Henry — all four, each with a control run through main's generator

1. **`ci` apart from `event`:** documented in `CONTRIBUTING.md` and in the board's own claim
   instructions. The usual words are a room name, `Opeyemi`, `ci` (a suite or merge, minutes) and
   `event` (nobody can force it). The examples now use `ci`. Not enforced: `who` stays free text, and
   the check still requires only that it comes first.
2. **The wait's age:** `waitingSince` is the commit time of the last commit whose diff touched a
   `^waiting:` line (`git log -1 -G`). The Markdown view says *(since 2026-09-16 11:28 UTC)*. The
   HTML page carries the timestamp and says *"· set 3 h ago"* **at the moment it is read**, since a
   page built once and read for hours would otherwise bake in the stale age this exists to expose.
   **No date rather than a wrong one:** on a shallow clone, for a card changed and not committed, or
   without git. `pages.yml` now checks out with `fetch-depth: 0`, or the published board would have
   shown no dates at all.
3. **One name per person:** counted case-insensitively, keeping the first card's spelling.
4. **Review:** `waiting` is allowed there and optional. Present, it must name who. It's counted in
   the heading: *"…; 1 in Review, waiting on Wren 1"*.

**Checks, with temporary cards (removed, never committed):**

| case | this branch | `main`'s generator |
| --- | --- | --- |
| `Opeyemi: …` + `opeyemi: …` on Doing | *waiting on Opeyemi 3* (with the real card) | *Opeyemi 2 … opeyemi 1* |
| `waiting: "Wren: a cold read"` on Review | accepted, counted | **refused** |
| `waiting: ""` on Review | refused, naming the fix | refused (the old message) |
| `waiting` on Next | refused: *"belongs on a Doing or Review card"* | refused |
| committed waits | dated per card (11:28 ×2, 12:50) | no dates |
| uncommitted temp cards | no date | — |
| `git clone --depth 1` | 3 waits, 0 dates | — |
