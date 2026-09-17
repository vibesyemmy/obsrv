---
title: "Three sentences exist only for an app older than the tree: one decision, when a minimum version is set"
column: backlog
kind: chore
criterion: C5
order: 79
---

FILED BY HENRY 2026-09-17 out of `c5`'s inventory, on Wren's read: three producers share one
question, so the question gets somewhere to land rather than three card entries.

**The three, and the skew each needs:**

| producer | the sentence | reachable when |
| --- | --- | --- |
| `src/mcp/walk.ts:41` | the app predates page-wise scrolling (0.41.0); measured without walking | an installed app older than 0.41.0 |
| `src/shared/walkCoverage.ts:194` | content in an iframe, in a shadow root, or in a container that scrolls by transform … was not brought into view | the app sends no `blocked` field, which shipped in `82884e1` (0.58.0) |
| `src/mcp/server.ts:1092` | this app is older than the capture's settle verdict, so `settled` reports whether the navigation was confirmed | the app sends no settle verdict (pre-0.34.0 behaviour, per the register) |

**None can be produced by the suite**, which builds one tree, and **none should be faked**: a stub of
a version we no longer ship asserts our belief about what it sent, so a wrong belief is a green test
over a broken field. They are recorded in `docs/note-inventory.md` as named reasons.

**Why they exist at all:** the npm package updates ahead of the installed app, which the register
already documents for `colorPainted` ("a 0.61.0 server driving a 0.60.0 app"). That skew is real, so
the sentences are not dead code.

## The decision this card exists for

**When someone sets a minimum supported app version, these three are the first thing to re-read.**
Each is either kept (the skew is still possible), removed with the compatibility note that replaces
it, or replaced by one sentence that names the version rather than the symptom.

**Not a decision to take on its own**, and deliberately not taken here: a minimum version is a product
line, not a tidy-up, and the right moment is when one is being set for another reason.

**What would make it urgent:** a fourth sentence joining the group, or a report from the field where
one of the three fired and read as nonsense to whoever saw it.
