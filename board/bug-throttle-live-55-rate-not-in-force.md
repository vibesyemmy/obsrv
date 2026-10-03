---
title: "The live throttle menu says a CPU rate is in force while the same work runs at 1.0x, once as a final red on main"
column: backlog
kind: bug
order: 122
---

**Waiting on a recurrence, with an instrument already in place:** `throttle-live.spec.ts:55` failing, and the
`[throttle-live] …` line its failure now prints (state, footer, `debuggerAttached`, and the same work measured again
1500 ms later). Nothing about the class can be decided until that line has been read once.

FOUND 2026-10-03 by Idris in the CI sightings sweep (`#3113`), and it is the one finding there that changes a claim
already on the page.

## What the register says, and what the logs say

`docs/e2e-flakes.md` (the `throttle-live.spec.ts:55` entry) records one assertion, `back / plain < 2`, and says
*"twelve sightings now, all recovered on retry, none ever a final red."* Across 170 `ci.yml` runs since 09-28 the test
failed on **two different assertions**, four times (five failed attempts, because one run lost both):

| run | when | where | assertion | read | outcome |
| --- | --- | --- | --- | --- | --- |
| `36463050844` | 09-28 | PR `feat/flow-tool` | `slow / plain > 3` (`:62`) | **1.02** | rescued |
| `36530455782` | 09-29 | `main` | `back / plain < 2` (`:68`) | 4.34 | rescued |
| **`36599810778`** | 09-29 | **`main`** (the `#516` merge) | `slow / plain > 3` | **0.98, then 1.00 on the retry** | **failed both attempts: a red `main`** |
| `36705363590` | 09-30 | PR `fix/waiting-guard-…` | `back / plain < 2` | 4.21 | rescued |

(Plus the `:48` `beforeAll` sighting the register already names.) **The register's "none ever a final red" is false
for `slow / plain > 3`, and that assertion is not in the register at all.** The entry is left as written, with a dated
correction beside it.

## What the test can and cannot see

Before it measures, the test polls `__obsrv.target.getThrottle().id` and the footer text until each says `cpu-6x`.
**Both are the app's record of what was asked for, not evidence that Chromium applied it:**

- `TargetSource.setThrottle` assigns `this.throttle = profile` **before** `await this.applyThrottle()`
  (`targetSource.ts:864-867`), so the record reads `cpu-6x` while `Emulation.setCPUThrottlingRate` may not have run.
- `ipc.ts:548-556` says so in as many words: a refusal *"is logged, and the footer still states what was asked
  for"*. The footer's `throttle cpu-6x` (`PaneFooter.tsx:150`) is read from the renderer's store.

So "the app said the rate was in force" is better stated as "the app said it had been asked for", which is by design.
That is why a failing `slow / plain` does not by itself say whether the *product* or the *test* was wrong.

## Three readings, none measured

- **A. The test measured before the rate landed.** The polls pass on the record; the debugger command lands later.
  Fits a ratio of ~1.0 and fits `back / plain` reading ~4x as the un-throttle landing late. A test defect.
- **B. The apply was refused or failed, and the footer kept saying it was in force.** `applyThrottle` returns a message,
  `ipc.ts` logs it, and the footer states what was asked for. **That behaviour was decided on purpose** for a throttle
  picked by hand: the done card `bug-throttle-refusal-stderr-only` fixed what a *caller* reads (three CLI commands, `drive`
  and live `snap`) and says of the side-panel menu that it *"still logs a refusal and shows the throttle asked for, which
  the code's own comment calls deliberate."* That decision was about a refusal with a cause outside the product (another
  debugger already attached). **Nothing in CI attaches one**, so a refusal here would have no known cause, and whether the
  deliberate-footer decision still covers it is a question this card raises and does not answer.
- **C. CPU contention on the measurement.** Possible, but the three `slow / plain` reads are **1.02, 0.98 and 1.00**.
  Contention scatters; these sit on 1.0. That is a reason to doubt C, not proof against it.

## Apart from the flaky test: a candidate that holds whichever reading wins

On the live path a refused apply is **only `log.warn`'d**, and the footer keeps showing `throttle cpu-6x`. So the
surface the user reads can state a rate Chromium refused. The done card decided that was deliberate for a refusal caused
by another tool, and this card does not reopen that decision; it records that the question exists on its own, apart from
whether `throttle-live:55` is a race. (Raised by Wren, `#3124`.) It needs a decision, not an instrument: whether a footer
that states what was *asked for* is still acceptable once a user can be wrong about a measurement taken under it.

## Class, by the gate's own test

`docs/release-gate.md` class 1 is *"a wrong answer the caller cannot detect"*, and a reply that is confident about
a state it did not verify counts. **A is a test defect (`later`).** **B is not settled by the earlier card**, which
left the hand-picked path deliberate: it is a footer stating a rate that is not in force, caused by something
unexplained rather than by another tool, and whether that is class 1 is the Lead's call, with Opeyemi to arbitrate. The
instrument below is what separates A from B, so **`release:` is left unset on purpose**: the gate says a bug card with
no value *has not been classified*, and that is true here. Wren flagged it (`#3114`) as one not to default to `later`,
and not to assume class 1 either: contention on both arms would give ~1.0x too.

## The instrument (in the PR that adds this card)

`tests/e2e/throttle-live.spec.ts` now prints, only when one of the two ratio assertions is about to fail, the app's
state and footer, whether the debugger session exists, and **the same work measured again after 1500 ms**. A passing
run is exactly what it was. What the next failing line means:

| the re-measure after 1500 ms | `debuggerAttached` | reading |
| --- | --- | --- |
| the expected ratio (`> 3`, or `< 2` after `none`) | any | **A**: the rate landed late and the poll was early. Make the poll wait for the application, not the record. `later`. |
| still ~1.0 (or still ~4x after `none`) | `false` | **B**: the rate was never applied, or was lifted, while the app said otherwise. Class 1 shape. |
| still ~1.0 | `true` | the command was accepted and had no effect on this measurement. Unexplained; needs the CDP reply, which a test cannot read. |

**Not measured, and said so:** whether the print fires on a failing run (this test failed a first attempt in 4 of 103
suite runs in the window and was a final red in 1, and a green run can only show the passing path is unchanged), and whether the CDP reply to
`setCPUThrottlingRate` would say more than `debuggerAttached` does; that is product code and is not touched here.

## Acceptance

- one failing run's `[throttle-live]` line is read, and the card says which row of the table it was;
- `release:` is set from it;
- if it was **A**, the poll waits for the application and this card closes; if **B**, find what refused (nothing in CI
  attaches a debugger) and decide, with the Lead, whether the footer may still state what was asked for.
