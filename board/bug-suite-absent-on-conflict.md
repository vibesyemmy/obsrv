---
title: "The e2e suite still vanishes on a conflicting PR, and its absence is silent"
column: done
kind: bug
owner: "Rook"
order: 39
---

MERGED 2026-09-15 on Opeyemi's word. Verified before pushing: typecheck exit 0 across three configs, 1156/1156 unit, board:check green, reds:check green.

**And `reds:check` was watched refusing**, because a guard nobody has watched refuse is a claim and this card is about exactly that. A row naming no test was planted:

    exit 1, and the refusal blames the LIST rather than the suite —
    "A row goes stale when its test is fixed, renamed or removed — and a fixed
     test is the commonest cause, which makes these the rows most likely to be
     quoted to excuse a red that can no longer happen. Delete the row, or
     correct the title. This is the list being wrong, not the suite."

Row removed, exit 0 again. That message is the difference between a guard and an obstacle: it says which of the two things is broken, which is the same property the suite lock has.

ASSIGNED TO ROOK 2026-09-15 on Opeyemi's word. **Left in Next rather than Doing because Rook also holds `b1`, and the sequencing is Rook's to decide — it knows whether the live run has started and Henry does not.** Move it to Doing when it starts.

If they are taken in an order, Henry's view is that this one goes first and `b1` after: `b1` is a long run that produces cards, this is a decision that affects everyone's workflow tonight — every pull request anyone opens hits it. But if the live run is already underway, interrupting it to design a workflow change is worse than finishing it.

**Two things to read before designing, both of which arrived after the card was written and both of which change it.**

**The framing is obsrv-91's, and it supersedes obsrv-91's own earlier one.** Not *"restore the missing signal"* — ***"make the signal that exists interpretable."*** When `3e6bbaf` went red on main, the failing test was checked against a classified list taken before the merge, found on it, and cleared as pre-existing in ten seconds. That decision did not need the suite to have run on the merge ref at all. The expensive option is a 17-minute macOS suite made unconditional; a reviewer who can separate a pre-existing red from a new one may not need it for most decisions.

**And the cheap option has a rot the expensive one does not.** A classified list is a decision made at a moment, and nothing makes it notice when a test leaves it. Three of seven rows were already wrong hours after the list was made — and they were the rows whose tests had been FIXED, which is to say the rows most likely to be cited to excuse a red. Key on the test TITLE rather than `file:line`, and make something FAIL when a row stops matching a real test. Otherwise the list excuses reds that no longer exist and hides ones that do, which is worse than no list.

**UNOWNED AND FREE.** Offered to obsrv-91 2026-09-15; its user did not answer after three asks. It declined to hold it — *"an unanswered offer is not a claim"* — and asked that anyone who wants it take it. If its user surfaces after someone has started, it will ask what is left rather than open a second copy.

**THE CARD'S FRAMING CHANGED, and the better version came from watching it work rather than from argument.** `3e6bbaf` went red on main; the failing test was `text-scale.spec.ts:251`, already on the classified list taken *before* that merge, so the red was pre-existing. That took ten seconds and did not need the suite to have run on the merge ref at all.

obsrv-91's reframing, which supersedes its own earlier one: this is not *"restore the missing signal"*, it is ***"make the signal that exists interpretable."*** The expensive option is running a 17-minute macOS suite unconditionally. A reviewer who can tell a pre-existing red from a new one in ten seconds does not need it for most decisions.

**AND THE HALF THAT ROTS, which obsrv-91 raised and is already true.** A classified list is a decision someone made at a moment, and nothing makes it notice when a test leaves the list — fixed, renamed, moved, deleted. That is the stale-`EXPLAINED`-row shape from 2026-09-14 exactly.

