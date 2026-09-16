---
title: "`controls.spec:85` silently requires the test before it, so every retry of it fails for the wrong reason"
column: doing
kind: bug
owner: "Rook"
waiting: ""
order: 56
---

## Claimed by Rook 2026-09-16, assigned by Henry, as a precondition for `bug-controls-blur-timeout`

Not because I filed it. **Fixing this is what makes the blur bug reproducible at all.** The only
repetition available today is the full local suite at **13.2 minutes** a run, against a failure that
appears in 0 of the last 30 failed CI runs — hopeless. `:85` alone takes **3 seconds** (measured, on
`main` at `9aca3d8`), so the moment it can pass alone, repetition goes from ~4 attempts an hour to
hundreds, and a strategy I had correctly ruled out becomes the obvious one.

**Two caveats, recorded before any loop runs so a clean result cannot be read as more than it is:**

1. **Running `:85` alone is not the same experiment as running it in the file.** Fresh app, fresh
   profile, none of the preceding state — and the hang was only ever seen in a full-file run. **A
   clean loop is therefore weak evidence and exonerates nothing.**
2. **The fix must not make the assertion vacuous.** Establish the precondition *inside* `:85` — enter
   `54` at the top, the way `:71` does — rather than loosening line 97 to accept whatever it finds.
   Loosening it would make the test pass alone and stop it testing anything, which is the same
   defect family as an upload step that could not fail.

FOUND BY ROOK 2026-09-16, while reproducing `bug-controls-blur-timeout` and reading why its retry
failed in 428 ms when the first attempt took the full 30 s. **Unowned.**

## The dependency

`tests/e2e/controls.spec.ts:97`, inside `a field commits on blur or Enter, never on a keystroke`:

```ts
expect(await storedSettings()).toMatchObject({ hostDiagonalInches: 54 })
```

Nothing in that test sets 54. The **previous** test sets it —
`a bigger host diagonal means a smaller magnification` (line 71) ends by entering `54`. The spec
shares one app across the file (`launchApp()` in `beforeAll`), so the value survives between tests
and the assertion passes when the file runs in order.

Run it alone and it cannot pass. A fresh app starts at the default `hostDiagonalInches: 27`
(`src/shared/presets.ts:16`), and line 97 fails immediately.

**Reproduced locally, not inferred**, on `main` at `9aca3d8`:

```
npx playwright test controls.spec.ts --retries=0 -g "a field commits on blur or Enter, never on a keystroke"
```

fails at `controls.spec.ts:97:34` with

```
- Expected  - 1        + Received  + 1
    "hostDiagonalInches": 54,    "hostDiagonalInches": 27,
```

— the same expected/received pair as CI's retry #1 on run `34995218008`.

## Why that matters, beyond tidiness

**Playwright's retry runs the failed test alone in a fresh worker.** So whenever `:85` fails for any
reason, its retry fails again — at line 97, in a few hundred milliseconds, for a reason that has
nothing to do with what went wrong the first time.

Observed on run [`34995218008`](https://github.com/vibesyemmy/obsrv/actions/runs/34995218008):

    ✘ 140  controls.spec.ts:85 › a field commits on blur or Enter…            (30.0s)   ← locator.blur timeout
    ✘ 141  controls.spec.ts:85 › a field commits on blur or Enter… (retry #1) (428ms)   ← hostDiagonalInches: expected 54, received 27

**This corrupts a rule the board relies on.** `bug-flakes-gate-the-gate` reads ✘ on both tries as
"deterministic, not flaky", which is right in general and wrong here: the second ✘ is manufactured
by the retry mechanism meeting this dependency. Any test with a hidden predecessor will read as
deterministic no matter how flaky it actually is, so the tally cannot tell the two apart.

It also **wastes the retry**, which exists to distinguish a flake from a real failure and here can
only ever say "failed".

## The likely blast radius

`:109` (`settings persist through main`) asserts `hostDiagonalInches: 32`, which `:85` leaves, and
`:115` asserts what `:109` leaves. **The whole tail of this file is a chain**, and the same argument
applies to each link. Worth checking the rest of the suite for the same shape rather than fixing
only this one.

## The fix

Make `:85` establish its own precondition — enter `54` at the top of the test, the way `:71` does —
so it passes alone and in order. Same for the other links in the chain.

**Not** by giving up the shared app: that is deliberate and it is what makes the spec fast.

## The control

`npx playwright test controls.spec.ts -g "<the test's name>"` must pass on its own, and the file
must still pass in order. Run each test in the file alone as well, since fixing one link can expose
the next.

**And a second arm, which is the one that matters** (Henry): passing alone is not enough, because
the cheap way to achieve it is to stop asserting anything. **Line 97 must still go red when the
commit does not happen.** Break the commit path deliberately — a variant where blur and Enter never
reach the store — and the test must fail at the assertion rather than pass on whatever value happens
to be there. Without that arm, this fix cannot be told from deleting the check, which is the failure
mode `bug-trace-upload-errors-when-e2e-never-ran` was about.
