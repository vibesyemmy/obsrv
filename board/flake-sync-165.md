---
title: "A genuine navigation mistaken for an echo — sync:165 diagnosed, not fixed"
column: review
kind: bug
owner: "Rook"
---

**FOUND. Branch `fix/sync-loop-margin` (as of f027a74), in Review — 1141/1141 unit, typecheck clean, board:check green. Merging waits on Opeyemi's word to Rook directly.**

**The mechanism: a genuine navigation is mistaken for an echo.** The previous test loads `redirect.html`, which does `location.replace('hairline.html')`. The bus issues that replacement into `target` and records it in `issued['target']`. Normally target's own commit comes back as an echo and RETIRES the record — sometimes that commit does not arrive before the next test starts. `ISSUED_MAX_AGE_MS` is **10 s** while the whole file runs in about **3 s**, so nothing prunes it. The next test's genuine load of hairline.html into target then matches the stale record, `retire()` calls it an echo, and `mirror()` returns **before any URL comparison runs**. Native sits on tall.html until the 5 s poll gives up.

**Two failing traces and two passing ones differ by exactly one line:**

    passing   +2571 native->target issued hairline.html
              +2577 target->native echo   hairline.html   <- retires the record
              +2684 native->target issued tall.html
              +2797 target->native issued hairline.html   <- step 2 mirrors, correct

    failing   +2726 native->target issued hairline.html
                    (the retiring echo never arrives)
              +2838 native->target issued tall.html
              +2952 target->native echo   hairline.html   <- read as an echo, nothing mirrored

**WHAT ROOK HAD WRONG, in its own words and worth keeping.** It expected the stale entry to be swept by step 1's mirror of TALL. It is not — and in the PASSING runs it is not swept either. What saves a passing run is that the record was retired earlier, by its own echo. **So the fault is not a missing sweep; it is a missing echo.** The hypothesis named the right exit for the wrong reason, and only the trace separated those.

Henry's guess — `other.getURL() === url` comparing a superseded URL — was one exit too late: the decision never reaches it.

**THE FIXTURE KNEW.** `tests/fixtures/redirect.html` carries this comment, written long before any of this:

> *Commits this URL, then replaces it: the client-side redirect shape SyncBus must survive without leaving a stale expectation behind.*

It leaves one about 4% of the time. The fixture named exactly what to test for and nothing ever checked it.

**Numbers, replacing every premise this card was written on:** margin 106–111 ms over 28 runs against a 3,000 ms window — a constant cannot explain a 4% event. **4 failures in 113 runs** on an idle fast machine, so not a slow-VM fault; six-core load left step times indistinguishable from idle. The directionality falls out of the previous test driving the native pane — **nothing in the bus is asymmetric, the test order is.**

**NOT FIXED, DELIBERATELY.** Verified: the `syncBus.ts` changes are pure instrumentation — `loopState()`, `mirrorTrace()`, the `MirrorDecision` type, a trips counter. Read-only, no behaviour change. The fix is `bug-stale-issued-echo`, because it is a decision rather than a tidy-up.

Write-up with the reproduction: `docs/research/2026-09-15-sync-165-stale-echo.md`.

**DECISION TRACE BUILT, AND EVERY BRANCH FORCED BEFORE ANY OF IT WAS BELIEVED** — `tests/e2e/sync-trace.spec.ts`, Rook, 2026-09-15. Still hunting: 25 runs with the trace, 0 failures, 60 more running.

**Four of five branches watched firing on purpose:** `issued`, `echo`, `already-there`, `trip`.

**The near-miss is the reason this mattered.** Rook's first attempt at `already-there` did not fire — loading the same URL into the *mirrored* pane is an echo and exits a branch earlier. It only reaches `already-there` when the SOURCE pane reloads: the bus never issued that pane anything, so it is not an echo, and the decision runs on to find the other pane already there. **Had the branch not been forced deliberately, the trace would have shipped with a line that never prints, and its absence would have been read as meaning something.**

**`pane-destroyed` CANNOT be forced, and the spec says so in those words.** Destroying a pane means tearing down the tab session the rest of the file shares — a destroyed pane is a tab that has gone, not a pane sitting idle. So, for anyone reading a trace: **absence of `pane-destroyed` means nothing; absence of the other four means they did not happen.** A known blind spot, named in the instrument rather than left for a reader to trip over.

**The instrument-perturbation risk, flagged by Rook rather than waited for:** `note()` now runs on every mirror, and 25 clean runs against a measured ~7% (2 in 28) is roughly a 1-in-6 coincidence. Not yet evidence the trace moved the fault, and not yet evidence it did not. 60 more runs are what settles it.

**THREE OUTCOMES, AND THE TRACE DECIDES BETWEEN THEM WITHOUT ANYONE ARGUING.** Rook's hypothesis, offered explicitly at the weight the margin hypothesis had an hour before it died:

