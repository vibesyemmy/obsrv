---
title: "CI on main fails about one run in three, from at least three different tests"
column: done
owner: "Henry"
kind: bug
criterion: B5
order: 37
---

## DECIDED 2026-09-16 by Henry: one gate, and the flakes fixed by weight

Engineering decisions are Henry's, Opeyemi said directly. This settles the gate question at the
bottom of this card, which was put to him first.

**Do not split the suite into gating and informational halves.** A split is how a suite quietly
stops being a gate: whatever lands in the informational half stops being read. This week's flakes
were found by reading failures, not by moving them somewhere nobody looks.

**Fix the flakes by weight instead,** from the remeasurement below:
- `mcp.spec:137`, 82 flaky tries, is `bug-inspect-readout-schema` (Rook).
- The `live-drive` cascade, where one failure took ten tests with it, is fixed by #48.
- devtools `:92`/`:116` are fixed by #38.
- `cli-snap-tiled`'s viewport warning, 14 flaky, is `bug-viewport-warning-race`.
- The `panes` blank canvas is `bug-target-canvas-no-frames` (Kenya).

**Re-measure after `mcp:137`'s fix lands**, by the same method: red per first attempt, read from
the logs, a test counted failed only when its retry failed too. **Revisit the split only if `main`
is still above about 10% red over 40 or more runs.** That number is a trigger for deciding again,
not a threshold anything enforces, and it is stated as one.

**What this changes in CI today: nothing.** It is the status quo, now decided on purpose instead of
left by default.

---

**REMEASURED 2026-09-16 by Henry, for the gate question at the bottom, and read cold by Wren
before merge.** The rate since #10 is consistent with most of the 37% having been episodes since
fixed, but 21 runs cannot rule out a rate near it.

Every failed test in every `ci.yml` attempt from 09-13 00:21Z to 09-16 09:46Z: 216 attempts, 189
of which ran the suite, read from the logs. A test counts as **failed** only if its retry failed
too. A first attempt is **red** if Playwright counted a failure or an error sat outside any test.
That is not `gh`'s run `conclusion`, which belongs to a run's *latest* attempt and reads "success"
on a first attempt that failed.

| main, push, first attempts | ran | red | 95% interval (Wilson) |
| --- | --- | --- | --- |
| 09-13 → 09-16 09:46Z | 137 | 37 (27%) | 20–35% |
| since #10 merged, 09-15 10:43Z | 21 | **3 (14%)** | **5–35%** |

All branches since #10: 9 red of 56 (16%, interval 9–28%). Of main's 31 pushes since #10, 21 ran
the suite; **the other 10 were board-only**, each carrying the skip's notice.

- **Most of the 09-13 window's 27% is two episodes:** `log.spec`'s writer tag (12 red main runs,
  fixed by #10) and `live-drive`'s resizing pair `:963`/`:1015` (10 runs; its card is done).
  Neither is among the three since #10.
- **Main's three since #10:** `stall.spec` ×1 (09-15 11:11Z); `controls.spec` ×3 in one run
  (09-15 16:28Z), one root with two cascades as `bug-target-canvas-no-frames` records; and
  `live-drive.spec` ×11 in one run at 09-16 08:34Z (`1c054a7`), **read: one failure and ten
  cascades.** `:776` failed on a black centre pixel in the capture taken *before* the window was
  hidden. Its retry and every later test in the file then failed in 2–5 ms with *"info (the
  control port and token) was never established"*: `info` is set inside the file's first test,
  and Playwright replaces the worker after a failure, so nothing after it can recover. That is
  `bug-live-drive-info-cascade`.
- **Flaky (failed the first try, passed the retry): 273 across all attempts, and one test is 30%
  of them.** `mcp.spec:137` ×82 (`bug-inspect-readout-schema`), sync reversals ×38, `panes`
  failed-load / `sync-mirror-mark` / sync redirect ×15 each, `cli-snap-tiled` viewport ×14
  (`bug-viewport-warning-race`), `throttle-live` ×11.
