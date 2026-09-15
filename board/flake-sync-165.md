---
title: "sync.spec.ts:165 went flaky once on the loop-breaker test"
column: review
kind: bug
owner: "Rook"
---

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

INTO REVIEW 2026-09-15, branch `fix/sync-loop-margin` off ef5df9d. Write-up: docs/research/2026-09-15-sync-165-stale-echo.md. The margin measurement is done and the answer is that the margin is not the mechanism; the mechanism is now known, reproduced here, and traced.

THE FAULT: a genuine navigation mistaken for an echo. The previous test loads redirect.html, which does location.replace('hairline.html'); the bus issues that replacement into `target` and records it in issued['target']. Normally target's own commit comes back as an echo and RETIRES the record. Sometimes that commit does not arrive before the next test starts — and ISSUED_MAX_AGE_MS is 10 s while the whole file runs in about 3 s, so nothing prunes it. The next test's genuine load of hairline.html into target then matches the stale record, `retire()` calls it an echo, and mirror() returns BEFORE issuing anything to native. Native sits on tall.html until the 5 s poll gives up.

EVIDENCE: two failing traces and two passing ones, differing by exactly one line — the retiring echo (`target->native echo hairline.html`) is present in every pass and absent in every failure, between the redirect's issue and step 1. tests/fixtures/redirect.html's own comment, written long before this, says the shape "SyncBus must survive without leaving a stale expectation behind". It leaves one about 4% of the time.

MEASURED, replacing the card's premises: margin at start 106-111 ms over 28 runs (3,000 ms window, so 2.9 s still to run) — a constant cannot explain a 4% event; 4 failures in 113 runs on an IDLE fast machine, so it is not a slow-VM fault; three runs under six busy cores had step times indistinguishable from idle; trips=0 on every passing run and `navigation mirror loop broken` in none of the five CI reds. Direction (target->native, never the reverse, both desks) falls out of the previous test driving the native pane — nothing in the bus is asymmetric, the test order is.

RULES OUT: the loop breaker, in both the pass and the failure. LOOP_WINDOW_MS being too tight. And splitting the file — sync-mirror-mark.spec.ts was created to fix this coupling by moving a test out and fails on CI too; a stale record inside one bus is not cured by moving a test to another file.

INSTRUMENTS, both of which had to be made honest before being believed: sync.loopState() (reads state, decides nothing) and sync.mirrorTrace() (the last 64 decisions with the branch each took). Four of mirror()'s five branches are forced deliberately in tests/e2e/sync-trace.spec.ts and watched; `pane-destroyed` CANNOT be forced without tearing down the shared tab session, and the spec says so — absence of that branch in a trace means nothing, absence of the other four means they did not happen. Forcing caught a real defect in the instrument: the first attempt at `already-there` never fired, because loading the same URL into the MIRRORED pane is an echo and exits a branch earlier.

NOT FIXED, deliberately: this card was to measure, and the fix changes behaviour the rest of the bus depends on. Three candidates, argued on the write-up: retire on any new document rather than only on an echo (moving `issued[from].clear()` above the echo check, which also changes what echo means for a superseded load — see the 252-load loop of 2026-09-03); bound the record's age to something shorter than a test file (10 s today, 1-2 s would do, smallest and least principled); or make the record identify the load rather than the URL (most correct, largest). Whoever takes that should pick with the 2026-09-03 history in front of them.
