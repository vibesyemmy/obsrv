---
title: "the scope job took what the base had gained since as the PR's own change, so a one-card PR ran a full macOS suite"
column: done
kind: chore
release: later
owner: "Dogu"
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

The stale case is only reproduced locally and on the real merge commits; **the workflow itself has not yet run it on a stale payload**, which needs a push to a PR after `main` moves. The PR's own run exercises the ordinary path. **A board-only PR on an overtaking `main` now takes the fast path, and its green says nothing about `main`'s code**; that rests on `main`'s own push suite, as the skip always did. Opeyemi's yes is needed before this merges because it widens a skip Opeyemi wrote.

## MERGED 2026-10-12 as `#610`, and the yes/no this card waited on was answered

Opeyemi answered the hold in the room (`#4651`, to Henry): *"you shouldn't wait for me to merge."* Henry merged
`#610` at 11:32:29Z as `d32fb87acb5e6c60d0d4892ae8bbda2cad47c349` (parents `1a5aa274…`, then the PASSed head
`be1d8570…`), and counted its suite and main's push suite green (`#4652`, `#4667`). `ci.yml` calls
`scripts/ci-base.sh` on `main`.

**Still not shown, and it stays that way for this card:** the workflow has not yet run the stale case, a push to a
PR after `main` moved (Henry, `#4689`). A re-run does not show it, because it replays the same `github.sha`
(`#4685`). The case will show itself on the first PR that is opened before a merge and pushed after one. Read its
`scope` job's `changed files:` list then. A throwaway PR to force the case was parked on 2026-10-12, along with the
rest of the flake and CI forensics.