- `target -> native echo hairline.html` — **Rook is right.** At step 2 the test loads HAIRLINE into `target`; the mirror begins with `retire('target', HAIRLINE, now)`, and HAIRLINE is a URL the bus issued into `target` during the PREVIOUS test, which leaves both panes on hairline.html. A surviving entry makes `retire` return true, the decision takes `echo`, and it returns before any URL comparison runs. Asymmetric for a concrete reason: `native` is the pane whose leftovers get swept, `target` carries a stale HAIRLINE from the test before. It usually does not happen because step 1's mirror of TALL retires everything sent at or before TALL, sweeping the stale entry — so the fault needs that sweep to have missed.
- `already-there` — **Henry's guess is right**, that `other.getURL() === url` compared against a superseded URL or a pane mid-commit.
- `issued`, with native still never moving — **both are wrong and the fault is downstream of the decision entirely**, in the load rather than in the choosing. Rook's note: this is the outcome neither proposed, and it is not the least likely.

**THE MARGIN IS NOT THE MECHANISM. The premise of this card is dead, killed by the first measurement taken against it — 2026-09-15, Rook.**

A readout on the loop breaker's own state (`sync.loopState()`, reads state and changes none), taken at the instant the test starts:

    [loop-margin] sinceLastMirror=107ms  window=3000ms  alternations=0  spare=-2893ms

The test does not survive because the 3 s window expired. It starts **107 ms** in, with 2.9 seconds of the window still to run. It passes because `alternations` is **0** — `syncBus.ts:134` resets the count on any mirror that was not a *bounce*, and a bounce needs `inPage && armed && now - armed < BOUNCE_MS`. Four cross-document loads in a row never bounce, so the count never leaves zero.

**Measured over 28 runs of the file alone, plus three under six-core load:**

    failures         2 of 28   ≈ 7%
    margin at start  106–111 ms, EVERY run, idle and loaded
    step times       9–119 ms across 76 completed steps, against a 5,000 ms budget
    trips            0 on every passing run

- **The margin is a constant, not a variable.** It cannot explain a 7% event: a cause has to vary at least as much as its effect. This is not "unsupported", it is refuted.
- **Load is not the variable either.** Three runs under six busy cores gave step times indistinguishable from idle (11–132 ms). The slow-VM hypothesis was the whole reason `LOOP_WINDOW_MS = 3_000` looked suspect, and this desk reproduces the failure without being slow.
- **A step that normally takes 9–119 ms and occasionally exceeds 5,000 ms is not a slow mirror. It is a mirror that never happened.** Forty times the budget is not contention.

**THE FAILURE IS THE SAME ON BOTH DESKS, AND IT IS DIRECTIONAL.** All five CI reds and Rook's local failure are identical:

    -   "native": ".../fixtures/hairline.html"     expected
    +   "native": ".../fixtures/tall.html"         received
        "target": ".../fixtures/hairline.html"     matched
    Timeout 5000ms exceeded, at sync.spec.ts:182:60

`target` holds the new URL; `native` never follows. Step 2 of four, loading hairline into `target`. Never the reverse pair, never both stale. A symmetric fault would show `native` current and `target` stale on some runs; none do. **The stall is target→native.**

**`navigation mirror loop broken` appears in NONE of the five CI reds**, and `trips=0` on every passing local run. So the breaker is involved in neither the pass nor the failure — and obsrv-a6's remedy, splitting a test into its own file, was treating something that is not the cause. That is now evidence rather than the suspicion recorded lower down.

**WHERE IT STOPS, and why the next step is a different shape of work.** `mirror()` has at least four early exits — echo-retire, a destroyed pane, `other.getURL() === url`, and the trip — and **from outside the bus they are indistinguishable**. That is this project's own defect family in the instrument again: one silence fitting four facts. What would separate them is a decision trace — the last N mirror decisions with the branch each one took, read off a failing run. An instrument, not a fix, and the same move as the `loopState` readout that killed the premise.

**PENDING OPEYEMI'S DECISION.** The work approved was a margin measurement. The margin is measured and is not the mechanism. Continuing into a decision trace is a different scope and Rook has not assumed it.

**Rook's caution about its own evidence, kept because it is the right one:** one local failure is a shape, not a rate. "Identical to CI" rests on a single specimen on its side, and it is still collecting rather than treating 1-of-20 as characterised.

GO-AHEAD FROM OPEYEMI 2026-09-15. Owner set here rather than by Rook so claiming does not cost it a pull request — same reason as on the resizing card.

**THE INSTRUMENT IS NOW A COMPARISON, NOT A NUMBER, and that is better than the card was written for.** There is a desk where the margin is visibly insufficient and one where it is comfortable. `LOOP_WINDOW_MS = 3_000` against a three-core CI VM roughly four times slower than this laptop is a hypothesis with a shape, and it is testable rather than speculative. The failing side is available without waiting for luck — a CI run, or local load enough to stretch the handover past three seconds.

