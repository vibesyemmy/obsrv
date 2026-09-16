---
title: "No test can see the overlay's keyboard focus hand-off: a keystroke reaching an open menu is untested on every surface"
column: doing
owner: "Henry"
waiting: ""
kind: bug
order: 56
---

FOUND BY WREN 2026-09-16, on the post-merge read of #105 that Henry asked for: *"whether skipping
the overlay's focus under the harness hides a keyboard path a test should be covering"*. **Unowned.**
Not caused by #105. Nothing could see this before it either; #105 is what made that checkable.

## The answer to the question

**#105 hides nothing that was covered.** But the read found the path is covered nowhere, and one
test's name says otherwise.

`src/main/overlay.ts` hands keyboard focus to the overlay's webContents when a menu or picker opens,
and back to the chrome when it closes ("or the next keystroke would land nowhere and the trigger
could not take its focus ring back"). Since #105 all three calls go through `focusView`, which
returns early when `showsInactive()` is true.

## Established

- **No test sends a keystroke that has to be routed by focus.** `menuKey`
  (`tests/e2e/helpers/select.ts:82`) calls `sendInputEvent` on `overlay.webContents` directly, and
  keys for the chrome go through CDP into the chrome page. Both arrive whichever webContents holds
  focus, so a real keystroke reaching the open menu is the step no test takes.
- **`select.spec.ts:101`, *"the keyboard drives it, and the trigger takes its focus back"*, cannot
  see the hand-back.** It passed on #105's own CI,
  [run `35116892046`](https://github.com/vibesyemmy/obsrv/actions/runs/35116892046) (✓ 52 ms), on
  `76229be`. On that commit `focusView` returns early under `OBSRV_TEST`, so the hand-back was never
  called. The `toBeFocused()` at `:114` is green with or without `win.webContents.focus()`.
- **The focusing branch runs on no test surface, CI included.** `showsInactive()`
  (`src/main/window.ts:31`) reads `OBSRV_TEST` and `OBSRV_SHOW_INACTIVE`, not `CI` or
  `OBSRV_E2E_FRONT`. `focusWindow` is handled differently: #105 kept its test running on CI.
- **CI can observe real window focus.** `live-drive.spec.ts:349` ran and passed on the same run. It
  did not take its *"the runner did not grant window focus"* skip.
- **No unit test touches `overlay.ts`.** No file in `tests/unit` mentions it. A search of the same
  path for `describe` finds 70 files, so the path and the search both work.

## Not established

- **Why `:114` stays green.** The likely reason is that the chrome document's `activeElement` never
  leaves the trigger, because webContents focus moves between views, not elements. That is
  inference.
- **Whether `webContents.isFocused()` on a `WebContentsView` reflects the hand-off.** Measure it
  before building a check on it.

## What a fix has to show

A check that goes **red with the `wc.focus()` call removed** from `focusView`, and green with it
in. Anything that stays green both ways is the test this card is about. Two shapes, not exclusive:

- **A CI-only e2e test**, gated like `live-drive.spec.ts:349` (CI, or locally with
  `OBSRV_E2E_FRONT=1`), where `focusView` may focus. After a menu opens the overlay holds focus;
  after it closes the chrome does.
- **A unit test on `Overlay`** with electron mocked. Outside the harness, opening a menu or a
  picker focuses the overlay's webContents, and closing focuses the chrome's. This catches a
  deleted or misdirected call. It does not check real routing.

Either way, `:114` should say which of the two focuses it checks: the trigger as the chrome
document's active element, or the chrome holding keyboard focus.

## PROGRESS 2026-09-16 by Henry: both shapes, the e2e one measured on CI

**The unit shape** (`tests/unit/overlay.test.ts`, electron faked). Outside the harness, a menu and
then a picker, each opened and closed, focus the overlay's webContents and the chrome's in turn.
Under the harness and with `OBSRV_SHOW_INACTIVE`, nothing is focused. **Controls, one run each:**
removing `wc.focus()`, pointing `hide` at the overlay, pointing `show` at the chrome, and hiding
twice all turned the intended tests red. Removing `focusView`'s early return turned the two "nobody"
tests red.

**The e2e shape** (`tests/e2e/overlay-focus.spec.ts`) needs an app that is allowed to take focus.
So `showsInactive()` gains one switch: a harness app launched with `OBSRV_TEST_TAKES_THE_DESK=1`
shows and focuses as a user's app would. The spec runs on CI, or locally only with
`OBSRV_E2E_FRONT=1`, and the desk guard now refuses that switch on any line not gated by
`OBSRV_E2E_FRONT` (checked: an ungated line goes red). The spec reads `isFocused()` on the window,
the chrome and the overlay: chrome before, overlay while the menu is open, chrome after Escape. If
the runner doesn't grant focus, it skips and says so rather than passing blind.

**Still to establish, on CI:**
- whether `webContents.isFocused()` reports the hand-off at all (the card's open question). The PR's
  own run is that measurement.
- that the spec goes red with `wc.focus()` removed: a separate do-not-merge control PR carries that
  sabotage. The unit tests are skipped on that PR only, so its e2e step runs.

`select.spec.ts:114`'s comment now says what it checks: the trigger as the chrome document's active
element, not keyboard focus.
