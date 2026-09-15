---
title: "Run the suite on a host unlike this laptop, more than once a release"
column: done
kind: chore
criterion: B5
owner: "Kenya"
---

MERGED 2026-09-15 on Opeyemi's word, as eb9a58b on main. Card left in Review for several hours afterwards — Henry merges and closes as two steps, and skipped the second.

**The criterion is NOT met and this card does not claim it.** The sweep exists and has been run on two desks; what it found is that B5's fixture zero is a property of this laptop. `docs/readiness.md` reads "MET ON ONE DESK, and a second desk disagrees". The remaining work is on the card as the classifier note — the sweep still buckets "a sentence whose only difference is a number of milliseconds" with "a sentence that appeared or did not", which are opposite findings.

THE COMPARISON EXISTS, which is what this card asked for, and it comes out against B5's published number. Five runs a side, same code, same fixtures, same preset:

    this laptop   Apple M4 Pro, 14 cores, 1x ultrawide      result fields moved: 0   182 s
    CI            Apple M1 (Virtual), 3 cores                result fields moved: 3   225 s
                  errors 0 and comparator control passed on both desks
                  1,061 leaves a run, per-case leaf counts identical across desks

Both diverging cases are `grows-as-walked.html`, and the values say two different things.

**A NOTE THAT SOMETIMES DOES NOT FIRE.** On audit, `warnings.length` was 1, 1, 1, **0**, 1 across the five CI runs. The missing one is the page-is-still-moving note: "this page was still moving when it was measured: 40 had been replaced in the 254 ms after the figures were taken". On a 3-core VM that note fires four times in five. This is a real result difference and it is the one that matters: the tool's own warning about an unstable page is itself unstable there.

**A SENTENCE THAT EMBEDS A DURATION.** On lint, the same note fired all five times and its text still differed: 258 ms, 261 ms, 256 ms, 259 ms, 256 ms. Nothing about the page's measurement changed; the sentence quotes an elapsed time. A warning that embeds a duration can never be byte-identical across runs, so any sentence-level comparison flags it forever — on this desk too, if the note fired here at all.

**AND THE DIVERGENCE ITSELF VARIES.** The first CI run moved `pageHeight`, `summary.text.count` and `warnings[0]`; the second moved `warnings.length` and `warnings[0]` on audit and `warnings[0]` on lint. Same desk, same tree, different set. So "4 fields" and "3 fields" are both samples of a range rather than a figure, and the card records both rather than the tidier one.

NEXT, AND DELIBERATELY NOT DONE HERE: the classifier should separate "a sentence whose only difference is an embedded number" from "a sentence that appeared or did not". They are one bucket today, and they are opposite findings — the first is a wording property, the second is the tool answering differently. I did not change it after the numbers were taken, because the committed code should be the code that produced the artefacts on the card.

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

---

NEXT ON THIS CARD: the classifier puts two opposite findings in one bucket.

`scripts/b5-fixture-sweep.js` marks any differing warning string as a moved result field. Two things produce that, and they mean opposite things:

- **A sentence whose only difference is a number.** CI's lint runs all said "this page was still moving when it was measured: 40 had been replaced in the 258 ms after the figures were taken" — with 258, 261, 256, 259, 256. Nothing about the measurement moved. The sentence quotes an elapsed time, so it can never be byte-identical on any desk, and a sentence-level comparison will flag it on every run forever. That is a property of the wording, and the fix if anyone wants one is in the wording, not in the sweep.
- **A sentence that appeared or did not.** CI's audit runs had `warnings.length` 1, 1, 1, 0, 1: the same note, absent once. That is the tool answering differently about the same bytes, and it is the finding this card exists to surface.

The first is noise that will never go away. The second is the result. Today they arrive in one number, so a future run of this sweep reports "3 result fields moved" without saying whether any of it matters, and the person reading it has to open the artefact and diff the values by eye — which is what I did, and is not a thing a weekly job should require.

What I would do: normalise numbers inside a compared sentence, compare the normalised forms, and report three buckets rather than two — identical, same-sentence-different-number, and appeared-or-not. Then a zero in the third bucket is the claim B5 wants to make, and a non-zero in the second is a note to reword.

Deliberately not done while the card was open: changing the classifier after the numbers were taken would have left the committed code different from the code that produced the artefacts the card cites.

*Kenya's words, verbatim, landed by Henry — adding it needed a branch and a pull request, and Kenya had no word from Opeyemi for another one.*
