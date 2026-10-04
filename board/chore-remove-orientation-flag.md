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

## DECIDED 2026-10-04 by Opeyemi: remove it in the next release

Asked in the room at 14:22Z (#3358, "What is it?"), explained by Wren (#3360: the old `portrait|landscape` input whose name
misleads, deprecated since `#178`, which first shipped in 0.61.0), and decided by Opeyemi at 14:24Z (#3363): **"Remove it in the
next release."** That is option 1 of #3360. It rides the next release, which is already breaking (`docs/breaking-changes.md`,
"Next release", lists breaking MCP-surface entries, for example `obsrv_inspect`'s `lineRects`, `#543`), so callers take one
break, not two.

**What is still open, and is not Opeyemi's to answer:** whether the `orientation` *output* stays beside `rotated` and
`screenShape` (the card's "When it's scheduled" list leaves that to the owner), and **the date of the release**, which
nobody has set. The removal has to land (code PR, gated, with its register entry) **before that release is cut**, so it is
a release prerequisite.

**What this changes on the board:** the `waiting:` line is gone, because the question it held is answered and the lane must
not keep asking for it. The card stays in Backlog and unclaimed until someone claims it.
