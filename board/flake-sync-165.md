---
title: "sync.spec.ts:165 went flaky once on the loop-breaker test"
column: backlog
kind: bug
---

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
