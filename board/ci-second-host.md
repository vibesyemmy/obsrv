---
title: "Run the suite on a host unlike this laptop, more than once a release"
column: doing
kind: chore
criterion: B5
owner: "Kenya"
---

CLAIMED 2026-09-14 evening by Kenya, on Opeyemi's word given in his own session. IN DOING, not Review: the card is done when the COMPARISON EXISTS, and the second desk has not run yet. What exists is the harness that lets it, and one desk's numbers from it.

WHAT IS BUILT.

`scripts/b5-fixture-sweep.js` — the fixture half of the B5 sweep, committed. The original harness was five scratch files, thrown away on the grounds that the method was the thing to keep (docs/research/2026-09-14-b5-repeatability.md, "Reproducing it"). That is true for a method and false for a comparison: two desks cannot be compared unless both ran the same code, so this is the method made runnable rather than described.

It serves every fixture from memory so each run gets byte-identical bytes, runs `audit` and `lint` N times per fixture, flattens each reply to leaves, and classifies anything that moved as timing, path or result. It carries the original's vacuity guard — plant a raised count, a dropped finding and a changed sentence into the saved runs, and fail if the comparator cannot see them.

AND IT RECORDS THE DESK, which the original could not have known to do. `bug-retina` is why: three assertions recorded for two days as "fails on this laptop, passes on CI" turned out to track WHICH MONITOR WAS PLUGGED IN. Two hosts differing only in hardware tell you nothing if neither wrote down its display state. Every report carries CPU, cores, platform, and on macOS the `Resolution` / `UI Looks like` / `Main Display` lines that separate a 1x desk from a 2x one.

`.github/workflows/b5-sweep.yml` — the sweep on macos-14: different silicon, and a display that never moves. That fixed display is why CI is a useful second desk and also why it cannot finish the job — one unchanging desk is a second sample, not a range. Deliberately NOT part of the CI gate: a difference between desks is the result this card asks for, and a result that turns a pull request red is one people learn to route around. It runs weekly, on dispatch, and on a pull request that touches the harness itself — which is also how the first CI number gets taken, since `workflow_dispatch` is only offered for workflows already on the default branch.

THIS DESK, 2026-09-14 (baseline to compare CI against):

    24 cases × 3 runs, preset laptop-768, Apple M4 Pro, 14 cores
    main display 3440x1440, UI Looks like 3440x1440 — a 1x desk
    result fields moved: 0 across 0 cases
    errors: 0    comparator control: saw every planted difference
    1,061 leaves compared per run, 109 s

That 0 agrees with the published fixture number, on the same machine that produced it, which is the weakest possible confirmation and is stated as such. The card turns on what CI answers.

TWO DEFECTS IN THE HARNESS, FOUND BEFORE IT PRODUCED A NUMBER ANYONE COULD USE. Both are on the card because both are the failure this whole criterion is about.

1. THE FIRST SMOKE RUN REPORTED A PERFECT GREEN OVER FOURTEEN CASES THAT HAD ALL FAILED TO LOAD. "result fields moved: 0" and "the comparator saw every planted difference", with every case carrying `load did not finish within 30000 ms` and 30 leaves where a real run has 50-180. Cause: `spawnSync` blocks the event loop that the fixture server runs on, so every run waited out its load budget against a server that could not answer until that run finished. Now async.

   THE PLANTED-DIFFERENCE CONTROL PASSED THROUGHOUT, and was right to: plants go into the saved leaves, so they still differ when every run is equally empty. The control proves the comparator is not blind. It cannot prove there was anything to look at. So there is now a SECOND guard — each run must show it measured the page — and it checks the thing the first one structurally cannot.

2. THE SECOND GUARD THEN OVER-TRIGGERED, discarding `animated-tall` because its reply says "nothing to measure: the page had no visible text and no targets". That is a legitimate case, and in the original sweep five such cases were the STRONGEST result: their explanatory notes were byte-identical across all five runs. Only a load that never arrived makes a run empty of evidence rather than empty of findings.

   Related, and the reason the fixture list changed: the first list was seven structural shapes, and 9 of its 12 valid cases had zero findings — so "0 fields moved" was a statement about 447 leaves, most of them the same four walk counts. Pages that actually produce findings (`audit`, `lint`, `contrast`, `hairline`, `app-shell-findings`) are in the core list now, which took it to 1,061. The original compared 3,375 a run over 33 cases; `--all` widens this one and the gap is honest rather than closed.

WHAT WOULD FINISH THE CARD: the CI run's numbers beside the ones above, both with their desks. A match means B5 survives with two desks behind it. A difference means B5's zero is about this machine, and every before-and-after measured against it inherits that. Done is when the comparison exists, not when it comes out a particular way — and per Henry, B5's zero is his and he would rather have it corrected than kept.
