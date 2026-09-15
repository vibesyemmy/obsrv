---
title: "The e2e suite still vanishes on a conflicting PR, and its absence is silent"
column: next
kind: bug
order: 39
---

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
