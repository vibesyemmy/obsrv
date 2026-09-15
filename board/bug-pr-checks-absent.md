---
title: "A conflicting PR runs no CI at all — and board PRs conflict by design"
column: next
kind: bug
order: 36
---

**THE SENTENCE THAT NAMES THE BUG, Kenya's, and it replaces the framing below.** Not *"a conflicting PR runs nothing"* — that describes a mechanism. What a reviewer experiences is:

> **The PR's CI state silently expires, without anyone touching the PR, and no event says the checks went away.**

A green check from ten minutes ago and no check at all look identical in `gh pr checks` output to anyone not reading an absence. Nothing fires, nothing is marked, and the PR page does not say it used to know something. That is this project's oldest defect — a silence that fits two facts — arriving in the review surface.

Kenya watched it happen three times on PR #1 without touching the branch.

**WHAT CAUSES IT, narrowed — and the narrow version is the useful one.** Kenya first reported that main moving to `43409d6` (a readiness-only commit) had conflicted its branch, and concluded that any commit at all is enough. Checked, and it is not:

    43409d6   docs/readiness.md only          NOT in the PR — cannot conflict it
    178d36c   docs/board.md, docs/board.html  both in the PR — this is what did it

`43409d6` was merely where main's HEAD sat when Kenya looked, which is a different thing from what moved underneath it. Kenya re-checked and agreed, noting it had been wrong *in the direction that made the bug look worse than it is*.

**So only commits touching the generated board files conflict a board-touching branch, and pausing card edits is a REAL mitigation rather than a futile one.** Henry's pause worked; it simply arrived one commit late, `178d36c` having already been pushed when he decided to stop. That matters because the wider version implies nothing helps, and would have argued for abandoning the generated files — which is the wrong turn named at the bottom of this card.

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

**POSITIVE HALF NOW OBSERVED — the diagnosis is confirmed, not inferred.** Kenya rebased PR #1 onto 69de54b, resolved by regenerating (board:check green, 54 cards), force-pushed. Verified independently by Henry after:

    before rebase   mergeable CONFLICTING   refs/pull/1/merge  404        pull_request runs  0
    after rebase    mergeable MERGEABLE     refs/pull/1/merge  af50d6c    pull_request runs  2
                    gh pr checks 1 -> typecheck · unit · shader parity · e2e   pending

So `pull_request` is not broken here and never was. A conflicting PR has no merge ref to run against, and every PR this repository had ever had was conflicting — there being one.

Worth sitting with: the first pull request in the repo's history had to be made mergeable before anyone could observe whether a mechanism the project had been relying on for months existed at all. It did. Nobody knew.

**POSSIBLE FIXES — and the ranking changed once Kenya produced the collision by hand.**

Kenya's interaction finding, which kills the option that looked cheapest: its commit scheduled the sweep TWICE, once from a temporary `push` trigger and once from the `pull_request` paths filter. Two runs of one workflow on one tree. A small waste now, and a confusing artefact later — two `b5-sweep-ci.json` files from a single commit, differing only by desk-identical noise, is exactly the thing someone reads as a repeatability result.

**So "run board:check on push for all branches" is worse than it looked.** It makes that double permanent for every workflow that also runs on pull requests, and this repo's CI runs on both. The cheap fix buys a guard and pays in duplicate runs and duplicate artefacts.

In order, as they stand now:

- **Add a `concurrency:` group keyed on workflow and ref**, then reconsider the push trigger. Deduplication first, coverage second — otherwise the coverage fix creates the artefact problem. This is the standard idiom and it is one block.
- **Accept the gap and rely on the main-push run as the backstop it already is.** Leaves a window where a hand-resolved board sits on main until the next push run, which is usually seconds.
- **Require checks by branch protection**, so a PR with none cannot merge. Needs a rule and a human to hold the line, and it turns this from a silent gap into a visible block.

What NOT to do, because it is the tempting one: nothing here needs the board's generated files to stop being committed. They are what makes staleness impossible, and the conflicts are the price of that, not a defect in it.

Related: `chore-guard` is the card about a green that means nothing. This is an ABSENT green that means nothing, which is the same family and arguably worse — nothing even claims to have checked.
