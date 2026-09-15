---
title: "A suite that measured nothing must be as loud as two suites at once"
column: done
kind: chore
order: 25
owner: "Rook"
---

MERGED 2026-09-15 on Opeyemi's word, as 2f33e43 on main. Verified before pushing: typecheck clean across all three configs, 1141/1141 unit — reconciling Rook's 1121 + 20 new tests exactly — and board:check green.

**AND THE GUARD WAS WATCHED FIRING ON MAIN**, not merely covered by tests that pass. Two unit suites started two seconds apart:

    obsrv: the unit suite is already running (pid 26730, started 2s ago).
    Two suites in one worktree make both results untrustworthy — test:e2e rewrites out/ while the CLI specs read it.

The first run completed normally, 6.22 s. Live holder named, age real, the refusal saying which of the two conditions it found. That is what obsrv-91 asked for at the design stage and it holds outside the worktree it was built in.

**THE DEFECT IT CAUGHT IN ITSELF is the thing to carry forward.** The first version of the stale message said *"It died 0s ago"* about a suite killed ten seconds earlier — the caller had no age to hand and passed a literal zero. A sentence keying off nothing, inside the fix for sentences that key off nothing, in the one message whose whole job is to be believed. It would have passed review, because a zero is a plausible number. Only running it against a real corpse made it wrong.

The three caveats are in the merge commit as well as here, deliberately: a card can be edited by anyone and a commit travels with the change. `mcp.spec.ts` and `rendering.spec.ts` accumulate the same module-level state and are NOT checked. `noEvidenceMessage` existing is not the same as its being used. A residual takeover race remains — two processes seeing one dead holder, the loser refused on the re-read rather than serialised.

Note for anyone in `live-drive.spec.ts`: this rewrote its `info` access through `established()`, while Kenya was working in that file on the resizing card.

FREE AS OF 2026-09-14 evening. obsrv-91 raised it with its user twice and got silence rather than a refusal, then released it rather than hold a card against a maybe while someone else was free and wanting it: "mine only in the sense that nobody else has it, which is not a claim on a card." If its user later says take it, it will ask what is left rather than start a second copy, and Henry hears before it touches anything.

**THE PART obsrv-91 SAYS IT WOULD HAVE GOT WRONG FIRST, and it is the difference between a guard and a green light.** The STALE-LOCK branch needs an OBSERVATION, not a design.

A guard that has only ever been seen to refuse a *live* suite has been shown capable of refusing. That is not the same as being right about WHICH of the two it found. Both branches produce a refusal; only one of them is correct in a given moment, and a refusal you cannot tell apart is what gets the lock deleted by the first person it blocks — after which nobody trusts it again.

So: kill a suite mid-run, leave the lock behind, and watch the refusal NAME IT AS STALE. Until that has been seen, the two branches are indistinguishable in the only way that matters.

obsrv-91 flags this as the same shape that caught it and obsrv-a6 yesterday — both had verified their gates by making them fail on purpose, and both experiments were sound and blind, because what was wrong was not the assertion but what it was fed. A check shown capable of failing is still only a claim about the check.

SCOPE WIDENED 2026-09-14 on obsrv-91's argument, which is right: this card and the evidence-assertion are two halves of one thing, and building them apart gets one of them wrong.

HALF ONE — refuse to start a suite while another is running. Two concurrent suites in one worktree made both greens untrustworthy and cost a full afternoon.

THE HARD PART, and the reason a naive lock file is worse than nothing: the guard must distinguish ANOTHER SUITE RUNNING from A STALE LOCK LEFT BY A SUITE THAT DIED. Those are identical from a lock file alone. A guard that refuses on a stale lock gets its lock deleted by the first person who hits it, and then nobody trusts it again. Whatever it checks — a pid, a port, a live process — the refusal text must SAY WHICH OF THE TWO IT FOUND.

HALF TWO — a suite that passed having measured nothing is indistinguishable from one that passed having checked everything. obsrv-a6 hit this with a -g filtered run; Henry hit the same shape verifying the surface-parity staleness check, which passed green on a planted stale row because filtering had starved the rows it compares. The fix there was a vacuity guard (surface-parity.spec.ts:368) that fails when the comparison had no evidence. Generalise it.

Kenya's find is the third instance in one day and belongs in the same fix: live-drive.spec sets `info` (control port and token) in the FIRST test of the file, so any -g filtered single-test run of it dies on `Cannot read properties of undefined (reading 'token')` — which reads like a bug in whatever test you just wrote.

So: a concurrent suite, a stale lock, and a run that asserted nothing are three ways to get a green that means nothing, and the guard should name which one it is looking at in all three cases.

INTO REVIEW 2026-09-14, branch `chore/suite-guard` off 4b46a49. Write-up with every message copied from a real run: docs/research/2026-09-14-suite-guard.md. 1141/1141 unit, typecheck clean across all three configs.

THE STALE-LOCK OBSERVATION, which obsrv-91 said was the difference between a guard and a green light, was made rather than designed. A real `npm test` started, SIGKILLed mid-run so no exit path could run, the lock left behind, and the next suite's first words recorded verbatim: "taking over a stale lock from the unit suite — pid 25891, which is no longer running. It died 16s ago without releasing." A dead holder is taken over, not refused — refusing on a corpse is what gets the lock deleted by hand.

AND THE FIRST VERSION OF THAT MESSAGE WAS WRONG, which only running it could show. It said "It died 0s ago" about a suite killed ten seconds earlier: the caller had no age to hand and passed a literal 0. A sentence keying off nothing, in the one message whose job is to be believed. The age now travels out of the lock file with the takeover, and a 42-second dead holder is asserted in tests/unit/suiteLock.test.ts so it cannot quietly become a constant again.

HALF ONE: scripts/suiteLock.js + scripts/suite.js, one lock per worktree over all three suites — the interference is BETWEEN them, since test:e2e rewrites out/ while the CLI specs read it. Atomic mkdir, holder file, process.kill(pid,0), the pattern bin/electronPath.js already uses for the install lock. Live holders are refused with pid and age; the refusal says in words that it is a live holder and not a leftover file.

HALF TWO: src/shared/established.ts. Kenya's live-drive.spec case before and after, same -g command — before `TypeError: Cannot read properties of undefined (reading 'port')`, after `info (the control port and token) was never established: this file's first test did not run in this suite`. The first names the app, the second names the run. surface-parity.spec.ts's vacuity assertion — the only one anyone had written — now takes its wording from noEvidenceMessage so the next one is not discovered the same way; observed still firing under -g.

WHAT IT DOES NOT DO, stated because an unaudited file looks identical to an audited one: mcp.spec.ts and rendering.spec.ts also accumulate module-level state and have NOT been checked against this. noEvidenceMessage existing is not the same as its being used. Also a residual takeover race (two processes seeing the same dead holder; the loser is refused on the re-read rather than serialised) — electronPath.js's takeover mutex is the heavier pattern if it ever shows up. It has not.
