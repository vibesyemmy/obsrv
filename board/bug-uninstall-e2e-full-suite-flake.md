---
title: "uninstallRemoveEndToEnd.test.ts: 3 of its 4 tests fail in the full unit suite, pass alone"
column: backlog
kind: bug
release: later
criterion: 
order: 117
---

FOUND BY IDRIS 2026-09-29, gating `#496`. Not a defect in `#496` — reproduced identically on
`main` at `e08b845` (the base `#496` branches from), before any of that PR's code exists.
Filed separately so it doesn't get attributed to whichever PR next happens to trip it.

**The three:**
- "removes exactly what the plan claims, and leaves everything it names as kept"
- "a symlink target inside a removed tree is unlinked, not followed"
- "a generically-named file that does not parse as Obsrv's own survives, and is named"

**Measured, both at `main@e08b845` and at `feat/flow-description@51debb6`, after `npm run build`:**

| run | result |
|---|---|
| `npx vitest run --project unit` (full suite) | these 3 fail, identically, on both commits |
| `npx vitest run tests/unit/uninstallRemoveEndToEnd.test.ts` (alone) | 4/4 pass, on both commits |

Same 3 tests, same file, both commits — so it's the full-suite run itself that trips it, not
anything either commit changed. Vitest's default pool runs test files in parallel; the test's own
description ("against a real, disposable filesystem") is the likely seam — a fixed temp path, or a
process-level value like `HOME`, shared with something else running in the same worker. Not yet
isolated to which neighbor. See [[home-does-not-isolate-electron]] and
[[electron-ignores-home]] for the two already-known ways this repo's tests can leak through `HOME`
rather than the sandbox they think they're in — worth checking first before assuming a new
mechanism.

**Why this matters beyond the one file:** `retries: 1` suite-wide means a green CI run proves
"nothing failed twice," not "nothing failed" (see [[ci-logs-and-local-e2e-traps]]) — so this flake
can pass CI on a lucky retry while still being real. It is exactly the failure class
[[read-the-count-before-the-detail]] warns about: the count, not a single green run, is the
evidence.

**Not blocking `#496`** — unrelated file, unrelated diff, reproduces pre-existing on main.

## RELEASE CLASS 2026-09-29 — `later`

Test-only: three of four tests fail in the full unit suite and pass alone, reproduced on `main` before the PR that tripped it. A suite-ordering fault, no product answer.

## COUNTER-MEASUREMENT, 2026-09-30 by Idris, Henry and Dogu — this card's "identically" does not hold tonight

Filed the original claim myself; correcting it myself. Opeyemi asked the room to "address the bugs,"
and Dogu claimed this card as the one genuinely actionable item (reproduces on demand, unlike the
recurrence-waiters). Before bisecting, three of us independently measured `--project unit` on
`main@8c8a037`, this machine, after a build:

| who | runs | result |
| --- | --- | --- |
| Henry | 3 | 3/3 clean, 1759 passed / 1 skipped each |
| Dogu | 5 | 5/5 clean, same counts |
| Idris | 4 | 4/4 clean, `uninstallRemoveEndToEnd.test.ts` 4/4 green every run |

**12/12 clean, tonight, on this machine.** Henry also reported one failure from earlier the same
night, on the same tree, but did not capture which file — "unconfirmed to even be this test."

**What this does and does not say.** The original measurement (`e08b845`/`51debb6`, "these 3 fail,
identically, on both commits") was real when taken — this is new information beside it, not a
retraction. The two most likely readings: this machine's higher core count schedules vitest's worker
threads differently than CI's `macos-14` runner (`ci.yml:165`; no `poolOptions` override in
`vitest.config.ts`), so the racing neighbor tonight's runs happened not to hit; or the rate was always
lower than "identically" suggested and three-plus-one clean local samples is not yet enough to say it's
gone. **Not concluding either.** Bisecting "which neighbor leaks HOME" against a symptom nobody here
can currently reproduce is the shape [[silence-that-fits-two-facts]] warns about — a control (or a
bisection) that can't fail is not evidence.

**Next, before any fix:** try forcing CI's likely thread count locally (e.g.
`--pool-options.threads.maxThreads=2`, unmeasured) to see whether that alone reproduces it; if not,
this reverts from "actionable now" back to a genuine recurrence-waiter, rarer on this hardware than
the original wording implied.
