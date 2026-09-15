---
title: "CI on main fails about one run in three, from at least three different tests"
column: next
kind: bug
criterion: B5
order: 37
---

**ALL TEN NOW CLASSIFIED, which the card asked for.** Counts over every red run, not a sample:

    live-drive:963     8 of 10        live-drive:1015   8 of 10   — the same eight, always together
    sync.spec:165      5              sync.spec:138     2         — 7 for sync.spec as a file
    devtools:92  2   devtools:116  2   sync-mirror-mark:41  2   stall  2   panes  2
    cli-walk:173, cli-snap-tiled:65, select:54, tabs:266, throttle-live:55, text-scale:251   1 each

**`live-drive:963` and `:1015` are one fault, not two** — Rook's observation, and it holds eight for eight. They never appear apart. Counting them separately makes live-drive read as twice as noisy as it is, and it is already the dominant failure in the suite by a distance: eight of ten reds against sync:165's five.

Henry got this wrong twice before it was right. First by sampling only the first failing test in three of the ten runs and presenting those rows beside seven complete ones, which understated live-drive by three. Then, before that, by a grep that matched the first test in the log rather than the failing one and returned `browser-identity.spec.ts:41` for all seven runs — every row identical was the tell, and it is the same grep trap this project wrote down six hours earlier.

**TWO RUNS ARE A DIFFERENT CLASS.** `735f60f` (six specs) and `b89ec67` (seven) had unrelated specs failing at once — not six independent flakes, one environmental failure taking the run with it. Both contain `devtools:116` and `sync-mirror-mark:41`, which is a shared signature worth chasing. Excluding those two runs makes live-drive MORE dominant, not less: seven of eight, while sync:165 drops to four.

**`sync-mirror-mark.spec.ts:41` fails in both of them**, and that is the file created to fix the sync coupling by splitting a test into its own file. The split moved the problem rather than removing it — so "put it in its own file" is not the remedy for whatever `flake-sync-165` finds.

**Measured 2026-09-14 ~21:50, and it supersedes the single-test framing on `bug-resizing-test-flaky-ci`.** Henry reported "main is red" about one flaky test. It is not one test and it is not occasional.

**Every completed CI run on main since the C5 merge (3f92680), counted:**

    27 runs,  10 failures,  17 successes   —  37% red

    failed: 202d118 c494f7c e921b64 735f60f 6a8cd02 b89ec67 ddb2c72 67c4176 81f139f a1c9050

**At least three distinct tests, sampled rather than assumed:**

    a1c9050   tests/e2e/live-drive.spec.ts:963    the resizing verdict
    b89ec67   tests/e2e/cli-walk.spec.ts:173
    6a8cd02   tests/e2e/devtools.spec.ts:92

Only the first is the one already carded. The other two are unexamined.

**HOW THIS WENT UNNOTICED FOR OVER THREE HOURS, which is the part that matters more than the rate.** Every merge this evening was verified the same way: run the suite locally, read the green, push, report it as verified. Nobody read CI after the push. Several of the failing commits — a1c9050, 81f139f, 284dac2 — touch nothing but board cards and generated docs, so the failures cannot be caused by what was merged, and were visible the whole time to anyone who looked.

Henry stated "typecheck clean, 1121/1121, pushed" repeatedly tonight. Each of those was true and none of them was about CI.

**WHY IT IS THE STRONGEST EVIDENCE FOR `ci-second-host`, not a distraction from it.** The local desk and CI disagree, repeatedly, across at least three unrelated tests. That is the card's thesis demonstrated at scale: one desk cannot tell you whether a result is about the tool or about the machine. B5's repeatability zero was established on the local desk alone and says the tool does not drift; CI says something drifts about a third of the time.

Those are not contradictory — B5 measured fixtures, these are live e2e — but nobody can say which kind of fact they are holding without the comparison `ci-second-host` asks for.

**WHAT THIS CARD ASKS FOR,** and it is deliberately not "fix the flakes":

- The failure for each of the ten runs, classified by test. Ten is small enough to read them all rather than sample three.
- Whether they share a cause — a shared app, a shared budget, host speed — or are three unrelated races that happen to coincide.
- A number for how long this has been true. The window measured here starts at the C5 merge because that is where Henry started looking, which is not evidence it started there.

**AND A GATE QUESTION FOR OPEYEMI, because it is a policy decision rather than an engineering one:** at 37% red, CI currently cannot tell anyone whether a change broke something. A red run means nothing, so a green run means nothing either. Either the flakes get fixed or the suite gets quarantined into "gating" and "informational" — and the second is how a suite quietly stops being a gate while still looking like one.

Related: `bug-resizing-test-flaky-ci` is one instance. `ci-second-host` is the measurement this argues for. `chore-guard` is about greens that mean nothing; this is reds that mean nothing, which is the same disease.
