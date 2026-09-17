---
title: "Remove the deprecated `orientation` input once a breaking release is scheduled"
column: backlog
kind: chore
criterion: C2
order: 75
---

FILED BY HENRY 2026-09-17, closing `bug-orientation-name`. That card's spec item 7 put the removal on its own
card once `rotate` landed, and it has (#178, #207).

`orientation` stays accepted, with its old meaning, on the CLI (`--orientation`), every MCP tool that takes a
screen, and control. It's marked deprecated everywhere an agent or a person reads it. Removing it is a
**breaking change to a public flag and an MCP field**, so it's a breaking release. **When to ship one is
Opeyemi's call**, not this card's.

**When it's scheduled:**
- Remove the input from the CLI, MCP and control.
- Decide whether the `orientation` *output* goes too, or stays beside `rotated` and `screenShape`.
- Add the register entry (`docs/breaking-changes.md`), which #162's shape check will flag.
- Update the skill and README.
