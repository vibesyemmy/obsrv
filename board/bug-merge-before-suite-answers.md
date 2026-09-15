---
title: "A green check set can include a suite that has not finished"
column: next
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
