---
title: "The e2e suite is not reliable enough to gate merges — counted, not asserted"
column: doing
kind: bug
owner: "Rook"
waiting: ""
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

---

## READ 2026-09-15 by Kenya, on Opeyemi's word. **The logs are open, and this card's tally is wrong in both directions.**

**It was three unread logs, not four.** `devtools:92` was already read — `bug-devtools-toggle-reopens` carries its error from run `34956013490`.

**`vision:47` is not "a magnitude, not a timeout", and the sentence calling it a possible rendering defect should be struck.** The assertion is `expect(normal[0]).toBeGreaterThan(normal[1]! + 40)`. **`295` is not a threshold anyone chose — it is green + 40.** Red and green both came back 255. The "14% shortfall" was an artefact of how the bound is written.

**But 255/255 does not settle what happened, and the failure message throws away the channel that would.** `middle()` reads all three channels; the assertion compares two. `255,255,255` is a washed-out render; `255,255,0` is the deficiency shader still applied while the button already read `Normal` — the confirm-ahead-of-paint class from pass 4. The uploaded artefacts are `error-context.md` only, with no screenshot, so **from CI's own output the two are indistinguishable.** The assertion now carries all three channels so the next occurrence answers it in its own failure text. `vision:47` is **cause unknown**, and neither "rendering defect" nor "wash-out" belongs on it.

**The retry-defeating tally over-counts cascades.** `controls.spec:85` (`locator.blur` timeout, run `34995218008`) fails to commit `32`; `:109` then reads `hostDiagonalInches` 27 and `:115` reads value "27". **One root, two dependents, three rows** — the `live-drive:963 → :1015` shape.

**And the five failures are at least four mechanisms, not one condition:**

    panes:83        lost WebGL context — the app's own "No frames from target renderer"
                    is in error-context.md. SPLIT OUT as bug-target-canvas-no-frames.
    vision:47       cause unknown; the deciding channel is discarded
    controls:85     one root with two cascades
    stall:42        the app CLOSED: "Target page, context or browser has been closed".
                    No frames notice, no assertion, nothing about the page.
    devtools:92     carded, but the card's central reading has since been withdrawn
                    by its own author (Henry, below) — and its twin :116 is not
                    carded and was never counted here at all

**One correction Kenya made to its own reading, recorded because it is the useful half.** The first pass ruled out a cascade for `vision:47` on the grounds that `Normal` was pressed in the snapshot. The test clicks `.vision-none` on the line before it measures — **so the button state is what the test had just set, not evidence about the shader**, which is precisely the two things confirm-ahead-of-paint says can disagree.

**What this does to the card's decision.** The retry question is not the live one. A retry count cannot be chosen sensibly against four mechanisms, one of which is the product failing (`panes:83`) and one of which is the app closing (`stall:42`). **Neither is a flake, and quarantining either would hide a product event.**

**A blind spot in the counting method, from Henry:** per-test ✘ counting is blind to a run that fails outside any test — PR #18 went red on a worker teardown with zero test failures. Any tally here is a **floor**.

**AND THE EVIDENCE EVERY INVESTIGATION HERE RELIED ON DOES NOT EXIST.** `playwright.config.ts` sets no `trace`, `screenshot` or `video` — Playwright defaults all three to off — so a failing run leaves `error-context.md` and nothing else. `ci.yml:91`, *"Upload Playwright traces on failure"*, has uploaded an empty directory on every red run this week and passed, because uploading nothing succeeds. Rook found it; verified in the tree.

**So "the traces will decide it" was false for the whole of this card's life.** Every reading above — mine included — was of the one file that happens to exist. Where this card says a discriminator is unreadable, the cause is the upload step and not the app, and **no re-reading of past runs recovers it.**

## TALLY CORRECTED 2026-09-16 by Kenya, from Henry's sweep. **Both of this card's devtools rows were wrong, and one test was missing from it entirely.**

Henry swept every CI attempt since `devtools.spec` landed on 09-13 — **334 attempts, 185 ran the
suite, 178 reached the file** — and the numbers change what this card says twice over.

**`devtools.spec.ts:92` — 181 tries, 172 ✓, 9 ✘.** This card called it "already carded" and left
it there. It *is* carded, but the card it points at, `bug-devtools-toggle-reopens`, said the close
poll succeeded and the inspector re-opened. **Henry has withdrawn that: the close poll has never
observed a close, in any run, pass or fail.** Every try took 505–624 ms with a 500 ms sleep inside
it, so the 10 s poll at `:108` finished within ~124 ms every time and read `false` before the
deferred toggles ran — `isDevToolsOpened()` answers for the request, not the window
(`docs/e2e-flakes.md:461`). A real open→close never takes less than 337 ms (178 runs, median 540).
**So the verdict is one sample at +500 ms, and a slow runner and a dropped close both read `true`.**
"Already carded" is therefore not a reason to stop looking: what it was carded *as* is not what
happens.

**`devtools.spec.ts:116` — 181 tries, 9 ✘, never carded and never counted here.** The three-click
test has the same shape and the same failure count as `:92`, and this card has no row for it. Of
the 18 failures across the pair, **4 defeated the retry**, and **10 of the 14 runs carrying one
were on `main`** — so the tests this card exists to count were failing on the protected branch in
a column this card never had.

**This is a second way the tally is a floor**, beside Henry's worker-teardown point above: that one
misses runs that fail outside any test, this one missed a test that nobody had listed. Both are
failures of the *list*, not of the counting — and a per-test tally cannot report a test that is
absent from it.

