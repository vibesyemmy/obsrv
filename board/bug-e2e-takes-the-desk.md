---
title: "The e2e suite brings the app to the front on every launch, and takes the desk from whoever is using it"
column: doing
owner: "Henry"
waiting: ""
kind: bug
order: 0
---

FILED 2026-09-16 by Wren, **top priority on Opeyemi's word**, assigned to Henry. Reported by
Opeyemi: while the e2e suite runs, the app keeps coming to the front and interrupts whatever he is
working on. The suite is run many times a day on the machine people are using, so every run costs
someone's attention for its whole length.

## What is known — read from the code on `main`, not yet reproduced

- **`src/main/window.ts:30`**: `win.once('ready-to-show', () => win.show())`. On macOS `show()`
  activates the app, and almost every spec launches a fresh one. **The likeliest cause**, because
  it runs on every launch.
- **`src/main/index.ts:187-188`**: `win.show(); win.focus()`, but only in the `second-instance`
  handler, so only in the single-instance specs.
- **`src/main/ipc.ts:1983-1988`**: the `focusWindow` control command calls
  `app.focus({ steal: true })`, and `tests/e2e/live-drive.spec.ts:349` exercises it on purpose.
  One test that *must* front the window is a different problem from every launch doing it.

## The constraint, which is why this is not a one-line fix

The suite depends on how macOS treats a window it can see:

- **Visibility follows occlusion.** `tests/e2e/helpers/deskState.ts` notes that Electron derives a
  window's `hide`/`show` from its occlusion state on macOS, and `visibility.spec.ts` tests it. A
  window kept behind other apps may count as occluded, and those tests may change meaning.
- **Occluded windows captured stale frames before.** A previous pass found that captures of an
  occluded window were stale, because the renderer draws on `requestAnimationFrame`; the fix was
  a `drawNow` handshake. The offscreen target already runs with `backgroundThrottling: false`
  (`targetSource.ts:315`), which is encouraging, but the app window's own renderer is a separate
  question.

**So the trap is a fix that stops the stealing and quietly weakens the capture and visibility
tests.** A green suite after the change fits "nothing broke" and "the tests that could break no
longer look" equally well.

## Leads — hypotheses, not findings

- Under `OBSRV_TEST`, `showInactive()` instead of `show()`, so the window appears without
  activating the app.
- Under `OBSRV_TEST`, `app.setActivationPolicy('accessory')` (or `app.dock.hide()`), so the app
  never becomes the active app at all.
- Keep `focusWindow`'s test, but make the stealing opt-in, so a default run never fronts.

## Done means

1. **A full e2e run while someone works in another app never brings Obsrv to the front**, except
   for anything explicitly opt-in and named. Observed on a desk, not inferred from the code.
2. **The capture and visibility specs still see what they claim to**, shown by control rather
   than by a green run: with the app behind other windows, a capture test must still get a fresh
   frame, and a planted stale frame must still go red.
3. If some test genuinely needs the foreground, it says so in its name and is excluded from the
   default run.

## PROGRESS 2026-09-16 by Henry — `dock.hide()` measured on CI, and the harness app now leaves the Dock and Cmd+Tab

**The measurement came first, on a CI runner, so no one's desk was involved** (`probe/dock-hide-activation`, run
`35159351340`). Two earlier attempts were VOID. `lsappinfo front` returns nothing on a runner, and the
second attempt relied on activation events that can fire before a listener is attached. The instrument
that worked was a second harness app launched with `OBSRV_TEST_TAKES_THE_DESK`, whose window's key state
(`BrowserWindow.getFocusedWindow()`) shows whether it still holds the front.

| arm | holder still front? | become/resign-active | control `app.focus({ steal })` |
| --- | --- | --- | --- |
| baseline harness launch | yes | none | took the front |
| `dock.hide()` before `showInactive`, at launch | yes | none | took the front |
| `dock.hide()` on a running app | yes | none | took the front |

**So `dock.hide()` doesn't activate the app, and the probe could have seen it if it did.** The first
attempt also confirmed the policy change: after the hide, `lsappinfo` reports the app as `UIElement`.

**Built:** under `showsInactive()`, `showWindow` now calls `app.dock?.hide()` before anything else.
`tests/unit/showWindow.test.ts` pins the order, and it went red on both harness branches with the call
removed. **One limit:** the icon is visible from launch until `ready-to-show`, about a second. The probe
measured this placement, not an earlier one.

**Done-means 1 is still open.** That needs an in-use run on this change, and that run needs Opeyemi's yes.

## PROGRESS 2026-09-16 by Henry — never key since #141, and the activations left follow the user's own app switches

**In-use run #1** (`75c200a`, 20:31 WAT, after #105 and #107): 551 passed, 8 activations. In each one the
OS handed the harness window key focus (`browser-window-focus` at the same instant as
`did-become-active`), and no app call came before any of them. **#141** now makes the harness window
non-focusable before it's shown.