**FREQUENCY, corrected twice and now settled:** `sync.spec.ts:165` is in five of main's ten CI reds, four of them outside the two environmental runs. Second in the suite, behind `live-drive:963`/`:1015` at eight. See `bug-ci-main-red-37pct` for the full classification.

**`sync-mirror-mark.spec.ts:41` FAILS TOO, in both environmental runs** — and that is the file obsrv-a6 created to fix this very coupling by splitting a test into its own file. So the split moved the problem rather than removing it. Whatever this card finds, *"give it its own file"* is not the remedy, and that is now evidence rather than the card's earlier suspicion.

**Rook's own constraint, kept because it is the right one:** it counted Henry's table before accepting the premise from it, and found that `live-drive:963` and `:1015` never appear apart — one fault, two symptoms. The same scepticism applies here: if this card's margin explains `sync:165` but not `sync:138` (two reds, same file), that is a signal they are different faults sharing a file, not one.

**THE PREMISE BELOW IS WRONG AND HENRY WROTE IT.** The card was reshaped from a reproduction hunt into a margin measurement on the grounds that it *"failed once and six consecutive runs were clean"*, so hunting it could honestly end with nothing.

**It is not rare. `sync.spec.ts:165` appears in five of main's ten CI failures** — four outside the two environmental runs. The six clean runs were on this laptop; CI is a three-core VM roughly four times slower. That is `ci-second-host`'s thesis, and Henry failed to apply it to a card written an hour after correcting the identical error elsewhere.

The margin measurement is still the right instrument and is now better founded: there is a desk where the margin is visibly insufficient and one where it is comfortable, so it is a COMPARISON rather than a single number. `LOOP_WINDOW_MS = 3_000` against a machine four times slower is a hypothesis with a shape and is testable rather than speculative. The failing side is available without waiting for luck — a CI run, or local load enough to stretch the handover past three seconds.

And `sync-mirror-mark.spec.ts:41` — the file obsrv-a6 created to fix this by splitting the test out — fails on CI too. The split moved the problem. Whatever this card finds, "give it its own file" is not the remedy.

It is second in frequency rather than first: `live-drive:963`/`:1015` is eight of ten. See `bug-ci-main-red-37pct`.

QUEUED FOR ROOK 2026-09-14 on Opeyemi's word, behind `chore-guard`. Not started.

**RESHAPED FROM A HUNT INTO A MEASUREMENT, because a hunt for this can honestly end with nothing.** It failed once and six consecutive runs were clean afterwards. "Reproduce it" is a done-condition that may never be reachable, and chasing it would burn a session to report an absence — which this project has spent the day learning not to read as evidence.

The constants make a better question available. Read from `src/main/syncBus.ts`:

    LOOP_ALTERNATIONS = 2      two consecutive reversals trips the breaker
    LOOP_WINDOW_MS    = 3_000  ...if they fall inside three seconds
    BOUNCE_MS         = 1_500
    ISSUED_MAX_AGE_MS = 10_000

And `sync.spec.ts:165` is titled *"three navigations back and forth within a second"*. So the test is not near the threshold — **it sits on it**. Three back-and-forth navigations produce two reversals, and two is what trips the breaker. It passes because `alternations` is reset when the gap since `lastMirror` reaches `LOOP_WINDOW_MS` (`syncBus.ts:134`), and it fails when a preceding test's mirror is still inside that window.

**So the measurable question nobody has asked: how much of the 3 s window is left when this test starts, and how does that vary run to run?** That is a number, it exists on every run, and it says how much margin the file actually has rather than whether a rare event recurs.

What would make the card done:

- The gap between the previous mirror and this test's first navigation, sampled across runs. If it clusters just above 3 s, the file is one slow step from red and the split fixed the symptom rather than the coupling.
- Whether that margin is smaller on a loaded machine. The one observed failure came from a FULL-SUITE run; the six clean ones were not. That difference is the most likely cause and it is testable directly — run the file alone, then under load.
- The honest null is a real result: if the margin is large and stable, say so and close it. A number showing comfort is worth more than an unreproduced flake left open.

Context that makes this worth doing rather than shelving: obsrv-a6's remedy for the adjacent failure was moving a test to its own file (`sync-mirror-mark.spec.ts`), not timing the handover. That removed the test that was tipping it over and left the coupling in place, which is why this showed up again without an added test. Anyone adding another test to `sync.spec.ts` inherits this, and nothing in the file says so.

Reported by obsrv-e7 from its full-suite run, 2026-09-14: 'quick legitimate reversals are not a loop' failed once and passed on retry. That is the test obsrv-a6 was working around earlier the same day - a new test dropped into sync.spec made it fail half its runs because the file shares one app and the loop breaker counts reversals within LOOP_WINDOW_MS (3 s); the remedy was moving that test to its own file (sync-mirror-mark.spec.ts), not timing the handover.

So this is the same fragility showing without an added test, which means the shared-app coupling in sync.spec is closer to the edge than the fix implied. Worth knowing before anyone adds another test to that file. Not reproduced by obsrv-a6; six consecutive runs were clean after the split.