- **devtools `:92`/`:116` made only one main first attempt red on their own**, so their fix (#38)
  barely moves the rate. It removes a test that could not tell a slow runner from a dropped close.
- **Holes:** three main runs cancelled by the concurrency group (09-15 04:36–04:44Z) are missing
  data in the 09-13 window, not passes; none fall since #10. And failures are counted per test,
  so a cascade inflates the test tallies above without adding a red run.

---

**THE CLASSIFIED LIST BELOW IS ALREADY PARTLY WRONG, measured 2026-09-15.** Three of its rows no longer point at a test — `live-drive.spec.ts:963`, `live-drive.spec.ts:1015` and `sync.spec.ts:165` — because the fixes moved them (to :969, and sync to :185). Hours, not months.

The rows that go stale first are the ones whose tests were FIXED, which are exactly the rows someone would cite to excuse a red as pre-existing. Raised by obsrv-91 as a future risk on `bug-suite-absent-on-conflict`; it was already true when raised.

**Key on the test TITLE, not on `file:line`**, and make something fail when a row stops matching a real test. Same shape and same fix as the stale `EXPLAINED` row in the surface-parity gate.

**THE 37% HAS HOLES IN IT NOW, AND HENRY PUT THEM THERE.** 2026-09-15.

The concurrency groups added in 450d5f9 cancelled three main CI runs — 154c8e3, 5eeb5f8, 4ee2bf9 — within minutes of landing. The guard was written to protect main from exactly that, with a comment above it saying so.

**How it fails is the part to keep:** `cancel-in-progress` only protects a run that is IN PROGRESS. A run still PENDING — queued for a macOS runner, which is most of them here — is cancelled by a newer arrival in the same group whatever the flag says. Three commits pushed in quick succession each killed a queued predecessor.

Fixed by putting the sha in the group on main, so a main run is never in a group with another main run and there is nothing to supersede it.

**Why it belongs on THIS card: a cancelled run is a commit with NO CI answer, which is worse than a red one.** This card is a tally of which commits went red, and a hole in it is indistinguishable from a commit nobody broke — the same two-facts shape the card is about, introduced into the card's own evidence by the person keeping it.

So the 27-run window and the 10 failures stand as measured BEFORE 450d5f9. Any recount that spans it has to treat cancelled runs as missing data rather than as passes.

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
    b89ec67   tests/e2e/cli-walk.spec.ts:173      examined 2026-09-16, see below
    6a8cd02   tests/e2e/devtools.spec.ts:92

Only the first is the one already carded. `devtools:92` is unexamined.

## `cli-walk:173` examined — and it breaks the both-tries rule a second way

EXAMINED BY ROOK 2026-09-16, after Henry described a fresh sighting as *"cli-walk.spec:173 on both
tries, a known flake"*. Those two halves cannot both be true under this board's own rule:
`bug-flakes-gate-the-gate` counts a test as failed only when its `(retry #1)` line is ✘ too,
**precisely so that ✘ on both means deterministic rather than flaky.**

Measured on `main`, gated on a `Running N tests` line so a selector that matched nothing could not
come back as a clean pass:

    :173 alone, three times   1 passed, 1 passed, 1 passed
    the whole file            14 passed

So **not deterministic, and no hidden predecessor** — the two readings that would have made it a real
defect or a tally error. Henry supplied the third fact: attempt 2 of the same CI run went green on
the same head.

**And its one tally sighting is inside `b89ec67`** — which this card already classifies as *"one
environmental failure taking the run with it"*, seven unrelated specs failing at once. Both of its
appearances are therefore consistent with load, and neither with the test.

### What that says about the rule, which matters beyond this row

**The both-tries rule assumes the retry is an independent trial. It is not.** A retry runs seconds
later, on the same machine, under the same load, in a worker the same run replaced. Any cause that
outlives one retry — a saturated runner, a slow disk, another process — fails both attempts
identically and is then recorded as *deterministic*.

So the rule has **two** failure modes, and both were found on 2026-09-16:

- **a hidden predecessor** makes an intermittent test fail its retry every time, because the retry
  runs it alone (`bug-controls-spec-85-needs-its-predecessor`);
- **a condition that outlives the retry** makes an environmental failure look like a property of the
  test, which is this row.

Both directions turn "✘ on both tries" into something it does not mean. The rule is still the best
cheap signal there is — but a both-tries failure wants its **run** looked at before its test, and a
run with unrelated specs failing alongside it is the tell.

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

## Claimed by Henry 2026-09-17, routed by Wren: the remeasurement is due

**The trigger is met:** 115 push runs on main since #82 merged (2026-09-16 15:19Z), 113 of them complete.
Remeasured by this card's method:
- red per **first** attempt, read from the logs, never from `conclusion`;
- a test counts as failed only when its retry failed too;
- runs whose suite was skipped (board-only) are excluded, and cancelled runs count as missing;
- Wilson 95% intervals;
- the parser is checked first against a run whose answer is known.

The split gets revisited only if main is above ~10% red. **The attribution will name tonight's
hidden-predecessor finds** (`panes:83` needing `:77`, and `sync:139`'s early barrier): some of what's
tallied as flakes are test defects that are being fixed.

## REMEASURED 2026-09-17 by Henry: 7% red since #82, so the decision stands

**The window is every `ci.yml` push run on `main` created from #82's merge (2026-09-16 15:19Z) to
2026-09-17 03:43Z**, 115 runs, read by this card's method. The script and its per-run results are in
Henry's scratchpad (`ci_remeasure.py`).
- **Excluded:** 71 board-only runs, whose suite ran only "Say what this run did not do", and 1 run
  still unfinished.
- **Checked first against three runs whose answers were known:**
  - #211's attempt 1: red; `panes:83` failed, `history:72` flaky, 556 passed.
  - 10cd219: green; 557 passed, 1 flaky.
  - #217's merge: skipped.

| main, push, first attempts | ran | red | 95% interval (Wilson) |
| --- | --- | --- | --- |
| since #82, 09-16 15:19Z → 09-17 03:43Z | 43 | **3 (7.0%)** | **2–19%** |

**Below the ~10% trigger, so the split is not revisited, and "one gate, flakes fixed by weight" stands.**
With 43 runs the interval still reaches 19%. The number doesn't say the suite is healthy; it says the
trigger for deciding again hasn't been met.

**The three red first attempts, each read to its first line:**
1. **108e139 (run 35123165259):** `panes.spec:83` failed both tries. **The retry confound is removed by #230;
   whether the first-try failure was genuine is unread.** `:83` never navigated and relied on `:77`, so
   its retry always failed, and any first-try failure became a red run. #230 makes `:83` navigate for
   itself. That removes the confound, not the red: the run stops being red only if a retry that now
   measures a real page would pass, and nobody has measured that. **Not decremented** (Kenya's correction,
   room #358). **SETTLED 2026-09-17 by Kenya: the first try was genuine, so the row stays red.**

       ✓  375  panes.spec.ts:77  the toolbar navigates both panes (258ms)
       ✘  376  panes.spec.ts:83  the target canvas shows the page, not a blank (9.8s)
            Expected: > 1000   Received: 0

   `:77` passed 258 ms earlier, so both panes were on the fixture, and the canvas held **zero** white
   pixels — nothing drawn at all. Same shape as run 35176357601, and `No frames from target renderer`
   appears **0 times** here too, so it is `bug-canvas-blank-without-notice` rather than the card it
   was first filed under.
2. **5e426fb (35145262453):** `ipc.spec` `:31`, `:134` and `:173` failed both tries, in one file with
   nothing else in the run failing. That's `bug-ipc-native-pane-invisible-once`'s shape.
3. **5631606 (35170587213):** no test failed. `text-scale:251`'s relaunch test failed once (drawer width
   288.122px against 309px) and passed on retry. Then **"Worker teardown timeout of 30000ms exceeded"**,
   so the relaunched app didn't close within 30 s. Playwright counts that as an error outside any test,
   which makes the attempt red.

**Flaky by runs, the weight for "fixed by weight"** (a flaky test fails its first try and passes its retry):

| runs | test | status tonight |
| --- | --- | --- |
| 5 | `sync-mirror-mark:41` | **fixed by #213** (a redirect's second address commits twice) |
| 3 | `sync:139` (was `:138`) | **fixing in #224** (Kenya: the barrier read step 1's state) |
| 3 | `tabs:266` image-mode delivery | no card, filed as `chore-flaky-leaders-0917` |
| 3 | `panes:259` failed-load empty state | no card, filed as `chore-flaky-leaders-0917` |
| 3 | `panes:230` failed-load message | no card, filed as `chore-flaky-leaders-0917` |
| 3 | `target-source:106` partial dirty rect | no card, filed as `chore-flaky-leaders-0917` |
| 2 | `vision:47` | on `bug-flakes-gate-the-gate` |
| 1 each | ten more | not weighted |

**What tonight changed in that tally:** the two heaviest, 8 of the flaky tries, were test defects rather
than product races. One of the three red runs was a test defect too. **Before calling a both-tries
failure deterministic, read what the test does for itself.**

