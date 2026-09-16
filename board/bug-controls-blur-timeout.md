---
title: "`controls.spec:85`: `locator.blur` times out on a resolved input, and two tests then read the stale value"
column: doing
kind: bug
owner: "Rook"
waiting: ""
order: 50
---

FOUND BY KENYA 2026-09-16 from the values; **ordering confirmed by Rook the same day** from the
log's own failure order. **Claimed by Rook 2026-09-16**, assigned by Henry. Split out of
`bug-flakes-gate-the-gate`.

## Claim note: every measurement on this card predates `e37caa7`

The three candidate roots below were all formed against a tree in which the app under the harness
could become key. **`#105` changed that**: under the harness the overlay no longer calls
`webContents.focus()`, windows use `showInactive()`, and `drive`'s `focus: true` runs only on CI or
with `OBSRV_E2E_FRONT=1`. So run `34995218008` describes a world that no longer exists, and
**re-measuring on a rebased tree comes before any theory.**

**One concurrency hypothesis is already dead.** `playwright.config.ts` sets `workers: 1` and
`fullyParallel: false` **unconditionally** — not gated on CI — so there has only ever been one
worker, on CI and on a desk alike. "Another worker's launch stole key mid-test" was never available
as a cause anywhere. Before `#105`, the only ways a harness window lost key within its own worker
were a second app in the same spec, detached DevTools, or the overlay moving focus between views of
one window (Henry).