**Not re-derived here.** The sweep is Henry's (#99); this entry folds it in as he asked, and the
numbers are his. What is Kenya's is the correction to this card's own two rows.

> **Read the section above first.** Kenya corrected this card's devtools rows and found a test
> missing from the list entirely; the pass below is a different cut — the *order* failures came
> in — and it corrects a third thing. They agree and neither supersedes the other.

## READ AGAIN 2026-09-16 by Rook, by FIRST FAILURE — and two of these four were never first

Henry's rule for this pass: **name the first failure in each run before reading anything after
it.** Nine failed runs, `✘` lines in log order (which is the order Playwright completes them):

    stall:42       FIRST in 34924677951
    controls:85    FIRST in 34995218008, with :109 and :115 after it
    vision:47      NEVER first — 34938178928 (mcp-live:743 first), 35099493469 (mcp.spec:137 first)
    panes:83       NEVER first — 35099493469 (mcp.spec:137 first)

**Two of these four have never been observed as the first failure of a run.** That is a real
split and it is the question this card should have been asking: an independent defect and a
casualty of an already-degraded run are different things, and the tally has been counting them
as the same thing. **Nine runs is a small sample and this is a pattern, not a proof.**

The errors, each confirmed from the log rather than from a summary:

    stall:42     electronApplication.evaluate: Target page, context or browser has been closed
                 beside the app's own line: [pid=37639][out] obsrv: closed: sessions down
    controls:85  locator.blur timeout — and :109/:115 read the OLD value after it
    vision:47    Expected > 295, Received 255, at expect(normal[0]).toBeGreaterThan(normal[1]! + 40)
    panes:83     Expected > 1000, Received 0 — zero white pixels

## The four decisions, because none of them stays "open"

**1. `controls:85` — not three retry-defeating tests. One, with two dependents.** Ordering
confirms what Kenya read from the values: `:85` fails first, `:109` and `:115` then read the
stale value. **This card's count of retry-defeating failures is inflated by two.** The root — a
`locator.blur` timeout on a resolved input — is unexplained and is `bug-controls-blur-timeout`.

**2. `stall:42` — the app went away, and that is its own event.** It is first in its run, so
nothing preceding it explains it, and the app's own `closed: sessions down` says the process shut
down rather than the page misbehaving. Not a rendering fault and not a timing threshold. Filed as
`bug-app-closes-under-stall-spec`.

**3. `vision:47` — not a defect on the evidence available, and the instrument has been fixed.**
Kenya established the assertion reads `green + 40` and both channels came back 255; the third
channel, which would separate a wash-out from a shader still applied, was discarded by the
failure message and has since been added. **Nothing further can be decided until it recurs with
the new message.** It has also never been observed first. Left as a note here rather than a card,
because a card whose next action is "wait for it to happen again" is a card nobody can pick up.

**4. `panes:83` — two candidate causes, and my own control could not separate them.** It fails
**4/4 on this machine on current main**, alone, at `--repeat-each=3` plus a single run — which
would refute "only a casualty of a degraded run". **But the control was not clean and I am not
going to present it as one:** 43 Obsrv-related processes were running at the time, including a
live app from run 19, another session's app under `/tmp/obsrv-kenya`, and several MCP servers.
**And the local failure does NOT carry the `No frames from target renderer` line Kenya found in
CI's snapshot.** Same assertion, zero white pixels, no shared signature. So the honest reading is
**two failures that look alike at the assertion**, and the local one is evidence about a
contended machine rather than about `main`. Noted on `bug-target-canvas-no-frames`, which is
Kenya's.

**What would settle it, for whoever has a clean machine:** the same run with no other Obsrv
process alive. I could not do that without killing another session's app and the app on
Opeyemi's desk, which is not mine to do.

### CORRECTED 2026-09-17: the 4/4 was a hidden predecessor, not a contended machine

**Henry found the cause** (recorded on Kenya's `bug-target-canvas-no-frames`, from the `#211` CI
red), and it retires the paragraph above rather than adding to it.

**`panes.spec.ts:83` never navigates.** Reading the file settles it: `:77` — *"the toolbar navigates
both panes"* — fills the URL field and presses Enter, and `:83` only measures the canvas. So `:83`
depends on `:77` having loaded `hairline.html`. **Run alone, or as a retry, it measures the empty
new-tab state and fails every time**, whatever the GPU or the machine is doing.

So my 4/4 was deterministic for a reason that has nothing to do with contention, and the 43 stray
Obsrv processes I was careful to disclose were not the variable — the disclosure was honest and the
inference on top of it was wrong. **It also explains the loose end I flagged and could not place:**
no `No frames from target renderer` line locally, because nothing had asked the renderer for a
frame. I read a missing signature as "two failures that look alike" when it was "one of these is not
the failure at all".

**And it is the second time tonight I have walked into this, which is the part worth keeping.** The
same shape is written up on `bug-controls-spec-85-needs-its-predecessor`, by me, from the same
evidence pattern — a test that fails deterministically alone because a predecessor set up its state,
and a retry that therefore proves nothing about the original failure. Having documented the trap did
not stop me reading a 4/4-alone as a measurement. **The check that would have caught it is cheap and
I did not run it: before treating "fails alone" as evidence, read what the test does for itself.**

**The fix to `:83` — navigating for itself — is Kenya's**, on `bug-target-canvas-no-frames`, and she
is reading this evidence next. Not mine to start.
