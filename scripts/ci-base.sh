#!/usr/bin/env bash
# The commit a CI check should diff `github.sha` against, to answer "what does THIS CHANGE touch".
#
# usage: ci-base.sh <event name> <github.sha> <pull request head sha> <push event's before sha>
#
# Prints the commit, or NOTHING when it cannot say: the callers read nothing as "base unknown",
# and for them that means the full suite or a notice, never a quiet pass.
#
# On a pull request `github.sha` is a MERGE COMMIT of (the base branch's tip, the PR head), made
# when the run was created. Its first parent is therefore the tip this change would land on, and
# `git diff <first parent> <merge commit>` is exactly what the change adds to that tip.
#
# What this replaces was `github.event.pull_request.base.sha`, the base tip as the event payload
# last recorded it. A push to a PR after the base had moved (#608, 2026-10-07: `main` gained
# `docs/e2e-flakes.md` from #605 between the branch being cut and the push) left that field on
# the OLD tip, so the diff took in everything the base had gained meanwhile and a one-card PR
# looked like it touched more than the board.
#
# The one way this could go WRONG is the dangerous one: a base that makes the diff SMALLER than the
# change's real size, which would buy a board-only green that tested nothing. So it says nothing
# unless the commit is a two-parent merge whose second parent is the PR head it was told about.
set -u
event="${1:-}"
sha="${2:-}"
head="${3:-}"
before="${4:-}"

if [ "$event" != "pull_request" ]; then
  printf '%s' "$before"
  exit 0
fi

[ -n "$sha" ] || exit 0
line=$(git rev-list --parents -n 1 "$sha" 2>/dev/null) || exit 0
# shellcheck disable=SC2086
set -- $line
# $1 is the commit, $2 and $3 are its parents; anything else is not the merge this assumes.
[ "$#" -eq 3 ] || exit 0
if [ -n "$head" ] && [ "$3" != "$head" ]; then
  exit 0
fi
printf '%s' "$2"
