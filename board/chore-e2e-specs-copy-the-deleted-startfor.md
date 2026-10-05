---
title: "two e2e specs still hold a copy of the `startFor` rule that `#558` deleted, and one of them races its own poll"
column: doing
kind: chore
owner: "Idris"
waiting: ""
release: later
order: 130
---

FOUND 2026-10-05 by Idris, reading run `37293811824` (`#560`'s pull-request run) after gating `#558`, and routed by Wren in `#3457`. **My gate of `#558` searched `src/` and the unit tests for the rule it deleted and did not search the e2e specs; this card is the part that search missed.**

## What is wrong

**1. A copy of a deleted rule.** `tests/e2e/redirect-mirrored-pool.spec.ts:157` and `tests/e2e/redirect-forcing-route.spec.ts:135` both compute

```
const matched = [...after].reverse().find(s => s.url === HAIRLINE && !s.mirrored)
```

with the comment "the same find `startFor` does, on the same data". **`startFor` no longer exists in `src/`** (`#558` replaced it with `answeringStart`, which takes the OLDEST UNANSWERED start and marks it). So since `d794228` those two specs assert a property of the **recorded trace** (the newest non-mirrored start of the address is after the boundary), not of **the start the product answered a commit with**, and their names ("still answers a redirect with that redirect's start") claim more than they check. This is the shape `mirrorTerms.test.ts` had before `#558` removed its oracle copy: a test that agrees with its own copy of the rule.

**Their headers describe a mechanism that is gone.** `redirect-mirrored-pool.spec.ts:18` cites `startFor` "skips mirrored starts (`targetSource.ts:1064`)", a line that no longer exists; `redirect-forcing-route.spec.ts:13` to `:28` explains the whole route in terms of `startFor(url)` and "starts are **never retired**", **both false since `#558`** (a start is now answered once, by its commit, by `did-fail-load` or by `did-stop-loading`). **And both routes were built to force a candidate mechanism that `bug-redirect-note-missing-not-late` first records as refuted (2026-09-29, "BOTH FORCING ROUTES ARE BUILT, AND BOTH REFUTE THE MECHANISM THIS CARD NAMED") and then corrects as true of pool depth only (2026-10-02, "CORRECTION")**; the fix that landed was a different mechanism, so what each route still pins deserves asking, not assuming.

**2. A race in `redirect-mirrored-pool.spec.ts:124`.** The loop's last pass (`i = 5`, odd) leaves the target at `hairline`. After the `boundary`, `await expect.poll(targetUrl).toBe(HAIRLINE)` can then be satisfied at once by that old URL, before the redirect has started, and `startsNow()` reads the trace before the redirect's start is recorded. **Observed once**, run `37293811824`, first try ✘ at 1.9 s and retry ✓ at 2.0 s: the failing attempt's pool before the redirect and after it are **identical** (`{total 11, mirrored 5, byDocument 3}` both times, so no new `hairline` start had been recorded); the passing attempt went `{14, 5, 6}` to `{15, 5, 7}`. **That is a reading of the spec's code and its own prints; it is not reproduced, and the run's `error-context.md` was not read.**

## What it is not

**Not a regression from `#558`.** `#558` changed start RECORDING only by adding `answered: false` (checked by diffing `targetSource.ts` before and after: `at`, `url`, `byDocument`, `mirrored` and `fromBusDocument` are unchanged), and the failing assertion reads recorded data. **The history does not say otherwise either:** no first-attempt failure for this test in the 29 pre-`#558` CI logs the gate holds, one in the 4 suites since; if the one failure were uniform over those 33 it would land among the last four 12 percent of the time, so it is not evidence of a regression. **Not a prerequisite for the release** (`release: later`), and not part of acceptance (d) of `bug-redirect-note-missing-not-late`, which counts `arrivals.spec.ts:218` only.

## What will be done, and the choice that is open

Both specs get fixed in one change, with the poll race:

- **Option A, make them read the product's own answer:** the commit trace (`TargetSource.commitTrace()`, which `arrivals.spec.ts` already reads) records `mirrorTerms` per commit; recording the `at` of the start each commit answered beside it would let the specs assert on the product's choice, not a copy of it. It adds a field to a trace in `src/`, so it is gated.
- **Option B, rename them to what they check** (the recorded trace, per start), correct the headers, keep them as real-Chromium forcing routes for the composition of the pool, and leave "which start did the product answer" to `tests/unit/targetSourceMirror.test.ts`, which now asserts it through the real class (R4, G, H1b, and the eight before them).
- **Option C, retire one or both** if, once the headers are read against what `#558` changed, neither pins anything the unit harness and `arrivals.spec.ts` do not. **Retiring a spec that was a control is a gated removal and the PR must say what coverage it drops.**
- **My lean is B** for being smaller and not touching `src/`, **but A is the better test, C may be right for the older route, and the choice is the work PR's to argue, with Dogu gating it**; this card does not settle it.
- **The poll race is fixed either way:** the wait must be for the redirect's own start to be RECORDED after the boundary (or the loop must leave the target somewhere the poll cannot already be satisfied by), not for a URL the target may already hold.

## How it will be checked, so the PR is not taken on its word

1. **A control for the race:** the fix must fail a sabotaged version that reintroduces the early poll (leave the target at `hairline`, wait on the URL alone), run with fresh apps and no retries.
2. **A control for the copy:** after the change, a sabotage of `answeringStart` (take the NEWEST unanswered start) must fail the specs under option A, or the names must say what they check under option B. The PR states which.
3. **`--repeat-each` fresh-app runs on both specs, idle and under bounded PID-killed load, with the pool-shape floors still asserted.** It will say plainly that the original failure was seen once and not reproduced, so a green sweep proves little about the race.
4. **It is a test change, so it is gated** (Dogu); it will say what it does not show.