It is not a future risk. **Three of seven rows on the existing list are already wrong, hours after it was made**, and they are the three whose tests were FIXED:

    live-drive.spec.ts:963    now points at  expect(elapsed).toBeLessThan(2_900)     test moved to :969
    live-drive.spec.ts:1015   now points at  while (cycling) {                       moved
    sync.spec.ts:165          now points at  a comment                               test moved to :185
    text-scale.spec.ts:251    still a real test                                      — the row actually used

So the clearance of `3e6bbaf` was correct, and correct partly because that row happened not to have moved. The rows most likely to be cited as "known, pre-existing" are exactly the ones a fix makes stale.

**Which names the fix: key on the test TITLE, not on `file:line`.** Titles survive edits and moves; line numbers do not survive the fix that makes a row obsolete. And something must FAIL when a row no longer matches a real test — otherwise in a month the list excuses reds that no longer exist and hides ones that do.

Raised 2026-09-15 by Kenya, four minutes after `bug-pr-checks-absent` closed, having hit the same mechanism on PR #2.

That card fixed the BOARD CHECK by making it push-triggered. It did not fix the class its title promised. Measured:

    board.yml      push: ALL branches                 cannot expire
    ci.yml         push: main only + pull_request     STILL EXPIRES
    b5-sweep.yml   no push trigger + pull_request     STILL EXPIRES
    pages.yml      push: main only                    no PR dependency

On PR #2, while conflicting: `gh pr checks 2` listed the board check and nothing else; one run for the head sha. **The e2e job was never scheduled** — on the first pull request that would have exercised the branch the fix was written for.

**THE COST IS ALREADY BEING PAID.** Kenya has rebased three times on that branch and twice on the one before, *"all of them to buy a CI run rather than to resolve anything real"*. Every card that touches `board/` conflicts on the generated files once main moves, so this is the normal state of a second contributor rather than an edge case.

**THE DECISION, and it is why this is not a two-line copy of the board fix.** `board:check` is seconds on ubuntu with no dependencies, so making it unconditional costs nothing. The suite is **~17 minutes of macOS CI**. Making that unconditional on every branch push is a different trade entirely, and it would also double against `pull_request` — the concurrency groups added in 450d5f9 will NOT dedupe those, because `refs/heads/x` and `refs/pull/N/merge` are different refs and therefore different groups.

Options, none obviously right:

- **Suite on push for all branches, drop `pull_request`.** No double, no expiry. Costs a full macOS run on every branch push, including work-in-progress nobody wants tested yet, and loses fork PRs entirely.
- **Keep it as is and make the ABSENCE loud rather than the suite unconditional.** The bug is not that the suite fails to run — it is that nothing says it did not. A required status check, or a gate that refuses a merge when no suite run exists for the head sha, turns a silence into a refusal. Cheapest, and it matches the diagnosis: this whole family is silences that fit two facts.
- **Reduce how often PRs conflict**, by not committing the generated board files — explicitly rejected on `bug-pr-checks-absent` as the wrong turn, since those files are what makes staleness impossible. Recorded here so it is rejected once rather than re-proposed.

**What would settle the choice:** how often a PR here is conflicting at the moment someone wants to read its checks. Two data points so far and both were conflicting, which is suggestive and is not a rate.

**Do not close this on a green PR.** A PR whose checks are present proves nothing about the conflicting case — that is the exact error `bug-pr-checks-absent` was closed with, and this card exists because of it.

INTO REVIEW 2026-09-15, branch `fix/suite-absence-loud`, commit 6b23d27. Unit 1156/1156, typecheck clean, board:check green. **VERIFIED ON A GENUINELY CONFLICTING PULL REQUEST, which this card says is the only verification that counts.**

THE PROBE. Its branches are deleted; the pull request is KEPT ON PURPOSE as https://github.com/vibesyemmy/obsrv/pull/5, retitled from "PROBE ... (throwaway)" to what it demonstrates. GitHub does not let anyone delete a pull request, so the choice was never keep-or-delete — only whether #5 reads as litter or as evidence. It is the one public artefact a stranger can use to confirm this card's central claim, and this week has been a lesson in what happens to evidence kept where nobody can read it. Two throwaway branches off the fix branch changed the same line of a scratch file, and PR #5 was opened from one to the other — a real conflict without moving main. `mergeable=CONFLICTING state=DIRTY`, and `gh pr checks 5` listed:

    A suite run exists for this commit   pending -> fail 3m33s
    The board matches the cards ...      pass 9s
    (no CI check at all)

So the bug reproduced exactly — ci.yml scheduled nothing — and the new check refused rather than said nothing. Both branches and the PR are gone.

HALF ONE, the silence: .github/workflows/suite-answer.yml, `push` on ALL branches, the one trigger a conflict cannot take away. Seconds on ubuntu; the 17-minute macOS suite's schedule is untouched, because the diagnosis was never that the suite fails to run. Opeyemi chose this over making the suite unconditional.

TWO THINGS MEASURED RATHER THAN ASSUMED, either of which would have made it useless. A `pull_request` run is listed against the pull request's HEAD sha, not the merge sha — PR #4's head 1ce283f lists `CI event=pull_request` beside `Board event=push`. And push and pull_request fire together, so a single read would report a race as an absence; it polls for 200 s. A branch with no open PR passes: nobody is reading its checks yet, and a guard that cries wolf stops being one.

HALF TWO, the rot: scripts/knownReds.js + docs/known-reds.txt + `npm run reds:check`, wired into the same always-runs job — the list exists so a reviewer can clear a red WITHOUT the suite, so it must be verified without the suite too. Rows are keyed by test TITLE, never file:line. The check fails when a row names no test, and the refusal blames the list rather than the suite. An empty list is a legitimate state and reads differently from one whose rows all went stale. Six unit tests, driven red first.

NOT DONE, and it is Opeyemi's rather than mine: making this a REQUIRED check is branch protection in GitHub settings. This can fail; it cannot block.

AND THE RATE THIS CARD ASKED FOR IS NOT RECOVERABLE. `gh pr list` reports `mergeable: UNKNOWN` for merged pull requests, so how often a PR here was conflicting when someone wanted to read its checks cannot be reconstructed after the fact. Three data points now (PR #2, Kenya's rebases, PR #5) and all were conflicting, which is suggestive and still is not a rate. Worth recording going forward rather than inventing.

**The sentence above was restored from a commit that never reached main, and the way it got
lost is this card's own subject.** `4bd6ba1`, Opeyemi's, *"Keep the conflict probe's pull
request as evidence, and say so on the card"* — pushed to `fix/suite-absence-loud` AFTER that
branch had already merged. The branch is merged, so nothing watches it; the commit is pushed,
so it looks kept. Main meanwhile said *"THE PROBE, and it is deleted now"*, which was false:
PR #5 exists, deliberately, as the only public artefact a stranger can use to check this card.

A record kept where nobody reads it, on the card about a check that runs where nobody sees it.
Found 2026-09-15 by diffing merged branches against main rather than by anyone noticing.
