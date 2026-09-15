---
title: "A green check set can include a suite that has not finished"
column: doing
kind: bug
order: 28
---

FILED 2026-09-15 by Henry, from Kenya's observation. **Unowned, and the decision in it is
Opeyemi's rather than a session's** — this card is the observation, not a proposal.

**What happened.** PR #6 merged at 09:13:51Z with `ci.yml` still IN PROGRESS on its head commit.
Every other check was green: the board check, the suite-answer guard, and the fixtures-by-runs
sweep. Nothing prevented the merge, and nothing about the check set said the suite had not
answered.

**Why the guard is not at fault, checked rather than assumed.** Kenya suspected
`suite-answer.yml` of asserting existence while being read as asserting success, went and read
it, and reported that the suspicion was wrong: it scopes itself to existence *in its own
output* — *"The suite was asked about this commit. Whether it passed is ci.yml's answer, not
this one"* — and its failure text distinguishes absence from failure in the terms a misreader
would need. It also prints each run's status, so the in-progress state was visible rather than
hidden. The guard is right.

**The gap is one layer out: nothing gates a merge on `ci.yml`'s answer.** The guard says the
suite was asked; `ci.yml` says whether it passed; a merge can happen between those two. It did.

**Why this is a decision and not a fix.** Making `ci.yml` a required check closes it — and also
makes every conflicting pull request unmergeable until it is rebased, which is exactly the tax
`bug-suite-absent-on-conflict` measured: a `pull_request` workflow runs against
`refs/pull/N/merge`, which GitHub cannot compute while the PR conflicts, so a required check
that cannot be scheduled blocks rather than informs. Those two cards are in tension, and that
tension is the content of the decision rather than an obstacle to it.

**What happened instead, and why it is not a substitute.** The merged tree was verified by hand
before pushing — build first, typecheck across three configs, 1181/1181 unit, `board:check`.
That is a person doing by rote what a required check does by rule, and it works until the night
somebody is tired or in a hurry. Recording it here so the compensation is not mistaken for a
control.

**The shape, for the file it belongs to:** a set of green ticks answers *what has been asked so
far*, not *what has been answered*. A pending check and a check that does not exist look alike
at a glance, and neither is a failure. This is the same family as a guard whose absence is
silent — the card above — arriving at the point of merge instead of the point of scheduling.

**DECIDED 2026-09-15: Opeyemi said make `ci.yml` required, and it is.** Branch protection now
exists on `main` — there was none before this, so every setting below was chosen rather than
inherited, and each is stated because a protection rule nobody can recite is one nobody can
reason about:

    required check : typecheck · unit · shader parity · e2e
    strict         : false   (a PR need not be rebased onto every main push)
    enforce_admins : false
    PR required    : false
    force pushes   : false
    deletions      : false

**Only the suite job is required, and that is not a detail.** `ci.yml`'s other jobs —
`plugin-tag`, `tested-on-main`, `release` — are tag-gated and report as SKIPPED on a pull
request. A skipped required check does not satisfy the rule, so requiring them would have
blocked every pull request permanently, which is a guard that fails closed on everything
including the things it was not aimed at.

**`strict: false` deliberately.** Requiring a branch to be up to date before merging would force
a rebase on every open PR each time `main` moves, and `main` moves on every card edit because
the board is generated into it. That would have made the board itself the thing blocking merges.

## What this does NOT close, stated plainly because the card would otherwise read as finished

**Both merges that prompted this card went in by local merge and direct push to `main`, not by
the pull-request button.** With `enforce_admins: false`, an admin pushing directly is not gated
by a required status check. So the exact route by which #6 merged mid-suite is still open, and
this change closes the PR-button route rather than the one that was actually used.

That is not an argument for flipping `enforce_admins` on. Doing so blocks every direct push to
`main`, which is how every session updates the board, and it would collide head-on with
`bug-suite-absent-on-conflict`: a conflicting PR gets no `pull_request` run at all, so the
required check never arrives and the PR is blocked with nothing to wait for — with no admin able
to clear it. The escape hatch and the hole are the same door.

**What it costs now, which is the tax the card was filed to make visible.** A conflicting pull
request can no longer be merged through the button until it is rebased, because the check it
needs cannot be scheduled. Kenya has been rebasing all night to escape exactly that; it is now
mandatory rather than merely wise.

**Verified, and what was not.** The direct-push path is verified by this commit: it reached
`main` under the new protection, which both proves admins are not gated and demonstrates the
gap above rather than asserting it. **The PR gate itself is UNEXERCISED** — nobody has watched
it refuse a pull request, so by this repo's own standard it is a claim rather than a check until
the next PR tests it. Said here rather than discovered later.
