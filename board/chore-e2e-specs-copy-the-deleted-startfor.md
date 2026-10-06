---
title: "two e2e specs still hold a copy of the `startFor` rule that `#558` deleted, and one of them races its own poll"
column: done
kind: chore
owner: "Idris"
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

**2. A race in `redirect-mirrored-pool.spec.ts:124`.** The loop's last pass (`i = 5`, odd) leaves the target at `hairline`. After the `boundary`, `await expect.poll(targetUrl).toBe(HAIRLINE)` can then be satisfied at once by that old URL, before the redirect has started, and `startsNow()` reads the trace before the redirect's start is recorded. **Observed once**, run `37293811824`, first try ✘ at 1.9 s and retry ✓ at 2.0 s: the failing attempt's pool before the redirect and after it are **identical** (`{total 11, mirrored 5, byDocument 3}` both times, so no new `hairline` start had been recorded); the passing attempt went `{14, 5, 6}` to `{15, 5, 7}`. **That is a reading of the spec's code and its own prints; it is not reproduced, and the run's `error-context.md` was not read.** **The same mistake was made and fixed once already, in a sibling:** `sync.spec.ts:163` to `:170` records that its step-2 barrier "used to poll for `{ native: HAIRLINE, target: HAIRLINE }` — which is ALREADY TRUE when step 2 begins" and now waits "for what step 2 produces, not for the state step 1 left behind". That is independent support for the reading (the pattern exists in this suite and was a real failure there) and the model for the fix here; it is not proof that the pool spec's failure was this.

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

## Done 2026-10-06: `#567` merged as `17433b716`, and what it did and did not show

**Option A for `redirect-mirrored-pool.spec.ts`, retirement (option C) for `redirect-forcing-route.spec.ts`; no `src/` change.** `#567` was gated by Dogu at the head it merged (`c4880e4e8`; the PASS and the counted run `37319268852` are in `#3642`), and merged as `17433b716`: parent 2 is that gated head, the tree equals `git merge-tree` of its parents, and the files are the three the PR named (checked from the objects when it landed). The pool spec now reads the product's own answer from `commitTrace()` (`mirrorTerms.answeredOwnStart`, and `mirroring === false`) instead of a copy of the deleted `startFor` rule; the forcing-route spec, whose premise (pool depth, starts never retired) `#558` removed and whose assertions were a subset of the pool spec's, is deleted, with a dated note in `docs/e2e-flakes.md`.

**Against the four checks this card set:**

1. **The race control.** The URL-only poll with the target's navigation started 600 ms late: fails 3 of 3; the wait for the redirect's own commit: passes 3 of 3 under the same delay.
2. **The copy control.** `answeringStart` ignoring `answered`: the unconverted spec passes 3 of 3 (blind), the converted fails 3 of 3. **The `did-stop-loading` retire-all removed: the unconverted spec passes 3 of 3, the converted one fails in most runs and not all** (10 of 10, then 17 of 20 at `4e71f7ae`, which is code-identical to the merged head (comments only), and 9 of 13 in Dogu's independent set; 36 of 43 pooled), the passes being runs whose pool left no stale unanswered document-initiated start. Dogu's sabotage set also showed the newest-unanswered rule caught in 2 of 3 and **the pre-`#558` rule (skip mirrored starts) seen by neither spec nor the unit harness: not known whether that is equivalence or a gap**.
3. **Sweeps.** Fresh app per run, `--retries=0`: idle 40 of 40, under 24 CPU burners (killed by PID) 60 of 60, on the final code. **The first loaded sweep found a defect in the spec itself** (1 of 30: a mirrored commit still in flight when the boundary was taken, read as the redirect's), fixed by settling the pool before the boundary, two guards that name a setup failure as one, and a straggler control (the earlier version fails 6 of 6, the settled one passes 6 of 6).
4. **Gated and said plainly what it does not show:** the original CI failure (run `37293811824`) was seen once and not reproduced, so a green sweep proves little about it; nothing here is a CI rate; the evidence is one macOS machine, `file://` fixtures, Electron 43.4.1.

**One thing that happened after the move was written, kept here because a Done card should not leave it unsaid:** on 2026-10-06 the delivered pool spec failed a FIRST attempt in CI (run `37394200312`, `#580`'s pull-request run, test 492, rescued by retry #1). Its own printed record is the same shape as `arrivals.spec.ts:218`'s first-try failure: the bus's mirrored `hairline` load arrived 2 ms after the redirect page committed and no document-initiated start was recorded, so the page's own redirect never happened in the target. **Of the 11 CI attempts of that spec I have read, from the PR's own runs onward (`4e71f7a`'s first), 10 passed first try and this one did not.** The local sweeps this card asked for (idle 40 of 40, burners 60 of 60) could not see it, because on a developer machine the target wins the race. This card does not claim it fixed: it is the same trigger as `bug-redirect-note-missing-not-late`'s, and the change that removes it from both specs is separate work.

**Separate from this card:** diagnosing the first-try failure of `arrivals.spec.ts:218` (run `37346121793`) found a race in that test's own premise; that is tracked on `bug-redirect-note-missing-not-late` and `bug-measured-page-is-not-the-asked-page`, not here, and nothing on this card claims it.
