---
title: "Apply the breaking-changes policy to the last five releases"
column: next
kind: readiness
owner: "obsrv-91"
criterion: C2
order: 32
---

OFFERED TO obsrv-91 2026-09-15 on Opeyemi's word — an offer rather than an assignment, since obsrv-91 routes through its own user and has twice declined to start on a peer's word alone. Left in Next until it answers.

**UNBLOCKED.** The card's own objection was that *"applying an unwritten policy retroactively is how a register becomes a matter of taste"*. The policy is now written: `docs/compatibility.md`, C1, 2026-09-15. Reading 0.56.0–0.60.0 against it is a defensible exercise rather than a judgement call, which it was not yesterday.

**WHY NOT HENRY, stated because the obvious objection is that he is free and wrote the policy.** That is the reason, not the counter-argument. Kenya named the asymmetry earlier this week: *reading someone else's prose against the code and writing your own are different activities, and the standard slips on the second.* Someone applying their own freshly-written rule to five releases will find exactly the breaks the rule was shaped around and miss the ones it does not cover — and the rule was shaped this week, largely from 0.59.0 and 0.61.0. A reader who did not write it is the check on whether the policy is any good, and that is worth more than the register entries.

**WHY obsrv-91 SPECIFICALLY.** This is a reading-and-judgement task with no code to hide behind, and obsrv-91's demonstrated strength this week has been exactly that: it released two cards rather than hold them against a maybe, it corrected its own shipped proposal when Kenya's result went against it, and it raised the classified-list rot as a future risk that turned out to be already true. It also has no stake in the policy.

**WHAT THE CARD ACTUALLY ASKS, from its own text:** read 0.56.0 through 0.60.0 for anything that broke a caller and add it to `docs/breaking-changes.md`. Cheap per release since the notes exist on GitHub — **but it needs reading the diffs too, and the card says why: the releases that named a change are exactly the ones least likely to have missed one.** A release that shipped a breaking-changes entry had someone thinking about breakage; a release that shipped none may have had nobody looking.

**One thing the new policy adds that the card predates:** four contracts, not one. MCP replies, the CLI's stdout key set, the control server, and exit codes. A retroactive read that only checks MCP replies will miss the CLI's key set, which 0.61.0 showed is asserted exactly by the suite and is therefore a contract someone else may be asserting too.

**And the honest possible outcome:** finding nothing in a release is a result, and so is finding that the policy cannot decide a case. The second is more valuable — it means the policy has a hole, and a policy written this week has not been tested against anything except the week it was written in.

What C2's check actually asks and the register does not yet satisfy: read 0.56.0 through 0.60.0 for anything that broke a caller and add it to docs/breaking-changes.md. Cheap per release — the notes exist on GitHub — but it needs reading the diffs too, since the releases that named a change are exactly the ones least likely to have missed one. Depends on C1: the policy defining what counts has not been written, and applying an unwritten policy retroactively is how a register becomes a matter of taste.
