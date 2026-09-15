---
title: "The e2e suite is not reliable enough to gate merges — counted, not asserted"
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

---

## UPDATED 2026-09-15, later the same day: the tally was understated

This card was filed on two observations. Continuing to read every failure log produced **five**,
and one of them changes the shape of the claim rather than adding to it.

**Three distinct tests defeated `--retries=1`**, not two:

| test | tree it failed on | could that tree cause it? |
|---|---|---|
| `devtools.spec.ts:92` | PR #10 — six regex assertions in `log.spec.ts` | no |
| `stall.spec.ts:42` | `933ccb7` — docs only | no |
| `vision.spec.ts:47` | PR #13 — `.gitignore`, the board script, docs | no |

**And `mcp.spec.ts:137` failed its first attempt in FIVE OF FIVE captured runs**, passing on
retry every time — PR #7, PR #9, main `933ccb7`, PR #10, PR #13. Five independent trees, five
first-attempt failures, five retry rescues.

**That last row is the finding, and it is not a flake.** A test that fails first time in 5 of 5
observations is failing *reliably*. `--retries=1` is not absorbing an occasional race there; it
is **concealing a consistent failure**, and has been doing so on every run anyone has looked at.
Nobody noticed because the suite reports it as green. `1 failed, 3 flaky, 520 passed` is what a
person reads, and the word "flaky" is doing work the evidence does not support.

**One more, and it differs in kind from the rest.** `vision.spec.ts:47` — *"it actually changes
the render, and turning it off restores it"* — failed on a magnitude, not a timeout:
`expected > 295, received 255`. A **14% shortfall**, not a near miss. Every other failure tonight
was a race or a poll; this one is a number that came out wrong. It may be the only one here that
is a rendering defect rather than a scheduling one, and it should not be filed alongside the
others without someone looking at that separately.

## What this changes about the decision

The original claim was *the retry is under-specified for this suite*. The evidence now supports
something stronger and less comfortable: **the e2e suite is not currently reliable enough to
gate merges.** Three retry-defeating failures and a test failing first-time on every observed
run is not a tuning problem.

That matters because `ci.yml` is a required check and `enforce_admins` is on. Every one of those
failures blocked a merge, cost a ~14-minute macOS suite, and could not be overridden by anyone.

**Still deliberately not done, and now for a sharper reason.** No `known-reds` rows — and note
what a row for `mcp.spec:137` would have done: excused, permanently, a test that fails every
time. No change to `--retries` — raising it would hide more of exactly what has just been
found, and the honest move given this evidence is to consider **lowering it to zero** and seeing
what the suite actually reports, which is a different proposal and belongs to whoever takes this.

## A fifth option nobody had raised: stop running the suite on trees that cannot break it

The four options above all try to make the suite more trustworthy. This one reduces how often
its trustworthiness matters, and it is cheaper than any of them.

**`ci.yml` has no paths filter at all** — measured, not assumed: zero `paths:` or `paths-ignore:`
keys in the file. So a pull request changing two words in a markdown card runs the full
~14-minute macOS e2e suite, and is gated by a suite in which one test fails first-time in 5 of 5
observed runs. PR #14 is exactly that: a home-directory redaction in two cards, touching no
source, no tests and no config, waiting on the Electron app to be driven.

`board.yml` already demonstrates the shape — a fast job that runs on everything and does seconds
of work on ubuntu, deliberately kept out of the macOS suite.

**THE TRAP, which is why this is an option and not an obvious fix.** `ci.yml` is now a REQUIRED
check. On GitHub, a workflow skipped by a paths filter does not report at all — and a required
check that never reports leaves the pull request blocked, waiting for an answer that cannot
come. That is precisely the deadlock `bug-suite-absent-on-conflict` measured from the other
direction, and with `enforce_admins` on there is no override.

So this option is not "add `paths-ignore`". It is "add `paths-ignore` **and** a job that always
runs and reports success under the same required check name" — the standard workaround, and one
this repo would be adopting sight-unseen. **Nobody here has tested that GitHub behaves as
described**, and it should be watched refusing and watched passing before it is trusted, on a
throwaway branch rather than on main. PR #5 is the precedent for keeping such a probe as
evidence.

**What it would and would not buy.** It would stop card edits, research write-ups and README
changes paying for a suite they cannot break — which tonight is most of the traffic. It would
not make `mcp.spec:137` pass, would not explain `vision:47`, and would not help a single change
to `src/`. It narrows the blast radius of an unreliable suite; it does not repair it.

**The risk to weigh honestly:** a filter that is too generous ships something untested. `docs/**`
and `board/**` cannot affect the app. `scripts/**`, `package.json`, `.github/**` and anything
under `src/` or `tests/` must never be ignored — and a filter is a list somebody maintains, which
is the kind of thing that is correct when written and wrong six months later. The four options
above fail safe; this one fails open.

## The no-override claim is now measured, not predicted — and it was tested by accident

This card said *a flake blocks a merge and nobody can override it, not me, not an admin*. That
was an inference from what `enforce_admins` does. **On 2026-09-15 it was tested, because this
card's own pull request (#15) was the thing blocked**, and `gh pr merge --admin` was refused:

    GraphQL: Required status check "typecheck · unit · shader parity · e2e"
    is failing. (mergePullRequest)

**`--admin` is not a key.** With `enforce_admins` on, an admin is bound by the rule — that is
what the setting means, and it has no exception for a failing check. The only bypass left is to
turn the setting off, which is a settings change rather than a merge flag.

**What was then done, on Opeyemi's explicit word, and why this way.** `enforce_admins` was
deleted, #15 merged, and the setting restored — two API calls around one merge, each read back
rather than assumed, guard off for about ninety seconds, nothing else merged in the window.

