---
title: "the scope job took what the base had gained since as the PR's own change, so a one-card PR ran a full macOS suite"
column: doing
kind: chore
release: later
owner: "Dogu"
waiting: "Opeyemi: yes or no before this merges. It widens the board-only skip you wrote in a20bf2f: a board-only PR overtaken by code on main will take the fast path, which is sound only because main's own push suite already tested that code"
order: 134
---

RAISED 2026-10-07 by Idris (room `#4355`) on `#608`: one board card, and the `scope` job printed `touches more than the board: docs/e2e-flakes.md` and took a `macos-14` runner. Henry reproduced it from the scope log (`#4358`), Wren measured that the merge commit's first parent was the current tip (`#4359`), and Idris tried the two proposed fixes on the real merge commits (`#4361`).

## What was wrong

`.github/workflows/ci.yml` diffed `github.event.pull_request.base.sha` against `github.sha`. On a pull request `github.sha` is a **merge commit** of (the base tip, the head), made when the run was created; `base.sha` is the base tip **as the event payload last recorded it**, and a push to a PR after the base had moved leaves it on the old tip. So the diff took in everything the base had gained meanwhile: `#605`'s `docs/e2e-flakes.md` in `#608`'s run. The register check (`register-names-the-shape-change`) had the same line.
The failure direction is the safe one for the scope job (a full suite where a cheap one would do, about 25 macOS minutes). Nothing was skipped wrongly.

## The change

`scripts/ci-base.sh` prints the merge commit's **first parent** for a pull request (the tip this change would land on, so `git diff <it> <merge commit>` is exactly what the change adds), and the event's `before` sha for a push. **It prints nothing unless the commit is a two-parent merge whose second parent is the head the event named**, and both jobs already treat an empty base as "unknown": the full suite, or a notice. That guard is the safety argument. The one way this could go wrong is the dangerous one, a base that makes the diff **smaller** than the change's real size, which would buy a board-only green that tested nothing; a commit that is not that merge never gets a base.

`tests/unit/ciBase.test.ts` builds real merge commits for: the `#608` case (an overtaken board-only PR lists the card only, with the old answer computed beside it so the control differs), a PR with a code file (still listed), a PR that merged `main` in and then touched only a card, the register check with a shape change that only `main` made, and the guards (not a merge, wrong second parent, unknown sha, push event). It also asserts both jobs call the script and neither reads `base.sha`.

## Measured

- **Sabotaged, committed first, restored with `git checkout --`: seven mutants, all caught** (base is the second parent; base is `merge-base(first parent, head)`, the reading that does **not** fix this case; no two-parent guard; no head check; push event prints nothing; scope job reads `base.sha` again; register job loses the call).
- **The real extracted `scope` step from `ci.yml` run on the real merge commits:** `#608` (`6c483f4e`, first parent `58d6e07`) now prints `board_only=true`, changed `board/bug-vision-47-normal-not-red.md`, against the old base listing that card and `docs/e2e-flakes.md`; `#609` (which does touch `docs/e2e-flakes.md`) prints `board_only=false`.

## Not shown

The stale case is only reproduced locally and on the real merge commits; **the workflow itself has not yet run it on a stale payload**, which needs a push to a PR after `main` moves. The PR's own run exercises the ordinary path. **A board-only PR on an overtaking `main` now takes the fast path, and its green says nothing about `main`'s code**; that rests on `main`'s own push suite, as the skip always did. Opeyemi's yes is needed before this merges because it widens a skip he wrote.
