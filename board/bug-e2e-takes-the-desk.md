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

## PROGRESS 2026-09-17 by Henry — the icon is dropped at launch, and on CI the CLI's launch does not take the front

**Measured on a CI runner** (`probe/dock-earliest`, run `35160584859`), with the same holder instrument. A
second harness app held the front, and its window's key state was read before and after every launch,
and every 50 ms during the CLI runs. `lsappinfo` does report each app's `ApplicationType` on a runner.
`Foreground` means a Dock icon and a place in Cmd+Tab, `UIElement` means neither, and polling it every
40 ms from before the launch gives how long the icon was up.

| launch | icon up (Foreground → UIElement) | holder kept the front | control `app.focus({ steal })` |
| --- | --- | --- | --- |
| app, hide in `showWindow` (#169) | +153 → +1243 ms, **~1.1 s** | yes | took it |
| app, `dock.hide()` at module top | +101 → +179 ms, **~80 ms** | yes | took it |
| app, `setActivationPolicy('accessory')` at module top | +141 → +265 ms, ~120 ms | yes | took it |
| CLI `snap`, hide in `whenReady` (today) | +225 → +333 ms, **~110 ms** | yes, at every 50 ms poll | — |
| CLI `snap`, policy at module top | +113 → +144 ms, **~30 ms** | yes, at every 50 ms poll | — |

**Two answers.**
1. **The icon's window shrinks from about 1.1 s to about 80 ms per harness launch** if the drop happens at
   module top, still without activating. Built: `index.ts` hides it at module top under
   `showsInactive()` (the measured app arm), and `cli/main.ts` sets the activation policy at module top
   on macOS (the measured CLI arm; Wren's read caught a first version that shipped the unmeasured
   `dock.hide()` there). The existing calls stay, as in the probe, and
   `tests/unit/dockDroppedAtLaunch.test.ts` fails if either drop leaves module top.
2. **On CI, the CLI's own launch does not take the front from an app holding it.** The holder's key state
   never changed during either CLI run. So the 5 s front Rook saw on Opeyemi's desk (22:41:44) came from
   something a runner doesn't have. The remaining candidates are the same as for the harness app's
   last activations: a user switch landing in the icon's window, or a desk-only cause. **Not
   established.** An in-use run that includes the CLI specs is what can tell.

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

## RESUMED, and what it is waiting for — Henry, 2026-09-17

Opeyemi's word through Wren (room #452): **resume**, with the desk runs agreed with them first, and
**run #3 first**. Run #3 is the instrument over a full suite on `main`, for the baseline count this
card has never had — the two runs it does have were both on the fix.

**A desk run happens on Opeyemi's machine while they work, so the timing is theirs.** Asked directly
in Henry's session, 2026-09-17: about fifteen minutes, the test window may come to the front, and the
front-app watcher records every activation.

**Until then**, nothing here needs the desk: `bug-hidden-window-capture-test-cannot-see-drawnow` is
the card this one's step 3 says to settle first, and `devtools.spec`'s own fronting has a named cause
(`openDevTools` without `activate: false`) that can be fixed and controlled on CI.

## READ AGAINST MAIN 2026-09-17 — the fix is already here, and run #3 is the only thing left before the explanations

The PAUSED section above says *"Nothing was merged. Main's window behaviour is unchanged."* **That is
stale, and a later reader would have rebuilt what is already on main.** Checked against `main`
(`6f4da2a`), `git diff origin/main...fix/e2e-does-not-take-the-desk` is **empty**: the branch's work
arrived through the numbered changes that followed it.

What main carries now:
- `src/main/window.ts` — under `showsInactive()`: `app.dock?.hide()`, `win.setFocusable(false)` and
  `win.showInactive()` instead of `show()`;
- `src/main/menu.ts` — `openDevTools({ mode: 'detach', activate: !showsInactive() })`, which is the
  named cause `devtools.spec` had;
- `tests/unit/e2e-leaves-the-desk.test.ts` — the guard that fails when an e2e file calls `win.show()`,
  `win.focus()` or `app.focus(`.

**Step 3's prerequisite is closed too.** `bug-hidden-window-capture-test-cannot-see-drawnow` is Done
(Kenya, `#139`/`#143`): the assertion that could not fail was the white-on-white one, and the reply
had been carrying `frameCheck`'s own doubt all along.

**So what is left is run #3 itself**, which is the one thing that needs the desk: the instrument over
a full suite on `main`, for the baseline count this card has never had. Both runs it does have were
on the fix, so there is no "before" to compare them with.

**Ready to go, so the slot costs fifteen minutes and no setup.** The watcher is written and tested
(`scratchpad/front-watch.sh` in Henry's session): it polls `lsappinfo front` every 100 ms and logs
name, pid and the process's own command on every change — built into macOS, no Accessibility prompt,
read-only. The run is:

1. start the watcher, writing to a log beside the run;
2. `npm run test:e2e` on `main`, in Henry's sync worktree, while Opeyemi works as usual;
3. count activations, attribute each to a test by timestamp, and re-run alone the ones that fronted.

**Waiting on:** Opeyemi's timing for that run, asked for in Henry's session 2026-09-17. Nothing else
on this card needs the desk.


## RUN 3 2026-09-17 by Henry — the baseline on today's `main`, on Opeyemi's machine while he used it

**Opeyemi gave the yes directly in my session** (Wren relayed that he was ready; the go itself came
from him, here). The desk rule held: a relay is notice, not permission.

**The run:** full local e2e on `main` at `006faa7`, built from that tree. **605 passed, 6 skipped,
16.1 minutes, zero `✘`** — no retry-hidden failure anywhere in it, checked rather than assumed.

**The instrument was verified before its zero was believed.** `front-watch.sh` (`lsappinfo front`,
polled every 100 ms, prompt-free) recorded Opeyemi's own app switches throughout — Claude, Dia,
Finder — so a run with no Electron line would have been a measured silence, not a dead watcher. That
check exists because a zero from an unverified instrument fits two facts.

### One activation in 605 tests

| when | how long | what |
| --- | --- | --- |
| 19:23:01 | ~10 s, released 19:23:11 | `Electron` pid 82725, the harness app (`…/Obsrv/node_modules/electron/…`) |

**It took the desk from a person, not from itself.** Opeyemi was in Finder at 19:22:59, two seconds
before. That is the cost this card is about, and it is still there once per suite.

**Which test — reconstructed, not recorded, and it agrees with this card's own earlier reading.**
The suite log carries no wall clock, so the point was placed by scaling cumulative test durations to
the 966 s the run took: the front is taken inside **`stall.spec.ts`** (`:21` at the take, `:77` at the
release). **The table above already says `main`, `stall.spec`, one launch: yes, at 2 s, for about
5 s** — measured separately, weeks earlier, by whoever wrote that row. Two independent routes to the
same spec. It is still a reconstruction; an in-app recorder would make it a recording.

### What the number does NOT cover

**The two specs that take the desk on purpose were skipped, by design** — `live-drive.spec.ts:352`
(`focusWindow`) and `overlay-focus.spec.ts:39`, both gated to CI or `OBSRV_E2E_FRONT=1`, which this
run did not set. Four others skipped for unrelated gates (`live-capture-notes` ×2 on the same gate,
`mcp-launch` ×2 on `OBSRV_E2E_LAUNCH`). **So "1" means one activation from the specs that are not
supposed to take the desk at all**, which is the number this card cares about, and not a claim about
the suite as a whole.

### What this changes

Step 1 of "if this is picked up again" is **done**: the baseline on today's `main` is **1**, not the 6
this card's fix-branch table recorded, so most of the fronting is already gone and what is left is a
single spec. That makes the remaining work smaller and more specific than the card assumed — one
spec's launch, not a class of them.

## RUN 4 2026-09-18 by Henry — zero activations, and run 3's conclusion does not survive it

**Opeyemi asked for it directly**, as the desk rule requires, and used the machine throughout: the
watcher recorded **nine** of his own app switches between 02:13 and 02:30 (Claude, Dia, Claude, …).
The suite ran 02:13:09 to 02:29:17.

**The run:** `main` at `71290bd`, with `OBSRV_E2E_CLI=1` so the population matches run 3 — `#333` had
since made a local run exclude the CLI family, and comparing 455 tests against run 3's 605 would have
compared two different suites. **615 tests, 609 passed, 6 skipped, 16.1 minutes, zero `✘`.**

**Zero activations.** The harness app never took the front.

**The instrument was verified before its silence was believed**, as in run 3: the watcher logged
Opeyemi's own switches all through the run, and was still running afterwards. An empty Electron
column here is a measured silence, not a dead poller.

### What this does to run 3's conclusion

Run 3 recorded **one** activation and said *"the baseline on today's `main` is 1, not the 6 this
card's fix-branch table recorded, so most of the fronting is already gone and what is left is a single
spec."* **That claim does not survive.**

- **`stall.spec` ran in run 4** — tests 472–475, all green — and nothing took the front. It was run 3's
  suspect, named there **by reconstruction** from cumulative durations and labelled as one.
- **Two runs, 1 and 0.** The remaining activation is **intermittent**, and the attribution is neither
  confirmed nor refuted by this run. What run 3 could honestly claim was "one activation, and here is
  the spec the arithmetic points at". What it actually claimed was a baseline and a single remaining
  cause. That was one run's result stated as a rate.

**So the card's position is: zero-or-one activation per suite on today's `main`, cause unattributed.**
That is weaker than run 3 said and stronger than where this card started (7 activations, two named
causes, both fixed).

### What would actually attribute it

Not another suite. A third run gives a third number and no more attribution than the first two, because
**the suite log carries no wall clock** — which is why run 3 needed arithmetic and run 4's timestamp
sampler had nothing to timestamp. The thing that turns a sighting into an attribution is the one this
card already used once: **the in-app recorder** wrapping `show`/`focus`/`moveTop`/`restore`,
`app.focus` and `webContents.focus`, logging `did-become-active` beside the `lsappinfo` watcher. That
is what found the original seven and named both causes.

**So the next step is a recorder run, not another baseline run** — and it needs Opeyemi's desk again,
which is a cost worth spending once rather than a suite at a time.

### Skipped, and why the number is bounded

Six: `live-capture-notes` ×2 and `live-drive:352` (`focusWindow`) and `overlay-focus:39` — the two that
**take the desk on purpose**, gated to CI or `OBSRV_E2E_FRONT=1`, which this run did not set — plus
`mcp-launch` ×2 on `OBSRV_E2E_LAUNCH`. So "zero" means zero from the specs that are not supposed to
front at all.

## RUN 5 2026-09-19 by Henry — the recorder run: zero activations, and the ten risky calls are all in TEST code

**Opeyemi's direct yes in my session**, as the desk rule requires. `main` at `28a01ee` plus the probe
instrumentation (`probe/desk-recorder`, never to merge). `OBSRV_E2E_CLI=1` to match run 4's
population; no `OBSRV_E2E_FRONT`, so the specs that front on purpose stayed skipped.

**605 passed, 13 skipped, 18.5 minutes, zero `✘`. Zero activations.**

### Three instruments, because the third is what runs 3 and 4 lacked

The front-app watcher says *the desk changed at T*. The in-app recorder says *a call was made at T,
from here*. Neither says **which test was running**, and this card already records why that mattered:
the suite log carries no wall clock, so run 3 attributed by arithmetic over cumulative durations and
named `stall.spec`, which run 4 then cleared. A Playwright reporter logging test boundaries with an ISO
clock closes the join.

**Verified before its silence was believed**, the same standard runs 3 and 4 held: a single-spec trial
logged three launches, each `win.showInactive` from `showWindow`, with readable stacks. The watcher
recorded six of Opeyemi's own app switches during the run.

### What the app did: nothing that fronts it, across 77 launches

    82  win.showInactive        every one from showWindow
    77  recorder-installed      77 app launches
     0  win.show / win.focus / win.moveTop / app.focus
     0  EVENT did-become-active / browser-window-focus / activate

The fix this card shipped holds **under measurement**, not by inspection: 77 separate launches, every
one taking the inactive path. The three event hooks staying silent agrees independently with the
watcher's zero — two instruments that could have disagreed, and did not.

### What the TESTS did: ten calls that can front the app, none of them the app's

    9  webContents.focus   tabs.spec.ts:748, :765, :789
    1  win.restore         visibility.spec.ts:79 "minimising counts as hidden"

Every one from `UtilityScript.eval` — **Playwright's own `app.evaluate`**, not product code. The nine
are all one helper: `tabs.spec.ts`'s `invoke()` (line ~700), which does
`__obsrv.native.webContents.focus()` before every menu-shortcut, with a comment explaining why the
focus is load-bearing — *"an earlier assertion may have clicked the strip, and a shortcut that only
works from the strip is the defect"*.

**`webContents.focus()` is the call that caused six of the original seven activations on this card**,
via `Overlay.show`, because on macOS focusing web contents focuses the owning window and activates the
app. The product was fixed to stop doing it. **A test still does it, ungated.**

### The confound, and it is the whole reason this run cannot close the card

**The screen locked at 23:28:20.779** — `loginwindow` took the front — and **all ten** risky calls
happened at 23:28:32 or later:

    23:11:05 - 23:28:20   17m15s, ~600 tests, unlocked, user switching apps   0 activations, only showInactive
    23:28:20 - 23:29:30   70s, LOCKED                                         all 10 risky calls land here

Nothing can come to front over a lock screen. So **this run does not show those ten calls are
harmless; it shows they were untestable when they ran.** The 17 minutes before the lock are a clean
result. The last 70 seconds are not a result at all.

### The hypothesis this buys, and what would settle it

`tabs` is one of the five specs the original recorded run listed as *"activations with nothing recorded
before them"*. That earlier recorder wrapped the **app's** calls; these come from **test** code through
`app.evaluate`, which is exactly the shape that would have produced an activation with nothing
recorded before it. **So the remaining intermittent activation may be `tabs.spec.ts`'s own `invoke()`
helper.** Specific, and testable: a run whose screen stays unlocked through `tabs.spec.ts` either
records an activation at one of those three tests or does not.

Not claimed as the cause. Run 5 cannot support that, for the reason above.

### A guard gap, which is a finding in its own right

`tests/unit/e2e-leaves-the-desk.test.ts` exists to refuse exactly this, and its pattern is

    /\bwin\.(show|focus)\(\)|\bapp\.focus\(|\bfocus:\s*true\b|\bOBSRV_TEST_TAKES_THE_DESK\b/

**`webContents.focus` is not in it.** The one call responsible for most of the original activations can
be written in an e2e file today and the guard will not object — and one is. This fence is bought by a
defect rather than by an audit, which is the bar: it is the call this card measured seven times.

The fix is not simply widening the regex, because `invoke()`'s focus is load-bearing for what that test
asserts. Either the call is gated behind `OBSRV_E2E_FRONT` like `focusWindow`'s test, or it is replaced
by something that focuses without activating. That is a decision, and it belongs with whoever writes
it — not folded in here.

## RUN 6 2026-09-19 by Henry — the CI recorder run: every activation attributed, and my own hypothesis refuted

Run 5 could not say whether `tabs.spec.ts`'s nine ungated `webContents.focus()` calls front the app,
because Opeyemi's screen locked before they ran. A runner has no lock screen. Run `35407877909`,
`probe/desk-recorder`, same instrumentation.

**Three activations, all three attributed, none of them unexplained.**

| time | recorded cause | spec |
| --- | --- | --- |
| 00:15:14 | `win.show` + `app.focus` + `win.focus` from `Object.focusWindow` <- `ControlServer.route` | `live-drive.spec.ts:352`, the `focusWindow` test |
| 00:16:49 | the same three, same caller | `mcp-live.spec.ts:191`, the combined drive call's `focus: true` |
| 00:20:45 | `win.show` from `showWindow`, then `webContents.focus` from `Overlay.focusView` <- `Overlay.show`/`hide` | `overlay-focus.spec.ts:39` |

**All three are the specs that take the desk ON PURPOSE**, each gated `CI || OBSRV_E2E_FRONT` — verified
in the files rather than taken from this card: `live-drive.spec.ts:357`'s `test.skip`,
`overlay-focus.spec.ts:17`'s `FRONTS`, `mcp-live.spec.ts:191`'s conditional `focus: true`. **So CI has
zero activations with nothing recorded before them**, which is the shape that has haunted this card
since the original recorded run reported five of them.

### My hypothesis is dead, and the measurement is what killed it

Run 5 found nine ungated `native.webContents.focus()` calls from `tabs.spec.ts`'s `invoke()` and I
argued they were a strong candidate for the intermittent activation — on structural grounds I then
verified: `NativePane` is a `WebContentsView` added to the chrome window's content view, exactly as the
overlay is, and `overlay.ts:120` says in the product's own words that focusing such a view *"focuses
its window too, which activates the app"*, naming six of the original seven.

**On CI those nine calls fired at 00:24:40 and produced no activation at all.** The last activation was
at 00:20:45. Nine calls, no lock screen, nothing.

### Why not, and the mechanism this completes

Because `showsInactive()` makes the harness's windows **non-key**: the app is never active, and
`webContents.focus()` on a non-key window of an inactive app does not activate it. The original six
happened when windows were shown *normally* — which is exactly what run 6 caught at 00:20:45, where
`showWindow` took the `win.show()` branch (`overlay-focus` runs with fronting on) and the activation
followed immediately, with `Overlay.focusView` calling `wc.focus()` a second later because
`showsInactive()` was false there too.

**So the same call is dangerous or inert depending on whether the window can become key**, and the
harness's safety comes from `showInactive()` rather than from the gate inside `focusView`. I had been
looking for a second gate to explain the silence; the explanation is that there is nothing to gate
when no window is key.

### What this does to the guard gap

`tests/unit/e2e-leaves-the-desk.test.ts` still omits `webContents.focus` from its pattern, and
`tabs.spec.ts` still calls it ungated. **But it is now measured as inert rather than suspected as
live.** Worth closing as defence in depth — it is one `OBSRV_SHOW_INACTIVE` change away from mattering,
and the product comment it contradicts is three lines long — and **not** worth calling a bug with a
measurement behind it, because the measurement says the opposite.

### Where the card stands after two recorded runs

- **The app makes no activating call under the harness**: run 5, 77 launches, 82 `showInactive`, zero others.
- **A test making the dangerous call does not activate either**: run 6, nine calls, nothing.
- **Every CI activation is by design and attributed**: run 6, three of three.
- **The residual desk-side activation — 1 in run 3, 0 in runs 4 and 5 — has no app-side cause in any
  recorded run, and no CI counterpart.** That points away from Obsrv and towards the desk: window
  layering, or the user's own switching, which is where the original five unexplained ones pointed too.

### A flaw in my own instrument, recorded because it nearly cost the attribution

**The clock file came back empty.** I set `OBSRV_DESK_CLOCK` in the workflow but never registered the
reporter in CI's `npx playwright test` command — the reporter only loads when passed with `--reporter`,
which my local run did and CI did not. So the join that run 5 relied on was unavailable, and the
attribution above came from matching recorder timestamps against the suite log's own `✓ N spec:line`
lines. That worked, and it worked by luck: the log happens to carry per-test timestamps. **An
instrument half-wired is the failure mode this card has already paid for twice** (run 3's arithmetic,
run 4's sampler with nothing to sample).
