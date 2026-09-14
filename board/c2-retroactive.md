---
title: "Apply the breaking-changes policy to the last five releases"
column: backlog
kind: readiness
criterion: C2
order: 32
---

What C2's check actually asks and the register does not yet satisfy: read 0.56.0 through 0.60.0 for anything that broke a caller and add it to docs/breaking-changes.md. Cheap per release — the notes exist on GitHub — but it needs reading the diffs too, since the releases that named a change are exactly the ones least likely to have missed one. Depends on C1: the policy defining what counts has not been written, and applying an unwritten policy retroactively is how a register becomes a matter of taste.
