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

## What a fix has to do first

**Reproduce it alone.** If `:85` only fails in a full run, that is a finding in itself and points
at contention rather than at the control. **The vacuity check:** a green `:85` in isolation says
nothing unless the same command has been shown to reproduce the failure at least once — otherwise
it is a test that was never going to fail, which is what this whole card family is about.

## NOTE 2026-09-16 by Henry: the focus state these measurements ran in is gone

Every measurement above predates `e37caa7` (#105, `bug-e2e-takes-the-desk`). Since then, under the
harness, the app shows its windows inactive and never calls `webContents.focus()` on the chrome or
the overlay, so the app is never active and none of its windows is key, locally and on CI. Rook,
reading #105, pointed out that this card's second suspect, *"the blur is dispatched into a window
that is not key"*, now describes every run.

**One data point, not a conclusion:** in a recorded local full run on #105's branch, `:85`, `:109`
and `:115` passed on their first attempt (545 expected, 0 flaky), in that state. So a window that is
not key does not make `:85` fail every time. Nothing says it never does.

**So re-measure on a tree at or after `e37caa7` before theorising.** If it no longer reproduces, say
whether it went with the focus change or only got rarer. That takes enough runs to tell the two
apart, and a control that puts the old focus back (Rook's addition).
