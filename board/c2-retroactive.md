---
title: "Apply the breaking-changes policy to the last five releases"
column: done
kind: readiness
owner: "Rook"
criterion: C2
order: 32
---

**ROUTED TO ROOK 2026-09-15 on Opeyemi's word.** Pending Rook's own go-ahead in Rook's own
session — routing is not a start, and this card is in Next until Rook's user says go.

**GO-AHEAD FROM OPEYEMI 2026-09-15.** Rook starts. Own worktree off current main, Review not
main, merge on Opeyemi's word direct to Rook, design to him before writing.

**Reconnaissance done before handing it over, so the card does not start with a survey.** The
register currently has entries for exactly two versions: `0.59.0`, and `0.61.0` marked
unreleased. **Four of the five releases in scope are silent** — 0.56.0, 0.57.0, 0.58.0, 0.60.0
— which is precisely the state obsrv-91 said to read hardest, because a release with no entry
fits *nothing broke* and *nobody looked* equally well.

Ranked by how much changed under that silence, `src/` only:

| release | diff | register |
|---|---|---|
| 0.56.0 | 5 files, +69 −8 | silent |
| 0.57.0 | 9 files, +222 −27 | silent |
| **0.58.0** | **10 files, +463 −38** | **silent** |
| 0.59.0 | 11 files, +329 −50 | has an entry |
| 0.60.0 | 1 file, +47 −2 | silent |

**0.58.0 is the largest diff in the range and has no entry at all.** 0.59.0 is immediately
after it, is comparable in size, and *did* get one — so the pair is the natural place to start:
the same author, the same fortnight, one release documented and its larger neighbour not.

0.60.0 at one file is the cheapest to clear and the most likely to be genuinely empty. Clearing
it is still worth doing explicitly, because "we checked and it was clean" and "we never checked"
are the two facts this whole card exists to separate.

**Start from the CLI's stdout key set**, per obsrv-91: it is asserted exactly at
`cli.spec.ts:79` — `Object.keys(json).sort()` against ten literal fields — which makes it the
one contract a retroactive read can *verify* rather than argue. Note `0.61.0`'s existing entry
already records that surface gaining `url`, so the mechanism is known to bite here.

The four contracts are unequal and a read that only checks MCP replies will miss three of them.
See `docs/compatibility.md`.

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

INTO REVIEW 2026-09-15, branch `docs/c2-retroactive`. Write-up: docs/research/2026-09-15-c2-retroactive.md; the decision rules, written before any diff was read, are kept beside it at docs/research/2026-09-15-c2-rules-preregistered.md.

**NO BREAKING CHANGES FOUND IN 0.56.0-0.58.0 OR 0.60.0, AND THE POLICY HAS A HOLE THAT IS WORTH MORE THAN THE ENTRIES WOULD HAVE BEEN** — which is the outcome Henry said to feel free to reach.

VERIFIED RATHER THAN ARGUED, per release: the CLI stdout key set (the suite asserts it exactly — unchanged at nine keys, `url` arriving in 0.61.0 which is already documented); the top level of every MCP output shape (unchanged); CONTROL_COMMANDS (unchanged, thirty); the CLI's exit codes (unchanged). And `additionalProperties: false` was confirmed ON THE WIRE by asking the built MCP server, because the schemas are zod shapes converted by the SDK and the string appears nowhere in src/ — everything else in the policy rests on that being true.

THE HOLE: the policy is younger than every release it was applied to. compatibility.md was written 2026-09-15, breaking-changes.md and thresholds.md on 2026-09-14, and NONE of the three existed at 0.60.0. So T1 (a documented threshold moving without thresholds.md moving with it) cannot be violated by 0.58.0 — there was no thresholds.md — and the requirement that the release notes announce a break cannot be met backwards at all. Retroactive application produces a RECORD, not an ANNOUNCEMENT, and the policy text does not say which of those it is asking for.

TWO OF MY FOUR INSTRUMENTS WERE VACUOUS, and only a control caught either. The shape parser's first version missed the known presetId/profileId removal and invented two others; rewritten, it finds it, and an independent awk count agrees. The NESTED-field check returned 92 names at every tag including one with a known change — saturated and insensitive — so whether a field was added deeper than a shape's top level is UNCHECKED and is reported as unchecked rather than clean. That is the largest gap in this pass and the write-up says how to close it.

MY FIRST CONTROL WAS ALSO WRONG: I expected 0.61.0's documented `url` addition to appear in the MCP shapes. It is on the CLI stdout surface. Same field name, different contract — the confusion the policy's four-surface section exists to prevent, arriving in the person applying it.

THE CASE THAT LOOKED STRONGEST WENT THE OTHER WAY. 0.57.0's "the answer names the page it measured" reads like url's meaning changing two releases before it was documented as changing. Its own commit message settles it: "`url` still means the address that was asked for ... the MCP output schemas are additionalProperties: false, so where the figures came from is said in a note rather than by changing a field." The author was already applying the constraint the policy later wrote down.

THE REGISTER GAINS ONE ENTRY, and it records a check rather than a change: "checked and clean" and "never checked" are different facts and an absent entry does not distinguish them. It states its own two limits (the nested gap, and behaviour changes invisible to a name list) rather than implying a completeness it does not have.

FOR THE POLICY, three things the write-up asks for: decide A2 (is a new MCP tool breaking, given the reasoning that makes an added field breaking does not obviously carry) and A4 (a new enum value on the CLI rather than MCP), and say in compatibility.md what retroactive application means, since this is the first time it was tried and will not be the last.

MERGED 2026-09-15 on Opeyemi's word, `c27f06d`. Verified on the merged tree rather than either
side of it: build first, typecheck exit 0 across three configs, 1181/1181 unit, `board:check`
green. `docs/board.md` and `docs/board.html` conflicted and were REGENERATED; every card merged
cleanly.

**The card was taken for the hole rather than the entries, and the hole is what it produced.**
Four silent releases checked, none breaking. The finding: **the policy is younger than every
release it was applied to** — none of `compatibility.md`, `breaking-changes.md` or
`thresholds.md` is in the tree at any of the five tags. Two clauses cannot be satisfied
backwards, and 0.58.0 moved a threshold while breaching nothing because there was no file to
move. Decided in `compatibility.md` at `87800a6`, with two other questions the pass surfaced.

**The claim the policy leads with was checked for the first time.** `additionalProperties: false`
cannot be established by reading — the schemas are zod shapes the SDK converts and the string
appears nowhere in `src/`. Rook asked the built server over stdio. It is true. It had been
asserted for a day.

**Two of four instruments were vacuous and the register says so**, so whether a field was added
deeper than a shape's top level is UNCHECKED rather than silently assumed complete.

**And the strongest candidate went the other way**, which is the result least likely to have
survived if the card had been taken to produce entries: 0.57.0 reads like `url`'s meaning
changing early, and its own commit message shows the author already choosing notes over field
changes because of the `additionalProperties` constraint, before that constraint was written
down. The policy described existing practice more than it introduced a rule.

Henry wrote the policy and did not review it; Rook did not write it and did. That separation is
the only reason the three gaps were found rather than confirmed.