**In-use run #2** (`c3ac1a1`, 22:40 WAT): 551 passed, 2 skipped, 797 s. **2 activations and 0 key
handoffs.** Both fell inside `live-drive`'s preset-cycling capture pair (`:1025` and `:1144` on that
tree), 2.3 s and 8.4 s after Opeyemi switched to Dia or Finder, with nothing from the app before either.
In the same run, Rook's CLI Electron from another worktree was front for 5 s. That is the second launch
path (the CLI's own Electron), not this app.

**The pair run alone ×3 with a wider recorder** (23:26 WAT, Opeyemi's yes via Wren). The recorder added
window and webContents creation, bounds, dock, menu and `showInactive`. Result: 6 passed and **1
activation**, 2.1 s after a switch to Dia, lasting 7.7 s. In the 3 s before it, the app made no
`show`, `showInactive`, `focus`, `moveTop`, `restore`, `app.focus` or dock call, created no window, and
fired no `browser-window-focus`. Reps 2 and 3, where he switched only between Claude windows, had none.
**So the pair no longer fronts the app on its own.** The "fronts alone" entry below predates #141.

**The shape that's left:** about 2 s after the user switches to Dia or Finder, with no app call and no key
window. The harness app is in both the Dock and Cmd+Tab, so those are the candidates. **Not
established.** The next lever is `app.dock?.hide()` under `showsInactive()`, which removes both routes.
It's held until Rook's CLI launch-path measurement says whether `dock.hide()` activates the app by
itself (the CLI calls it at startup). If it does, the lever would add an activation to every launch.

**Done-means 1 isn't met.**

## PROGRESS 2026-09-16 by Henry — click-through, measured as far as it can be without the user clicking

**#105 merged** (`e37caa7`): the app no longer activates itself under the harness. **Next:** the harness
window is also click-through (`setIgnoreMouseEvents(true)`), because the five residual activations had
no call from the app before them and fit a click meant for the app beneath landing on a window that
`showInactive()` still puts on top.

**Recorded full run with it: 545 passed, 1 skipped, zero activations, zero change of front app.**
**The limit:** the user stayed in one app (Dia) for the whole run, so nothing was clicked. The run
shows the change is harmless to the suite, not that click-driven activation is gone. A synthetic OS
click would need an Accessibility permission prompt on the user's machine, which is not worth it.
**Done-means 1 closes on a run while someone actively uses the desk.**

## PROGRESS 2026-09-16 by Henry — the app no longer activates itself; five activations remain with no app-side cause

**Found by recording, not reading.** One full suite ran with a temporary recorder in every launched
app, wrapping `show`/`focus`/`moveTop`/`restore`, `app.focus` and `webContents.focus`, and logging
`did-become-active`, beside the `lsappinfo front` watcher. 545 passed, 1 skipped. **7 activations, two
causes:**
- **6: `Overlay.show` → `webContents.focus()`.** On macOS that focuses the owning window, which
  activates the app. That happened in every spec that opened the target's `<select>` menu or a picker.
- **1: `focusWindow`,** from `mcp-live`'s combined `drive` call (`focus: true`).

**Fixed on the branch:** under the harness (`OBSRV_TEST`, or `OBSRV_SHOW_INACTIVE=1` for the dev lane's
real launch), `showWindow()` uses `showInactive()`; `second-instance` skips `focus()`; the overlay
skips `webContents.focus()`; detached DevTools open with `activate: false`. `focusWindow`'s test, and
the `focus: true` ingredient of the combined `drive` test, run on CI and locally only with
`OBSRV_E2E_FRONT=1`. `tests/unit/e2e-leaves-the-desk.test.ts` refuses an ungated `win.show()`,
`win.focus()`, `app.focus(` or `focus: true` in an e2e file.

**The same recorded full run on the fix: 545 passed, 1 skipped, and 0 activations from any call the app
makes.** **5 activations remain with nothing recorded before them**, in unrelated specs (`mcp-live`,
`onion-skin`, `surface-parity`, `sync`, `tabs`), while the user was switching between WhatsApp,
Figma, Trae and Dia. The likely mechanism is **the test window being on top**: `showInactive()`
orders it in front without focusing it, so a click meant for the app beneath lands on it, or macOS
activates the topmost window's app when the front app loses focus. **Not established.** The next
step is to make the harness window click-through (`setIgnoreMouseEvents`; test input comes through
CDP, not the OS) and measure again.

**Done-means 2, by controls that can go red on the fix:**

| control | result |
| --- | --- |
| `main`'s `show` handler removed → `log.spec`'s transition test | **failed** (Expected 2, Received 1); on the fix it **passed, not skipped** |
| hidden window, frame delivery off, navigate red → white, capture | **the planted stale frame was seen** (`[255,0,0]`); delivery back on → `[255,255,255]` |

So under `showInactive()` the visibility test still receives the window's `show` event, and a capture
of a hidden window still shows staleness when there is some.

## RESUMED the same day, on Opeyemi's word (via Wren): carry the fix through

The pause below lasted under an hour. **Its gate question is answered:** the `drawNow` sabotage had
already run on `main`'s window code before the pause arrived, and the test passed there too. So the fix
did not weaken the hidden-window capture test; that test could not see the regression on this desk
at all (`bug-hidden-window-capture-test-cannot-see-drawnow`). Work continues from the branch and
the evidence below. The section keeps its original words as the record.

## PAUSED 2026-09-16 on Opeyemi's word (via Wren): keep the e2e behaviour as it is for now

**Why:** the risk this card names. A fix that stops the fronting might quietly weaken the capture and
visibility tests, and one of the controls below came back ambiguous before anyone knew which way it
cut. **Nothing was merged.** Main's window behaviour is unchanged, so local Electron e2e runs still
front the app. The work is on the branch **`fix/e2e-does-not-take-the-desk`** (`58e5139`), with no PR.

### What was built (on the branch)

- **`showWindow()`** in `src/main/window.ts`: under `OBSRV_TEST`, `showInactive()` instead of
  `show()`, at launch and in `second-instance` (which also skips `focus()` under test).
- **The four test-side `win.show()` calls** use `showInactive()`: `helpers/deskState.ts`,
  `visibility.spec.ts`, `live-drive.spec.ts`, `log.spec.ts`.
- **`focusWindow`'s test** keeps the command's real, fronting behaviour. It runs on CI, and locally only
  with `OBSRV_E2E_FRONT=1`, and its name says so.
- **A CONTRIBUTING rule, plus `tests/unit/e2e-leaves-the-desk.test.ts`,** which fails if an e2e file calls
  `win.show()`, `win.focus()` or `app.focus(`. On main's four files it failed, listing exactly those
  four lines.

### The instrument, which is the part worth reusing

`lsappinfo front`, polled every 100 ms and logging name, pid and command whenever the frontmost app
changes. **It's built into macOS and triggers no permission prompt.** With pid logging it tells the test app
(`…/Obsrv/node_modules/electron/…/Electron`) from other Electron apps and from the user's own switching.

### Observed

| run | test app took the front |
| --- | --- |
| `main`, `stall.spec` (one launch) | **yes**, at 2 s, for about 5 s. The instrument can see fronting. |
| fix, `stall.spec` | no |
| fix, `visibility` + `log` + `single-instance` + `consent` (17 tests) | no |
| fix, `live-drive`: hidden-window capture + `focusWindow` (skipped by design) | no |
| **fix, full suite** (543 passed, 1 skipped, 790 s) | **yes, 6 times** |

**The six in the full run, pinned to tests by timestamp and then re-run alone:**
- **`devtools.spec`** fronts alone too. `menu.ts` opens DevTools detached, and `openDevTools` activates
  unless given `activate: false`. **Not yet changed.**
- **`live-drive.spec:1019`** (*"a pane still being resized…"*) fronts alone too. It only cycles
  `setPreset` through the control server. **Unexplained.** The offscreen target window is created with
  `show: false`.
- **`dev-lane.spec`** launches the real app without `OBSRV_TEST` on purpose (*"the point is a real
  launch"*), so the fix can't reach it. Found by reading, not re-run.
- **`native-pane`, `onion-skin` and `surface-parity`'s dialog case** did **not** front when run alone, 0 of 3.
  Their full-run events are unexplained. The user switching apps, or clicking the test window (which
  `showInactive()` still orders on top without focusing it), fits, but wasn't established. One more
  honest limit: two of the six happened while four test files were briefly swapped in the worktree for
  a guard control, a mistake, and aren't counted as evidence either way.

### The open question, stated as open

**Done-means 2** asks that a planted stale frame still go red. With the `drawNow` handshake sabotaged,
the hidden-window capture test **passed on the fix and also on `main`'s window code** (0 `obsrv:draw-now`
sends in the built output, so the sabotage was real). **So the test couldn't see that regression
before this change, and the fix didn't change what it sees.** That's filed on its own as
`bug-hidden-window-capture-test-cannot-see-drawnow`. Whether a fix here weakens *other* capture or
visibility tests is **not established**, and that question is why this is paused.

### If this is picked up again

1. Run the instrument over a full suite on `main` first, for the baseline count.
2. Give `devtools` and `live-drive:1019` their own fixes, and explain the rest.
3. Settle `bug-hidden-window-capture-test-cannot-see-drawnow` first, so the capture control has a test that
   can fail.
