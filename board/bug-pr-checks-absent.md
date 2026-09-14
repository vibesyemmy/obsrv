---
title: "A conflicting PR runs no CI at all — and board PRs conflict by design"
column: next
kind: bug
order: 36
---

Found by Kenya 2026-09-14 on PR #1, the first pull request this repository has ever had. Cause identified by Henry; **the positive half is not yet observed** — see the test below.

**THE OBSERVATION**, Kenya's, checked rather than inferred:

    gh api '...actions/runs?event=pull_request' --jq .total_count   ->  0
    gh api '...actions/runs?event=push'         --jq .total_count   ->  267
    gh pr checks 1                                                  ->  no checks reported

267 runs in this repo's history, every one a push. Actions are enabled, `allowed_actions: all`, and nothing in the repo settings restricts pull requests.

**THE CAUSE, evidenced:** PR #1 is `mergeable: CONFLICTING`, `mergeStateStatus: DIRTY`, and

    gh api repos/vibesyemmy/obsrv/git/ref/pull/1/merge   ->  404 Not Found

`pull_request` workflows run against `refs/pull/N/merge`. GitHub cannot compute that merge commit while the PR conflicts, so there is no ref to run against and no run is scheduled. Not a settings problem; not "PRs are broken here".

**WHY THIS LANDS ON THE BOARD, and it is the part that makes it urgent rather than trivia.** The write path shipped this evening is *edit a card, regenerate, open a pull request*. `docs/board.md` and `docs/board.html` are generated from every card, so **any two branches that touch any card conflict on them once main moves** — that is not an edge case, it is the normal state of a second concurrent contributor. Kenya hit it on c3 within hours.

So `board:check` — the guard whose entire purpose is to stop a hand-resolved board reaching main — **does not run on precisely the pull requests where hand-resolution is possible.** It runs on the clean ones, which did not need it.

**HENRY'S ERROR, recorded because it is the reason nobody looked.** Asked earlier the same evening whether board:check covered PRs, Henry answered: *"ci.yml has a bare `pull_request:` with no branch filter, and board:check is a step in the `test` job, so it runs on every PR. The branch is covered, which is where the conflict happens."* That was read off a trigger line and had never been observed, because no PR had ever existed to observe it on. A check nobody has watched succeed — the same shape as the log that could not be attributed and the grep that returned zero, on the same day, stated as reassurance.

**THE TEST THAT SETTLES THE POSITIVE HALF, not yet run:** rebase a conflicting PR onto main so it becomes mergeable, push, and watch whether checks appear. If they do, the cause above is confirmed and the fix is about conflicts. If they do not, `pull_request` is broken here for some other reason and this card is bigger. Kenya is rebasing PR #1 regardless, so the observation is nearly free — **take the reading rather than assuming the diagnosis.**

**POSSIBLE FIXES, once the cause is confirmed,** in increasing order of how much they change:

- Accept it, and make `board:check` on the main push the backstop it already is. Cheapest, and leaves a window where a hand-resolved board is on main until the next push run.
- Trigger the board check on `push` for all branches rather than only main, so a branch gets checked whether or not its PR can compute a merge ref. Does not depend on PR state at all.
- Treat a PR with no checks as not mergeable by policy, which needs a branch protection rule and a human to hold the line.

Related: `chore-guard` is the card about a green that means nothing. This is an ABSENT green that means nothing, which is the same family and arguably worse — nothing even claims to have checked.
