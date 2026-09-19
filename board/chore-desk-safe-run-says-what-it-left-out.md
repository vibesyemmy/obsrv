---
title: "A local run excludes the CLI specs and never says so"
column: done
owner: "Kenya"
kind: chore
criterion: C5
order: 98
---

FOUND BY IDRIS 2026-09-17, testing a claim rather than reading it. `#333` marked an acceptance item
met whose own wording promised the specs *"fail with a sentence naming why"* when run without opting
in. They do not. **Split out rather than folded into `#333`** so the fix gets its own review.

## What is actually true today

`playwright.config.ts` excludes `cli*.spec.ts` and `throttle-refused.spec.ts` from a local run unless
`OBSRV_E2E_CLI=1` or `CI` is set. The exclusion works — measured through `playwright test --list`: 455
tests in 56 files locally, 615 in 74 with the opt-in or on CI.

**And it is silent.**
- Targeting one of those files directly gets Playwright's generic *no tests found*, which reads as a
  broken invocation rather than a deliberate exclusion.
- A full local run mentions it nowhere: the count is simply smaller than someone comparing against CI
  would expect, with nothing to explain the difference.

**Why it is silent by construction.** A spec that is *ignored* is never collected, so it has no chance
to explain itself. Only a *collected and skipped* spec can — and skipping 153 tests would trip
`scripts/check-e2e-skips.js`, which exists to fail a green run that skipped a test nobody listed. So
the silence is not an oversight in the exclusion; it is the cost of choosing the mechanism that
defaults to safe.

## Why it matters more than a missing nicety

A person who runs the suite locally, sees it green, and does not know 160 tests were left out has been
handed **a silence that fits two facts** — "the suite passed" and "the suite passed the part of it you
ran". That is the shape this team has spent a week removing from the product, and it is now in the
tooling.

## The fix, and the one trap in it

A line printed once when the exclusion is active: *"CLI specs excluded; `OBSRV_E2E_CLI=1` to include
them"*, via a `globalSetup` in `playwright.config.ts`.

**The trap:** it must print only when the exclusion is actually applied, computed from the same
condition, not from a second copy of it. Two expressions that are supposed to agree are a defect
waiting for one of them to be edited — which is the mistake `MAX_TRIES` and its timeout made earlier
the same evening.

## Acceptance, each with a control

- a local run with nobody opted in prints one line naming the exclusion and the variable that lifts
  it. **Control:** setting `OBSRV_E2E_CLI=1` makes the line disappear, and the run gains the specs;
- the line and the exclusion are computed from **one** expression, so they cannot disagree. **Control:**
  a test that reads both and fails if they are separately defined;
- `check-e2e-skips.js` is unaffected, because nothing new is skipped — only announced.

## CLAIMED BY KENYA 2026-09-19

Routed by Henry in room #715. Building it as one function shared between `playwright.config.ts`'s
`testIgnore` and the printed line, per the card's own trap: two hand-written copies of the CI/opt-in
condition, not one, is exactly the MAX_TRIES/timeout mistake from the same evening.

## DONE 2026-09-19 by Kenya: merged in #379 (`c60a4b9`), each acceptance item against what ran

- **a local run prints one line naming the exclusion and the variable that lifts it.** `cliSpecsGate.ts`'s
  `cliSpecsExcluded()` is the one function `playwright.config.ts`'s `testIgnore` and
  `cliSpecsAnnounce.ts`'s printed line both call, wired in as a `globalSetup`. Verified live, not only
  in isolation: a default `npx playwright test` run printed the line once and passed 6/6.
  **Control:** `OBSRV_E2E_CLI=1` made the line disappear and moved `--list` from 456 tests in 56 files
  to 619 in 74, matching the card's own measured shape;
- **the line and the exclusion are computed from one expression.** `tests/unit/cliSpecsOneExpression.test.ts`
  reads both consumers' source and asserts they import `cliSpecsExcluded` rather than re-deriving it.
  **Control:** a second, hand-written `OBSRV_E2E_CLI` check added to `playwright.config.ts` — one that
  still agreed with the shared function — reds the test;
- **`check-e2e-skips.js` is unaffected.** Structurally: `globalSetup` runs before test collection and
  only calls `console.log`. Checked live against a CI-mode partial run too, not only reasoned: the one
  line it printed was a pre-existing, unrelated scoping artifact from running one file against the
  full-suite manifest.

**Idris's independent re-verification (#379, PASS on `c60a4b9`):** ran both sabotages himself in a
clean worktree rather than trusting mine — the announcer hardcoded to never fire reds 2 of 4 tests, and
a second hand-written `OBSRV_E2E_CLI` read reds the one-expression test (`expected 1 to be +0`) — both
reverted clean. CI (`35444030607`): checked for hidden retry-rescued failures before calling it green —
0 flaky, 0 first-try failures in the log.

