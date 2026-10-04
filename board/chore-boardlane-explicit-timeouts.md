---
title: "boardLane's tests spawn real builds on vitest's 5 s default, and they are the first to fail on a loaded machine"
column: doing
kind: chore
owner: "Dogu"
waiting: "Idris: gate the work PR (a timeout raise is a tolerance change)"
order: 125
---

FOUND 2026-10-04 by Dogu, gating `#549` (heads `e49b4ad` to `500d826`) on the shared dev machine, and raised once `#548` had merged, because the file is `#548`'s and the build is Dogu's. Promised in `#3286`, routed by Wren in `#3330` (raise and claim in one board-only PR; the work is a second PR, gated).

## What is wrong

`tests/unit/boardLane.test.ts` (29 tests) runs the REAL `scripts/build-board.js` in a throwaway git repository, **per test**, through `spawnSync`: a `git init`, one or more commits, sometimes a `git clone`, then the build. None of its tests carries a timeout, and the `unit` project in `vitest.config.ts` sets none, so each runs on vitest's **5 s default**. Unloaded, the whole file takes about 5 to 12 s; under load, any one test can take longer than 5 s on its own, and it fails with a timeout, not an assertion.

## Measured, with the load it was measured at

All on the shared dev machine, every one of them a full `npm run test` unit run unless marked. Load is the 1-minute average at the time.

| when (UTC) | head | load | result |
| --- | --- | --- | --- |
| 4 Oct 10:48 | `e49b4ad` | ~112 | **2 failed**: `allows "Opeyemi: <ask>" on a Backlog card…` at 5,542 ms; `…are named in the board, with links, and in the page data` at 5,436 ms |
| 4 Oct 10:53 | `e49b4ad` | ~111 | **4 failed**, 5,242 to 8,728 ms |
| 4 Oct 11:11 | `500d826` | ~52 | **1 failed**: `allows "Opeyemi: <ask>" on a Backlog card…` at 5,283 ms |
| 4 Oct, clock time not recorded, before 10:55 (Idris; the load is in `#3283`, the head in `#3359`) | `e49b4ad` | ~88 | **1 failed**: `matches on who the line is addressed TO…` at 5,303 ms |
| 4 Oct 10:51 and 11:13, the file alone, twice each | `e49b4ad`, then `500d826` | ~19 to 20, then ~34 to 42 | **29 of 29 pass** every time (with `scrollHostScriptScoping`, 34 of 34) |
| 4 Oct 11:20 | `500d826` | 7 to 13 | **green**, the file in about 10 s |

**In CI it has not failed.** No CI run I or the other gates counted failed on this file. The one red CI attempt on these PRs, `#548`'s first (`37160406685`), was a worker teardown after `tabs.spec.ts:929` with every test passing; on run `37197856918` (`#549`'s last head) the 29 tests took 5.2 s in total on the runner. So this is a **dev-loop** defect, not a CI one, and the change is for the person running the suite on a busy machine. It should not be described as fixing a CI flake.

## What this card is, and is not

- **Is:** an explicit timeout on the tests in `tests/unit/boardLane.test.ts` that talk to a real process, sized for the work they do under load, so the file stops being the first thing that breaks on a busy machine. The same one-line fix Henry applied to `boardServe.test.ts`.
- **Is not:** `scrollHostScriptScoping.test.ts`'s `afterAll` (a 10 s hook timeout that also fails under load). That file is older than this, belongs to nobody who has claimed it, and is out of scope; it stays a separate card if anyone wants it.
- **Is not** a reduction of the load, and does not make any test faster.

## How it will be checked, so the PR is not taken on its word

1. **By count, not by eye.** Henry's own blind find-and-replace for this hit a `spawn` options object and a promise executor, and typecheck caught it twice. The PR states how many tests in the file spawn a process and how many now carry a timeout, **taking the number of tests from vitest's own listing (29)**, not from `grep 'it('`, which gives 27 and misses the two that `it.each` expands to.
2. **Under synthetic load, before and after.** Run the file against a fixed number of CPU burners with the current code (it should fail at the 5 s default, as above) and with the change (it should pass), burners started by PID and killed by PID, none left behind.
3. **It is a tolerance change**, so by the QA-gate section of `CONTRIBUTING.md` it is gated. Idris is expected to gate it. The PR will say what it does not show: no CI run has ever failed on this file.
