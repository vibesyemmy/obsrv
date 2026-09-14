---
title: "main is red: the resizing test gets 'animating' on CI, about 1 run in 4"
column: next
kind: bug
criterion: C5
order: 35
---

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