**One data point from after the change, and it is only that** (Henry, recorded local full run on
`#105`'s branch): `:85`, `:109` and `:115` all passed on the first attempt, 545 expected, 0 flaky,
with no window ever key. So a non-key window does **not** fail `:85` every time. Nothing there says
it never does.

### How this gets run

1. **Rebase onto main first.** Before the rebase a local run still fronts the app, which is the
   whole reason this card was headed for CI.
2. **Establish the repro before believing any green**, per the vacuity check below.
3. **Tell "gone" from "rarer"** with enough repeats that a survivor at low frequency cannot pass for
   a fix. A timeout that merely became rarer is the worse outcome: it returns as a flake nobody can
   place.
4. **Name the cause rather than correlate with it**, using `OBSRV_TEST_TAKES_THE_DESK=1` from
   `bug-overlay-focus-handoff-untested` once that merges — it launches the app under the harness with
   `show()` and real focus, i.e. the pre-`#105` state. **That control takes the desk by design**, so
   it needs Opeyemi's word before it runs on his machine; "local e2e is allowed" was about desk-safe
   runs and does not cover it.

## One failure, two dependents, three rows in the tally

Run `34995218008`, in log order:

    controls.spec:85    locator.blur: Timeout 30000ms exceeded   ← FIRST
    controls.spec:109   expected hostDiagonalInches 32, received 27
    controls.spec:115   expected value "32", received "27"

`:85` fails to commit `32`; `:109` and `:115` then read the value that was there before. **The
flake card counted three retry-defeating failures. There is one**, and its two dependents are the
`live-drive:963 → :1015` shape this board has already named once.

## The root, which is unexplained

`locator.blur` timing out against an input Playwright had already **resolved** is not a missing
element or a slow page — the handle exists and the call does not return. Candidates nobody has
tested: the element is resolved but not focusable at that moment; the blur is dispatched into a
window that is not key (`focusWindow` is refused on macOS 14+ unless the front app yields, which
is the OS and is already on record); or the commit path the field uses does not run without a
real focus change.

## READ THIS BEFORE REPRODUCING: `:85` cannot pass alone, for a reason unrelated to the blur

Found by Rook 2026-09-16 from run `34995218008`'s own log and artefact, after claiming the card.
**It invalidates the obvious way to reproduce this**, which is the way I was about to take.

The two attempts in that run failed **differently**, and only the first is this card's bug:

| attempt | where | what |
| --- | --- | --- |
| first | line **99**, `await field.blur()` | `locator.blur: Timeout 30000ms exceeded` (30.0 s) |
| retry #1 | line **97**, the assertion *before* it | `hostDiagonalInches` expected 54, **received 27** (428 ms) |

**The retry never reached the blur.** Line 97 asserts `hostDiagonalInches: 54`, and nothing in
`:85` sets 54 — the *previous* test does (`a bigger host diagonal means a smaller magnification`,
line 71, which ends on 54). A retry runs the failed test alone in a fresh worker, that worker
launches a fresh app, and a fresh app has the default: **27**, from `src/shared/presets.ts:16`.
So `:85` run alone fails at line 97 every time, deterministically, and it always would have.

Three consequences:

1. **`-g` on `:85` alone cannot reproduce this bug.** It fails 428 ms in, at a different line, for
   a different reason. Anyone who runs it that way and sees red will think they have the repro.
   That is the false positive this note exists to prevent — and it is **measured, not predicted**:
   run locally on `main` at `9aca3d8`, `-g "a field commits on blur or Enter, never on a keystroke"`
   fails at `controls.spec.ts:97:34` with expected 54, received 27 — the same pair CI's retry got.
2. **"Failed both tries" does not mean what the board's rule usually means here.** The rule —
   `bug-flakes-gate-the-gate`'s, and it is a good rule — reads ✘ on both tries as *deterministic,
   not flaky*. In this case the second ✘ is manufactured by the retry mechanism meeting a
   test-order dependency, so it says nothing about whether the blur timeout is deterministic. The
   blur failure has been seen **once**.
3. **The test-order dependency is a defect in its own right**, independent of the blur. A test that
   silently requires its predecessor is one reordering away from failing for a reason nobody will
   connect to the change that caused it. Worth its own card; not this one's to fix.

## What is known about the timeout itself

- **Playwright's `locator.blur()` is not a plain DOM call.** In `playwright-core`'s bundle it is
  `frame.blur()` → `_retryWithProgressIfNotConnected(… handle._blur())`, and `_blur` is
  `evaluateInUtility(([injected, node]) => injected.blurNode(node))`. So the timeout is an
  **`evaluate` that never returned**, not a missing element.
- **The call log shows one resolution and then silence** — `locator resolved to <input … class="host-diagonal num"/>`, nothing after. A spinning `_retryWithProgressIfNotConnected` would have
  re-queried and said so. That points at the evaluate itself hanging rather than at the retry loop,
  though it does not prove it.
- **A synchronous IPC in the blur→commit path is ruled out:** `sendSync` appears nowhere in `src/`.
  `onBlur` calls `commit()`, which is plain arithmetic plus `onCommit`.
- **There is no page snapshot to inspect.** The artefact holds only `error-context.md` — the run
  predates the `trace` setting doing anything useful — so what the DOM looked like at the moment of
  the hang is not recorded. See `bug-no-traces-when-e2e-hangs` for the related gap.

## How rare it is

`locator.blur` appears **zero** times in the last 30 failed CI runs. The detector was validated
against `34995218008` first, where it correctly finds one — a sweep that has never seen a positive
is worth nothing until you show it can produce one.

So **repetition alone is not a viable strategy**: at this rate a local loop would need to be very
long to expect a single hit, and a green run of any length says almost nothing.

## The focus experiment, and why its answer is worth nothing — 2026-09-16

[Run `35142312962`](https://github.com/vibesyemmy/obsrv/actions/runs/35142312962), on CI, two arms of
75 chain runs (`:53 :71 :85` in one worker, file order), one as the harness runs today and one with
`OBSRV_TEST_TAKES_THE_DESK=1` restoring the pre-`#105` focus:

    no-flag      75 requested, 75 actually ran 3 tests, 0 gate failures — blur=0
    takes-desk   75 requested, 75 actually ran 3 tests, 0 gate failures — blur=0

The gate held: every one of the 150 iterations really ran its three tests, so this is not a sweep
that measured nothing.

**And it still says nothing about focus, because I sized it wrong.** The failure has been seen once
in the workflow's ~591 runs. At that rate:

| runs | expected sightings | P(see zero) |
| --- | --- | --- |
| 75 (one arm) | 0.13 | **88%** |
| 150 (both) | 0.25 | 78% |
| 1,000 | 1.69 | 18% |
| 1,773 | 3.00 | 5% |

**Zero was the overwhelmingly likely outcome whether or not focus is the cause.** The run cost a
60-minute CI job and could not have discriminated between the hypothesis and its negation — which is
the same defect as a green that fits two facts, arrived at by arithmetic I did not do until
afterwards. *Do the power calculation before spending the runs, not after.*

**So the focus hypothesis is neither supported nor refuted, and must not be written up as refuted.**

**What this rules out is the method, not the suspect.** Chasing a ~1-in-600 event by repetition needs
~1,800 runs per arm to expect three sightings — hours of macOS CI per arm, for a flake that costs the
board one red run. The next attempt should be a *deterministic trigger* — something that makes
`blurNode`'s evaluate hang on demand — rather than more samples. The narrowing in the section above
(an evaluate that never returned, with the retry loop ruled out by the single resolution in the call
log) is where that hunt starts.

## What a fix has to do first

**Reproduce it alone.** If `:85` only fails in a full run, that is a finding in itself and points
at contention rather than at the control. **The vacuity check:** a green `:85` in isolation says
nothing unless the same command has been shown to reproduce the failure at least once — otherwise
it is a test that was never going to fail, which is what this whole card family is about.
