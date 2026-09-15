---
title: "The resizing verdict is a race the fast desk always wins — 8 of 10 CI reds"
column: doing
kind: bug
owner: "Kenya"
criterion: C5
order: 35
---

ASSIGNED TO KENYA 2026-09-15 on Opeyemi's word. Owner set here rather than by Kenya so it does not need a pull request merely to claim a card — that asymmetry is `bug-pr-checks-absent`'s problem, not this card's.

**THE RATE BELOW IS WRONG. It is not "about 1 run in 4" — it is EIGHT OF TEN.** That figure came from Henry's first count over four runs. All ten of main's reds are now classified (`bug-ci-main-red-37pct`), and `live-drive:963` is in eight of them. It is the most frequent failure in the suite, ahead of `sync.spec:165` at five.

**AND IT HAS A PARTNER IT HAS NEVER BEEN SEEN WITHOUT.** `live-drive:1015` appears in the same eight runs, eight for eight. Rook's observation, and it is a stronger constraint on the cause than either failure alone: this is one fault producing two symptoms, not two flaky tests that happen to agree. Counting them separately makes live-drive read as twice as noisy as it is.

The second symptom is the `info` cascade — `:1015` dies with `TypeError: Cannot read properties of undefined (reading 'token')` because `:963` left the shared app broken. So the second failure names the app when the first is what broke. Rook's `established.ts` in `chore-guard` makes that legible; it does not stop it.

**KENYA'S DIRECTION FOR THE FIX, in its own terms, and it is the reason this is Kenya's card.**

The wrong fix is loosening the assertion to accept either verdict, and the reason is sharper than "it asserts less": `expect(reason).toMatch(/resizing|animating/)` **would pass on a run where the cycle never started** — which is exactly what `expect(applied).toBeGreaterThan(20)` was written to catch. The loosening would un-catch the thing the test already catches.

**Assert the DISCRIMINATOR, not the label.** What distinguishes the two verdicts is whether the pane's viewport was still changing at the budget — a fact the test can measure directly by reading the viewport across the capture, rather than inferring from which branch the settle loop reached first. The label then becomes an observation the test records alongside its margin: how close the loop came to the other verdict.

> A test that asserts the state and records the label survives a faster host; one that asserts the label is asserting a race.

**WHAT THE FAILURE ACTUALLY IS, since it is not a broken provocation.** `expect(applied).toBeGreaterThan(20)` PASSES on the failing runs. The eight-preset cycle really runs; the pane really is being resized. Both labels are true of it — it IS resizing and it IS repainting — and which one `settleTarget` reports depends on which condition it reaches first, which depends on host speed. CI is a three-core VM; this laptop is a 14-core M4 Pro.

So this is the same shape as B5 and the Retina trio: a result about the machine, wearing the costume of a result about the code. Kenya has now met it three times in two days and caught it twice.

**main is RED as of c494f7c.** Found 2026-09-14 by Henry while checking something else — not by anyone watching CI, which is its own finding.

`tests/e2e/live-drive.spec.ts:963` — the test that proved `unsettledReason: 'resizing'` is reachable — fails on CI, and its failure poisons the rest of the file.

    expected  { settled: false, unsettledReason: "resizing"  }
    received  { settled: false, unsettledReason: "animating" }
    at live-drive.spec.ts:1003, both attempts

**It is FLAKY, not broken.** The same test ran and PASSED on three earlier CI runs — 9e95410, bc29277, 4b46a49 — and failed on c494f7c, whose diff is board files and generated docs only and cannot have caused it. One failure in four observed CI runs.

**The vacuity guard held, which is what makes this diagnosable.** `expect(applied).toBeGreaterThan(20)` PASSED, so the eight-preset cycle really did run; the pane was genuinely being resized. The settle loop simply reached `animating` before it reached `resizing`. Without that guard this would look like a cycle that failed to start, and the fix would have been aimed at the wrong thing.

**THE SHAPE, and it is the day's:** a result that is about the machine, presented as a result about the code. `resizing` and `animating` are both true of a pane being cycled through eight viewports — it is resizing AND the page is repainting — and which one the loop reports depends on which condition it hits first, which depends on host speed. Kenya measured 3/3 locally; several CI runs agreed; this one did not.

This does NOT undo Kenya's finding. `resizing` is reachable and has been observed many times. What is not established is that this test *deterministically* provokes it, and the card that claimed it fires said nothing about the margin.

**THE CASCADE, which is the expensive half.** When :963 fails, the next test (`:1015`, the blank-page capture) dies with `TypeError: Cannot read properties of undefined (reading 'token')` — the exact `info` failure Kenya documented and Rook has just written a message for in `chore/suite-guard`. So one flaky test takes the file with it, and the second failure names the app when the cause is the first test. Rook's `established.ts` makes that cascade LEGIBLE; it does not stop it.

**What would settle it,** and the wrong fix is to loosen the assertion to accept either value — that would make the test pass while asserting nothing, which is the defect `chore-guard` exists to prevent:

- Measure the margin, as `flake-sync-165` now asks for its own case: across runs, how close does the settle loop come to the other verdict? A number, available every run.
- Then either make the provocation dominate on any host, or assert the discriminator that actually distinguishes the two — the pane's size changing, which is the thing being tested, rather than the label the loop happened to choose.

Related: `ci-second-host` is the card about exactly this question and Kenya has it open as PR #1. This failure is evidence for that card, arriving before it merged.
