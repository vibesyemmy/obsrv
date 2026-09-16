---
title: "`controls.spec:85`: `locator.blur` times out on a resolved input, and two tests then read the stale value"
column: next
kind: bug
order: 50
---

FOUND BY KENYA 2026-09-16 from the values; **ordering confirmed by Rook the same day** from the
log's own failure order. **Unowned.** Split out of `bug-flakes-gate-the-gate`.

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