The alternative was re-running the suite until it passed. **A settings change leaves a trace
someone can audit; re-running until green launders the same decision into something that looks
like evidence.** One is an override you can find, the other is one you cannot. That is the part
of this worth copying, and it is the reason to prefer the uglier-looking option.

**The distinction the setting actually buys, now that both halves have been seen:** it removes
the ACCIDENTAL bypass — merging without noticing the suite had not answered, which is exactly
how `main` went red for two hours that morning. It cannot remove the deliberate one and was
never meant to. A deliberate override is named, reasoned, and written down. That one is.

## Two tests failed twice and then passed on an UNCHANGED tree

The strongest evidence here, and it arrived after the card was filed:

| test | failed both attempts on | then passed on | tree changed between? |
|---|---|---|---|
| `devtools.spec.ts:92` | PR #10, first run | the same PR, re-run | no |
| `panes.spec.ts:83` | PR #15 | `main` at `437cdd6` | no |

**`--retries=1` is not under-specified. It is demonstrably insufficient**, and in both cases the
THIRD attempt is the one that told the truth. A retry count that is wrong by one on two
independent tests is not a threshold that needs nudging; it is evidence that the failure mode is
not what a single retry is shaped to absorb.

It also settles the `panes:83` question as far as it can be settled: the override was right in
outcome. What is established is that the tree was not its cause and that it did not reproduce —
not that it is understood.

## The observation layer has the same defect as the thing observed

This card is about CI signals that cannot be trusted. On 2026-09-15 the *watches built to read
those signals* turned out to have the identical fault, and nobody noticed for hours.

**Two background watches ran for 5h27m and 2h06m polling for runs that had already finished.**
Both used `gh run list --commit` with an **abbreviated** SHA — `6f35647`, `78bd4a0` — which
returns **zero rows and exit 0**, forever. The terminate condition read `.[0].status`, which was
always empty, so neither could ever fire. Measured afterwards: short SHA → 0 rows; full SHA →
`completed/success` for both.

**Both runs had in fact succeeded, and both were reported correctly at the time** — because the
answer was fetched by a different query (`gh run list --branch main -L 4`). That is the part
worth keeping. **The instruments were dead and the reports were right**, so nothing surfaced the
failure. Had anything actually depended on those watches, it would have waited forever for an
event that had already happened — which is precisely the `mergeable: UNKNOWN` hang that cost a
session an hour that same morning, arriving in the tooling built to avoid it.

**Why it went unseen: a silent watch and a dead watch are indistinguishable.** Nothing
distinguishes "still running, nothing yet" from "looping on a query that can never match".

### The fix, and the version of it that would actually have caught this

A heartbeat saying `alive` would **not** have caught it. The watch was alive. It was looking at
nothing.

**The heartbeat has to report the size of what it is looking at**, not that it is looking:

```bash
i=0
while true; do
  j=$(gh run list --commit "$(git rev-parse "$REF")" --workflow ci.yml \
        --json status,conclusion 2>/dev/null)
  rows=$(printf '%s' "$j" | jq -r 'length')
  st=$(printf  '%s' "$j" | jq -r '.[0].status // empty')
  cc=$(printf  '%s' "$j" | jq -r '.[0].conclusion // empty')
  if [ "$st" = completed ] && [ -n "$cc" ]; then echo "RESULT: $cc"; break; fi
  i=$((i + 1))
  [ $((i % 10)) -eq 0 ] && echo "alive: poll $i, rows=$rows, status=${st:-none}"
  sleep 45
done
```

`rows=0` on the first heartbeat names the bug immediately. It is the same rule this repo already
keeps for one-shot checks — *make the check report something non-empty about the thing it is
watching, and read that number* — applied to a thing that runs for hours instead of once.

**And use `git rev-parse`, never a short SHA.** That trap is already in `CONTRIBUTING.md`, written
the same morning, by the same session that then walked into it three more times. Writing a trap
down does not stop you walking into it; a heartbeat that prints `rows=0` does.

## CORRECTION: `mcp.spec:137` is not a flake and this card said it was

This card counted `mcp.spec.ts:137` as its centrepiece — *failed first attempt in five of five,
then six, then seven captured runs; a consistent failure being concealed by a retry.* The
concealment was real. **The cause was not what this card implied.**

Its error was finally opened on 2026-09-15:

    McpError: MCP error -32602: Structured content does not match the tool's output schema:
      data/readout must NOT have additional properties

`obsrv_inspect` emits `colorPainted`; the MCP output schema for `readout` does not allow it. A
reproducible product defect, filed as `bug-inspect-readout-schema`, diagnosed to the line.

**So one of this card's strongest data points belongs to a different card, and the honest tally
here is smaller:** three tests defeating the retry on trees that could not cause them, plus one
test that was never a flake at all and was counted four times without anyone reading its message.

**What that says about the method this card recommends.** Counting ✓ against ✘ per test answers
*is this a real failure or a retry rescue*. It answered correctly every time. It cannot answer
*why*, and nothing in the practice prompts the next question — so a reproducible bug sat behind a
green summary line for a day, counted repeatedly, never read.

**A test that fails identically on every run is not flaky. It is reproducible** — the easiest
kind of defect to fix, and the easiest to mistake for noise while a retry keeps rescuing it.
Add to the practice: **when a test recurs in the tally, open its error once.**

## Still not known

The cause of any of the four. Whether they share one. Whether `mcp.spec:137` failing first-time
in 5 of 5 is a defect in the test or in the product — nobody has read it. And the rate for the
other three remains three observations, which is not a rate.
