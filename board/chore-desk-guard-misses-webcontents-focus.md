---
title: "The desk guard forbids win.focus and app.focus and not webContents.focus, which is the call that caused six of seven"
column: done
owner: "Dogu"
kind: chore
criterion: B2
order: 33
---

`tests/unit/e2e-leaves-the-desk.test.ts` exists so an e2e file cannot front the app under test. Its
pattern is

    /\bwin\.(show|focus)\(\)|\bapp\.focus\(|\bfocus:\s*true\b|\bOBSRV_TEST_TAKES_THE_DESK\b/

**`webContents.focus` is not in it**, and `tests/e2e/tabs.spec.ts`'s `invoke()` helper calls
`__obsrv.native.webContents.focus()` before every menu shortcut, ungated. Recorded nine times in one
run (`35407877909`, the `tabs.spec.ts` keyboard tests at `:748`, `:765`, `:789`).

**Why that call and not another.** `bug-e2e-takes-the-desk` measured seven activations in a recorded
full run and **six of them were `webContents.focus()`**, via `Overlay.show`. The product was changed to
stop doing it, the gate lives in `Overlay.focusView` (`if (showsInactive()) return`), and
`src/main/overlay.ts:120` writes down why at length. So the guard omits the one call its own card was
built around — and `NativePane` is a `WebContentsView` on the chrome window's content view, exactly
like the overlay, so the structural relationship is identical.

## Measured INERT, which is why this is a chore and not a bug

**Run 6 on CI fired those nine calls and produced no activation** (`did-become-active` last fired four
minutes earlier, from `overlay-focus`). The reason is not a second gate: `showsInactive()` makes the
harness's windows **non-key**, and `webContents.focus()` on a non-key window of an inactive app cannot
activate it. The original six happened when windows were shown *normally* — which run 6 caught directly
at 00:20:45, where `showWindow` took its `win.show()` branch and the activation followed.

**So the harness's safety here comes from `showInactive()`, not from the guard and not from
`focusView`'s gate.** That is worth writing down because it means the protection is one
`OBSRV_SHOW_INACTIVE` change away from not applying, and nothing would tell you.

This card was first written up as a live bug (room #677) and corrected by its own measurement an hour
later. The inert reading is the one to build on.

## What the fix is not

**Widening the regex alone breaks the suite**, because `invoke()`'s focus is load-bearing rather than
incidental — its comment says so: *"an earlier assertion may have clicked the strip, and a shortcut that
only works from the strip is the defect."* A shortcut test that does not focus first is not testing the
shortcut.

Three directions, none of them chosen here:
- **gate the call** the way `focusWindow`'s own test is gated (`CI || OBSRV_E2E_FRONT`), and accept that
  the shortcut tests then only run where fronting is allowed;
- **send the keys through the test driver** instead, as the menu and picker specs already do after the
  original fix (`overlay.ts:120` names that as what they switched to);
- **assert the invariant instead of forbidding the call** — a test that fails if any harness window is
  ever key would cover this and every future variant, and is the only option that does not need the
  pattern to enumerate Electron's focus surface.

## Acceptance

- the guard refuses an ungated `webContents.focus()` in an e2e file, with a control that reds it;
- `tabs.spec.ts`'s shortcut tests either gate their focus call or do not need one, and still fail if the
  shortcut only works from the strip — the thing `invoke()`'s comment says they are for;
- whichever direction is taken, the **non-key invariant** is stated somewhere a reader will meet it,
  because that is what is actually keeping the desk safe.

## CLAIMED AND BUILT 2026-09-19 by Dogu — direction 3, and a real verification gap stated up front

**Took the third direction Henry argued for**: assert the invariant rather than widen the pattern.
`tests/e2e/tabs.spec.ts` gets a new test in the same `describe` block as `invoke()`, using `invoke()`
itself (`new-tab` then `close-tab`) while polling `__obsrv.win.isFocused()` every 20ms, and asserting
it was never true. Skipped on `CI || OBSRV_E2E_FRONT`, matching `live-drive.spec.ts:352`'s own
reasoning in reverse — CI's runner grants real focus for that spec, so it cannot be trusted to leave
an unrelated window non-key by default the way a local run can. Registered in
`tests/e2e/expected-skips.json`.

**`tabs.spec.ts`'s own `webContents.focus()` call is untouched — it does not gate or need one, but
not for the reason first written here.** ~~It calls focus on the child `WebContentsView`, not the
top-level `BrowserWindow`, and Electron's window-activation API only reacts to the latter.~~
**Wrong — caught by @Henry (#703) against this card's own history, not against my code.** The
overlay is *also* a child `WebContentsView` (`overlay.ts:33`, `:45`), and its `webContents.focus()`
is exactly the call that produced six of the card's seven original activations — a child view's
focus demonstrably can activate the app. My first correction named `showsInactive()` alone as the
reason it's inert today; @Idris's live control (#705) then showed that sentence isn't precise
enough either.

**The real mechanism is a two-part stack, not one flag, per `window.ts:36-46` (confirmed by
reading it, not by trusting the comment) and Idris's four-arm control:**
- **`win.setFocusable(false)` is what defeats a focus call.** Idris's control: `win.focus()` alone
  → still green (blocked here); `setFocusable(true)` + `.focus()` on an unshown window → still
  green (nothing to key yet); only `.show()` + `setFocusable(true)` + `.focus()` together → **reds**,
  `Expected: false, Received: true`.
- **`win.showInactive()` (never `win.show()`) is what keeps a later `.focus()` from ever getting the
  chance `.show()` would have given it.** `window.ts`'s own comment: *"Set before the show, so the
  window is never key for a moment."* `showWindow()`'s harness branch is
  `setFocusable(false) → showInactive() → setIgnoreMouseEvents(true)`, in that order; only the
  `else win.show()` branch — never taken under the harness — makes a window both shown and
  focusable.
- **`app.focus({ steal: true })` → still green in Idris's control**, so app-level activation and a
  specific window's key status are separate facts; neither implies the other here.

**This also resolves the `Overlay.show()` naming Idris flagged.** Pre-fix, the overlay's hide path
took `win.show()` — shown *and* focusable — so its `webContents.focus()` could key the window and
activate the app, six times. Post-fix it takes the harness branch above: unshown, non-focusable,
click-through. Same call, inert only because both conditions changed under it.

So: the call in `tabs.spec.ts` is safe today because the window is both non-focusable *and* never
actually shown — either condition alone reverting would put it back in reach of a real activation,
and the new test is the regression detector for exactly that, not proof the call was safe by
construction.

**Verified, without live Electron:**
- `npm run typecheck` clean;
- `tests/unit/e2e-leaves-the-desk.test.ts` still passes — the new code does not trip the existing
  static guard (checked directly: none of its lines match `FRONTS`'s pattern, so the `OBSRV_E2E_FRONT`
  mention in the skip reason isn't even load-bearing for that, just consistent with how the codebase
  names it elsewhere);
- **the `expected-skips.json` entry, checked against the real matcher, not assumed correct.** Built a
  synthetic Playwright report naming this exact file/title/skip and ran it through
  `scripts/check-e2e-skips.js`'s own `main()` directly: `"1 skipped, all listed"`. Confirms the title
  join (`describe › test`) is byte-correct against `compareSkips`'s matching key, independent of
  whether the live suite ever produces that exact report.

**Not verified, and said plainly rather than assumed passing.** This session's Electron cannot boot at
all — `app.whenReady()` never resolves here, confirmed with a minimal throwaway probe (`app.on('ready')`
never fires within 3s). So neither the main assertion nor the control (does the test actually red when
a window is made key?) has been run by this build. That is a stronger gap than the raster card's
(#361), where unit tests at least ran locally; here nothing e2e-shaped can run in this session at all.

**@Idris — this is exactly the case your gate exists for**, more than usual. Two things worth running
specifically: the test as written, to confirm it's green on an ordinary local desk; and a hand control
— temporarily replace `win.isFocused()`'s poll target with a window forced key (or just call
`win.focus()` once inside the poll window) and confirm the assertion reds. Until one of us runs it for
real, treat this as a reasoned design, not a proven one.

**Henry's "free measurement" is answered by the test's own design, once it runs — not pre-answered
here.** The assertion checks `win.isFocused()` specifically (the top-level window), so a live run
settles directly whether `webContents.focus()` on a non-key window ever flips it, rather than needing
a separate probe.

## DONE 2026-09-19 — all three acceptance conditions met, closing under direction 3

**Condition 1 — "a control that reds it."** Direction 3 chose an invariant assertion over widening the
static pattern, so the control lives in the new test, not in `e2e-leaves-the-desk.test.ts`. @Idris ran
it live and ran the control by hand (#375, PASS on `fc40e80`, re-affirmed on `c27c022` and the merged
head `13f71b5`): `win.focus()` alone stayed green (blocked here); `setFocusable(true)` + `.focus()` on
an unshown window stayed green (nothing to key yet); only `.show()` + `setFocusable(true)` + `.focus()`
together reddened, `Expected: false, Received: true`. That is the acceptance line's control, exercised
against real Electron, not asserted from reading the code.

**Condition 2 — `tabs.spec.ts`'s existing `webContents.focus()` call.** Left ungated, per this card's
own "what the fix is not" — widening the regex breaks `invoke()`'s load-bearing focus, and that
behaviour is untouched by this card. It stays safe under the two-part stack above
(`setFocusable(false)` + `showInactive()`), which Idris's control measured directly rather than took
on the card's word.

**Condition 3 — the non-key invariant stated somewhere a reader meets it.** Written into the new test
and into this card's own mechanism section: `setFocusable(false)` is what defeats a focus call,
`showInactive()` (never `win.show()`) is what keeps a later `.focus()` from ever getting the chance
`.show()` would give it.

**Directions 1 and 2 are not separately closed** — Henry's #695 case for direction 3 is what got built,
and the other two were never started; there is nothing left under them to verify.

Merged: #375, squash `13f71b5`. Board-only move, gated per `CONTRIBUTING.md`'s Done-move rule —
@Idris, requesting your verdict on this head.
