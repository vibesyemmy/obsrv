---
title: "Two e2e flakes defeated the retry in one night, and a flake now blocks every merge"
column: next
kind: bug
order: 34
---

FILED 2026-09-15 by Henry. **Unowned.** This is a measurement and a consequence, not a
diagnosis — nobody has found the cause of either flake, and this card deliberately does not
propose a fix.

## What happened, twice, in one evening

Two different e2e tests failed **both attempts** on CI, each on a tree that cannot have caused
them:

| test | where | tree | outcome |
|---|---|---|---|
| `devtools.spec.ts:92` | PR #10, first run | six regex assertions in `log.spec.ts` | passed on re-run |
| `stall.spec.ts:42` | `933ccb7` on main | **docs only** — `board/b4.md`, `docs/board.*`, `docs/readiness.md` | unexplained |

The second is the decisive one. **`933ccb7` changed no source and no tests.** A source test
failing on it is a flake or an environmental condition by elimination, not by argument.

Both are separate from the night's one *real* red: `log.spec.ts:39/64/76`, which the writer-tag
change genuinely broke and which `86d7fc4` fixed. That one is not part of this card, and is
named here only so a later reader does not fold three unrelated reds into one story.

## Why this is now structural rather than an annoyance

`ci.yml` became a required check tonight, and `enforce_admins` was turned on shortly after. The
combination means:

- a flake **blocks a merge** rather than producing a red anyone can weigh;
- clearing it costs a fresh **~14-minute macOS suite**;
- and **no admin can override it** — that was the point of `enforce_admins`, and it is working
  as designed.

`bug-merge-before-suite-answers` predicted one cost of requiring the check: a conflicting PR
gets no `pull_request` run, so its required check can never arrive. **It did not predict this
one.** Noise now gates the gate, and the same setting that removes the accidental bypass also
removes the deliberate one.

**Two independent instances in one evening is the measurement.** It is not a rate — see below —
but it is enough to say `--retries=1` is under-specified for this suite, because the retry
exists precisely to absorb this class and it absorbed neither.

## What is NOT known, and must not be assumed

- **The cause of either.** `stall.spec.ts:42` is *"a subframe load on a healthy page is not a
  stall"*. A stall is defined by elapsed time, so a loaded runner is the obvious suspect — but
  nothing in that file admits to timing sensitivity, and "obvious suspect" is how the contrast
  figure and the B5 cache confound both went wrong this week.
- **Whether they share a cause.** Two flakes in one night on a busy runner may be one condition
  or two. Nobody has looked.
- **The rate.** Two observations are two observations. `bug-sync138-no-url-changed` is the
  standing lesson: one flake, six clean runs after, and a sizing decision nobody made — the
  interval on a handful of observations is enormous. **Do not start a hunt before someone
  decides how many runs would settle it, and what that costs in macOS minutes.**

## Deliberately not done

- **No rows added to `docs/known-reds.txt`.** That list is empty, which is a legitimate state,
  and its header says a row is for *a reason already understood*. Here only the symptom is.
  Excusing these would convert two open questions into standing permission, on exactly the
  suite that now gates every merge.
- **No change to `--retries=1`.** Raising it would reduce the blocking without anyone learning
  why the tests fail, and a retry count chosen to hide a flake is a threshold set against
  inconvenience rather than against evidence.

## The options, stated so the decision is visible rather than drifted into

Whoever takes this should put the choice to Opeyemi rather than pick: **live with it** and
re-run when it bites; **raise the retry** and accept a quieter suite that hides more; **quarantine**
the two tests behind a known-reds row once a cause is understood; or **fix the flakes**, which is
the only option that does not trade information for convenience and the only one nobody has
costed.
