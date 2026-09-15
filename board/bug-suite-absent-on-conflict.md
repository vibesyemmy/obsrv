---
title: "The e2e suite still vanishes on a conflicting PR, and its absence is silent"
column: next
kind: bug
order: 39
---

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
