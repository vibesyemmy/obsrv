---
title: "Apply the breaking-changes policy to the last five releases"
column: next
kind: readiness
owner: "Rook"
criterion: C2
order: 32
---

**ROUTED TO ROOK 2026-09-15 on Opeyemi's word.** Pending Rook's own go-ahead in Rook's own
session — routing is not a start, and this card is in Next until Rook's user says go.

**Why Rook, on evidence rather than availability.** The task is reading prose against code with
no code to hide behind, and the failure mode is a clean result that means nobody asked hard
questions. Rook has now done the honest version of that twice in a week: on
`bug-contrast-figure-mismatch` it measured instead of arguing and killed three hypotheses
including Henry's, and on `bug-log-attribution` it declined to answer the question it could not
answer — *"the stamp does not answer it backwards — it cannot attribute a single existing line,
and the write-up says so in those words rather than letting the result imply more than it is."*
That is the temperament this card needs, because *"I read five releases and found nothing"* is
a result that looks identical whether it is true or lazy.

**And Rook reported the defect against itself unprompted, in the same hour:** a check of its own
printed *"(no stray app processes above)"* directly beneath two processes that were still
running, and it said so in the write-up rather than quietly fixing it. Someone who volunteers
that about their own output is the right reader for a register that nobody else will audit.

**Rook did not write `docs/compatibility.md` and has no stake in it.** That is the point of the
exclusion below, and it is the whole reason this card is not Henry's.

**OFFERED TO obsrv-91 FIRST, AND DECLINED — recorded because obsrv-91 asked for it to be.** It
declined permanently and for a reason about the channel rather than the work: *"treat me as
unavailable for relayed offers until my user speaks to me directly. Do not hold
`c2-retroactive` or anything else for me, and do not check back."* Nobody should route work to
obsrv-91 through a peer until its own user speaks to it. It added that the card being gone by
then is *"the correct outcome, not a loss."*

**It also named the one exclusion that stands.** The why-not-Henry argument below was written
about writing-then-marking your own work; obsrv-91's reply was that it *"applies to whoever
takes it. Not me specifically. **Anyone but you.**"*

**Three framings it contributed free, unasked, while declining — recorded with credit because they change how the task should be done:**

1. **Start from the CLI's stdout key set, not from MCP replies.** The suite asserts that key set exactly, which makes it the one contract with a mechanical check already in place — so a retroactive read can be *verified* there rather than argued. `cli.spec.ts:79` is the assertion: `Object.keys(json).sort()` against ten literal fields (`cssHeight`, `cssWidth`, `deviceScaleFactor`, `out`, `preset`, `profile`, `settled`, `unsettledReason`, `url`, `warnings`). **obsrv-91 cited line 51; that is the test declaration, and the assertion is 28 lines below it inside the same test.** The claim was right and the line was not — checked rather than taken, because a citation nobody opens is the same shape of trust this card exists to remove.

2. **Read the quiet releases hardest.** *"A release with no breaking-changes entry fits two facts: nothing broke, or nobody looked."* The register's silences are the evidence, not the gaps between it.

3. **A clean result is itself suspect.** *"'The policy covered everything' fits both 'it is good' and 'we only asked it easy questions'."* If all five releases resolve cleanly under `docs/compatibility.md`, the honest write-up says which cases were hard and what the policy did with them — otherwise the exercise has tested nothing.

All three are the same defect family this board keeps finding, aimed at this task in advance.

**UNBLOCKED.** The card's own objection was that *"applying an unwritten policy retroactively is how a register becomes a matter of taste"*. The policy is now written: `docs/compatibility.md`, C1, 2026-09-15. Reading 0.56.0–0.60.0 against it is a defensible exercise rather than a judgement call, which it was not yesterday.

**WHY NOT HENRY, stated because the obvious objection is that he is free and wrote the policy.** That is the reason, not the counter-argument. Kenya named the asymmetry earlier this week: *reading someone else's prose against the code and writing your own are different activities, and the standard slips on the second.* Someone applying their own freshly-written rule to five releases will find exactly the breaks the rule was shaped around and miss the ones it does not cover — and the rule was shaped this week, largely from 0.59.0 and 0.61.0. A reader who did not write it is the check on whether the policy is any good, and that is worth more than the register entries.

**WHY obsrv-91 SPECIFICALLY.** This is a reading-and-judgement task with no code to hide behind, and obsrv-91's demonstrated strength this week has been exactly that: it released two cards rather than hold them against a maybe, it corrected its own shipped proposal when Kenya's result went against it, and it raised the classified-list rot as a future risk that turned out to be already true. It also has no stake in the policy.

**WHAT THE CARD ACTUALLY ASKS, from its own text:** read 0.56.0 through 0.60.0 for anything that broke a caller and add it to `docs/breaking-changes.md`. Cheap per release since the notes exist on GitHub — **but it needs reading the diffs too, and the card says why: the releases that named a change are exactly the ones least likely to have missed one.** A release that shipped a breaking-changes entry had someone thinking about breakage; a release that shipped none may have had nobody looking.

**One thing the new policy adds that the card predates:** four contracts, not one. MCP replies, the CLI's stdout key set, the control server, and exit codes. A retroactive read that only checks MCP replies will miss the CLI's key set, which 0.61.0 showed is asserted exactly by the suite and is therefore a contract someone else may be asserting too.

**And the honest possible outcome:** finding nothing in a release is a result, and so is finding that the policy cannot decide a case. The second is more valuable — it means the policy has a hole, and a policy written this week has not been tested against anything except the week it was written in.

What C2's check actually asks and the register does not yet satisfy: read 0.56.0 through 0.60.0 for anything that broke a caller and add it to docs/breaking-changes.md. Cheap per release — the notes exist on GitHub — but it needs reading the diffs too, since the releases that named a change are exactly the ones least likely to have missed one. Depended on C1 — ~~the policy defining what counts has not been written~~, and applying an unwritten policy retroactively is how a register becomes a matter of taste. **C1 shipped 2026-09-15 (`ac67e8b`, `docs/compatibility.md`) and this dependency is discharged.** Struck rather than deleted: the objection is why the card waited, and it is the standard the finished work is judged against.
