---
title: "The target canvas can stay blank in CI: once with the app's no-frames notice, twice without it"
column: backlog
kind: bug
order: 72
---

**Waiting on a recurrence:** `panes.spec` *"the target canvas shows the page, not a blank"* failing with `the canvas stayed blank: N white of M pixels, K distinct.`, followed by `main sent frame …` or `main's state could not be read: …`. Nothing can be done until it fires.

FOUND BY KENYA 2026-09-17, reading the `panes:83` recurrence @Henry recorded on
`bug-target-canvas-no-frames`. **Split from that card deliberately: it is the same symptom with the
opposite tell.** That card is about the app *saying* `No frames from target renderer`. This is the
case where it says nothing at all, and a card that covers both would be answered by fixing either.

## Observed, once, on CI

Run `35176357601` attempt 1 (evidence kept at
`/private/tmp/obsrv-evidence/panes83-run35176357601-attempt1/`):

    03:12:36.953  gpu: compositing enabled, webgl enabled
    03:12:37.9    ✓  panes.spec:77  the toolbar navigates both panes (142ms)
    03:12:58.1    ✘  panes.spec:83  the target canvas shows the page, not a blank (10.0s)

**The predecessor passed one second earlier**, so both panes really were on the fixture. The canvas
then showed fewer than 1000 white pixels for a full ten seconds.

**What is ruled out, by reading the log rather than by argument:**

- **`No frames from target renderer` appears 0 times.** The app never noticed.
- WebGL was **enabled** at launch and no context loss was logged.
- The tests after it pass, but they read **geometry (`:111`) and click coordinates (`:151`), not
  pixels** — so nothing in that run shows the canvas recovering either. Only `:83` looks at pixels.

**What is NOT established:** whether this recurs, and whether it is CI-only. One sighting. The retry
in the same run is not a second one — `:83` inherited its page until #230, so a retry ran it from an
empty tab.

## The hypothesis, which is a hypothesis

The renderer draws the canvas **on an animation frame**, and Chromium fires none while a window is
hidden or fully occluded. That is the measured fact `bug-hidden-window-capture-test-cannot-see-drawnow`
turns on, and the whole reason `flushRendererDraw` and the `drawNow` handshake exist for captures. A
CI window that is never activated would give exactly this shape: **frames arriving in main, no
notice, and a canvas nobody ever draws into.**

It would also explain the silence: main has its frames, so nothing there is missing, and the
renderer is not failing — it is simply not being asked to paint.

## The probe, with its vacuity arm named first

**Count `requestAnimationFrame` ticks in the renderer over ~500 ms in the failing state.**

- **Vacuity arm first:** the same count on a window deliberately hidden or occluded, where it must
  drop to ~0. A probe that has not been shown to see throttling cannot be believed when it reports a
  healthy number.
- Then the count in the `panes:83` failing state. Near zero supports the hypothesis; a normal count
  refutes it and the cause is elsewhere.

**On CI, via a throwaway branch and `workflow_dispatch`.** The occluded arm must not run on
Opeyemi's desk.

## If it is confirmed

The fix is not obviously "draw anyway": a window nobody can see has no reason to paint, and the
capture path already solves its own version with an explicit handshake. The question would be
whether the **test** should drive a draw the way a capture does, or whether the product should paint
the canvas when frames arrive regardless of visibility. That is a decision, not a defect, and it
belongs on this card once the probe has answered.

## The CI probe, run by Henry 2026-09-17 while Kenya was away (Wren's routing, Henry's design in room #361)

**Moved while Kenya was away, as recorded here. Kenya reports to the room first when back.** Run
`35186562119` on a throwaway branch (`probe/raf-occlusion`, now deleted). Its counts are in the run's
`raf-probe` artifact. The spec skipped unless `CI` was set. It counted `requestAnimationFrame` ticks in
the **shell renderer** (the window that draws the target canvas), three samples of 500 ms per arm, with
`document.visibilityState`:

| arm | ticks in ~500 ms (×3) | visibilityState |
| --- | --- | --- |
| shown: the harness as CI leaves it | 27, 28, 28 | visible |
| hidden: `win.hide()` (Kenya's desk arm) | 28, 27, 30 | visible |
| shown again: `showInactive()` | 30, 31, 28 | visible |
| **occluded: a second app launched with `OBSRV_TEST_TAKES_THE_DESK`, covering it** | **30, 27, 28** | **visible** |
| after that app quit | 29, 24, 29 | visible |

**The occluder was real, checked:**
- `getFocusedWindow() !== null` in the holder, so it held the front.
- The holder's window was x 120–1800, y 25–995; the harness's was x 160–1760, y 25–995. It covered
  the harness completely. The window manager clamped the vertical 40 px margin to the screen, so the
  top and bottom edges are flush.

**The vacuity arm failed.** Real occlusion didn't throttle animation frames in the shell renderer on a
runner. Neither did `hide()`, here or on Kenya's desk, and `visibilityState` never left `visible`. So
**the mechanism this card proposed has no support on CI**: the runner doesn't stop the canvas's
animation frames. That hypothesis is set aside, and the silent blank canvas needs another explanation.

**What this does not settle, and it isn't overstated:**
- **A real desk with real occlusion is untested.** That arm takes the desk. A runner's virtual display may
  not compute occlusion at all, so this doesn't refute `flushRendererDraw`'s premise as measured on a
  desk. It only shows CI isn't in that state.
- `backgroundThrottling: false` is set on the **offscreen target** only (`targetSource.ts:330`), not on
  the shell window counted here. So the app's own setting doesn't explain these counts.
- Nothing here yet explains the one sighting. The target frames that did arrive in main
  (`bus.lastSeq()`), and whether the renderer got them, are the next thing to record on a recurrence.

## A SECOND SIGHTING, read 2026-09-17 by Kenya — run `35123165259` at `108e139`

Read while settling the `bug-ci-main-red-37pct` row, and it is the same shape as the first:

    ✓  375  panes.spec.ts:77  the toolbar navigates both panes (258ms)
    ✘  376  panes.spec.ts:83  the target canvas shows the page, not a blank (9.8s)
         Expected: > 1000   Received: 0

- **The predecessor passed**, 258 ms earlier, so both panes were on the fixture. Genuine, not the
  retry confound #230 removed.
- **Zero white pixels** — nothing drawn at all. The first sighting reported the poll timing out;
  this one reports the count, and the count is 0.
- **`No frames from target renderer`: 0 occurrences**, again. The app said nothing, again.

**So this card has two sightings on two different heads**, eight days of runs apart in the tally's
ordering, both with a passing predecessor and both silent. It is not a one-off.

**What it still does not have is a mechanism.** The rAF hypothesis lost its support on CI (#247):
**occlusion does not throttle animation frames on a runner** — 30/27/28 ticks with a fronted holder
app covering the window — so the vacuity arm failed there too, and nothing connects a blank canvas to
missing animation frames. The next recording is Henry's: `bus.lastSeq()` against what the renderer
received, which separates "main never sent a frame" from "the renderer never drew one".

## THE NEXT RECURRENCE WILL CARRY ITS OWN ANSWER, 2026-09-17 by Kenya

Two sightings have now been read and neither log could say **whose side it was**: main never sending
a frame, and the renderer never drawing one, look identical from outside. So `panes:83` now reads, on
failure only:

    the canvas stayed blank: 0 white of 360000 pixels, 1 distinct.
    main sent frame N (delivery subscribed: true/false, session painting: true/false).
    lastSeq 0 or ready false means main never sent one; a high lastSeq with a blank canvas
    means it did and nothing drew it.

**Read at the moment it gives up**, not before — the first draft captured it ahead of the poll, which
would have recorded the state before the failure rather than at it.

**Controlled:** with the pixel read forced to 0, the account prints live values —
`main sent frame 4 (delivery subscribed: true, session painting: true)` — so it is not a sentence
that only exists in the source.

**Why this is new evidence rather than a restatement.** Neither sighting carried
`No frames from target renderer` — the app's own notice, absent both times — and that notice is the
only thing the product says when frames stop. **So nothing in either log could name which side was
quiet**, and every reading of them, including both of mine, had to stop at "the canvas was blank".
This account is the first thing that can answer it, which is the whole reason it goes in before the
next recurrence rather than after.

### How to read it when it fires — the key, on the card rather than only in a PR

    lastSeq 0, or ready false     main never sent a frame. The question is main's, and this is
                                  `bug-target-canvas-no-frames`' territory if its notice also appears.
    lastSeq high, ready true      main sent frames and nothing drew them. The question is the
                                  renderer's, and this card's.
    "main's state could not be read"   the app was gone or the hook renamed; the original failure
                                  message still follows, and that is what to read instead.

**One caveat the sentence carries:** the count is the **bus's**, not this tab's. One bus is re-pointed
across tabs with a single counter (`frameBus.ts:77`), so a non-zero `lastSeq` can predate a tab
switch with nothing sent since. Do not read a high number as "frames arrived for this page".

**Never fired on a real failure.** The account is proven only against a sabotaged pixel read, where
it printed live values. That shows the sentence exists and reads something; it does **not** show
`frameSent()` reads sensibly at the moment a real blank canvas happens. If the first recurrence
prints something incoherent, that is this instrument's fault, not a finding about the product. It
was merged as a bet on exactly that recurrence, with these odds written beside it.

**Desk safety: unchanged.** The account adds no window call — no `show`, `focus` or `moveTop` — and
reads only `tabs.frameSent()` and `session.painting`. `panes.spec` stays in the desk-safe local set.

**This is the sync138 move.** That card sat on `waiting: event` for days and was answered from a
single caught failure, because the trace was already in place when it happened. Nothing here waits on
Henry's `bus.lastSeq()` recording being run by hand on a recurrence; the recurrence brings it.

## One home for both canvas cards, 2026-09-17 by Henry: `bug-target-canvas-no-frames` now lives here, and this card moves to Backlog

**On Opeyemi's instruction** to take the Doing cards through one at a time (relayed in room #440). Kenya's
session is out, and Wren's routing suggested this merge.

**Why one card, not two.** Both cards waited on the same event, a `panes:83` failure. Under the rule
`chore-flaky-leaders-0917` sets, a question that needs an event gets exactly one home, and two cards
whose awaited text is the same failure would both be re-opened by one recurrence. **The distinction
Kenya split them on is kept, as two readings of one failure rather than two cards.** The key above
already routes between them, by whose side went quiet and whether the notice appeared.

**What the other card carried, moved here so nothing is lost:**
- **The one sighting with the notice.** Run `34988828712`: `panes:83` failed both attempts, and the
  uploaded `error-context.md` showed the app's own stall notice, *"No frames from target renderer"*.
  With a blank target, that is the documented signature of a lost WebGL context after GPU helper deaths
  (`docs/gpu-reset.md`, measured 2026-09-08, where switch-and-recover was validated).
- **What that sighting never established:** whether the GPU helper actually died, and whether recovery
  ran. The console line naming a GPU process exit was not in the artefact, because the trace upload
  carried no traces at the time (`#29` changed that).
- **A local reproduction that did not match** (Rook, 2026-09-16), and Kenya's reading that
  `35176357601` is the *silent* shape rather than this one.

**So there are three sightings of one symptom with two tells:** once with the notice (`34988828712`),
twice without it (`35176357601`, `35123165259`).

**Why Backlog and not Done:** the acceptance is a cause, and there isn't one. The rAF hypothesis lost its
support on CI (`#247`: occlusion does not throttle a runner's animation frames). `#267`'s instrument now
says whose side went quiet, and a control showed it prints live values, but whose side is not yet why.
**When it fires**, it moves back to Doing with the run id, read by the key above. If the notice appears
too, the lost-context reading applies.

## BASELINE SWEEP, 2026-09-23 by Dogu — 0/20 fresh, consistent with rare rather than fixed

Assigned by Henry (room #1870), following the same rule established on `bug-redirect-note-missing-not-late`
that same night: measure `main` before proposing anything, because one sighting is not a rate.

**Method:** temporary `ci.yml` override, same pattern as the redirect-note sweeps —
`npx playwright test tests/e2e/panes.spec.ts --grep "the target canvas shows the page, not a blank"
--repeat-each=20 --retries=1`, via `workflow_dispatch` on a throwaway branch. Reverted immediately
after the run (`chore/canvas-blank-baseline-sweep`, run `35806431302`).

**Result: 20/20 passed, first attempt, ~500ms each.** Byte-counted from the raw log, not read from
the job's own rollup — see why below. Zero instances of the blank-canvas failure in a fresh sample.

**What this does and does not establish.** It is a real, clean data point toward rarity: three
sightings total across many hundreds of CI runs since this card opened, and a fresh run of 20 in a
row produced none. By the same rule-of-three reasoning Henry applied to the drawer-stall card, 0/20
bounds the true rate at roughly <15% with ordinary confidence — which is not news given the existing
tally, but it is one more clean sample rather than zero. **It does not touch the mechanism.** The
question this card is actually waiting on — whose side went quiet, main's or the renderer's — needs
a failure to fire under the `frameSent()`/`lastSeq` instrument already in place (`#267`), and this
sweep produced none to read.

**A genuine instrument surprise, worth naming so nobody reads the run's own red X as a test failure.**
The overall CI job reports `failure`, and the target test is not why: **`Every skipped e2e test is
listed` failed**, a separate, unrelated guard (`scripts/check-e2e-skips.js` against
`tests/e2e/expected-skips.json`) that expects a specific known-conditional-skip test to appear in the
run's `results.json` as `skipped`. Filtering the whole suite down to one test via `--grep` removes
every other test from the results entirely rather than marking them `skipped` — so the checker can't
find the one it's looking for and reports `"listed but not skipped"`. This is a false negative
specific to `--grep`-scoped sweeps on this repo, not a defect in the checker for its actual job
(catching an undocumented skip on a normal run), and not evidence about anything on this card. Naming
it here because a red job next to a green target test is exactly the kind of thing this room has
learned, twice this week, not to read past without checking which step actually failed.

**Unchanged: still a recurrence-waiter, still backlog.** Nothing here moves it to Doing — that
happens on an actual firing, per the card's own key.

## A CANDIDATE MECHANISM, 2026-09-23 by Dogu — reasoned, not run, and the instrument to confirm it already exists

Following Henry's own rule from tonight's redirect-note work: stop sampling, find a controllable
knob. Read the actual paint-pause path rather than re-testing the already-refuted rAF-occlusion
hypothesis (`#247`).

**The mechanism, traced end to end:**

- `index.ts:76-88` — the shell window's `hide`/`minimize`/`show`/`restore` events call
  `tabs.setShellVisible(visible)`, and on change, send `IPC.targetPaused` to the renderer.
- `tabs.ts:286-311` — `setShellVisible` flips `shellVisible`, and `applyPainting()` calls
  `active.setPainting(want)`.
- `targetSource.ts:1118-1130` — `setPainting(false)` calls the real Electron
  `webContents.stopPainting()` on the **offscreen target** — frames genuinely stop being generated
  at the source, not merely throttled. This is a different, product-level mechanism from the rAF
  hypothesis `#247` already refuted (that was about Chromium throttling paints on an occluded
  *runner*; this is Obsrv choosing not to rasterise an occluded *window*, on purpose, to save GPU
  load — `visibility.spec.ts`'s own doc comment names the reason).
- `TargetCanvas.tsx:459-466` — the renderer mirrors this via `onTargetPaused`, setting
  `paused.current = isPaused` and calling `disarm()` when paused. `arm()` (line ~115) **refuses to
  rearm the stall watchdog while `paused.current` is true** — so the *"No frames from target
  renderer"* notice is deliberately muted while the app believes the window is hidden.

**Why this matches both real sightings exactly.** Both `35123165259` and `35176357601` show a
passing predecessor test moments before, then a canvas that is blank with **zero** occurrences of
"No frames from target renderer." That is not a coincidence of two independent failures each
happening to stay silent — it is the documented behaviour of `paused.current` being true: painting
stopped **and** the thing that would have complained about it was deliberately turned off, together,
by one flag. `visibility.spec.ts` already proves each half in isolation (hiding stops painting;
showing resumes it and repaints); this card's failure shape is what a **stuck** hide looks like —
one hide event landing without a compensating show ever being *processed* (delivered late, dropped,
or racing test teardown), which the mechanism doesn't distinguish from "the user genuinely walked
away," because by design it shouldn't have to.

**What is NOT established.** Whether a hide event without a matching show can actually happen on
this CI's runners during a `panes.spec.ts` run specifically — `deskState.ts`'s own comment says CI
reliably delivers hide/show events (unlike some local desks), so this isn't "CI doesn't support the
mechanism," it would have to be a genuine, narrower race: a hide landing at a moment nothing later
requests a show. Nothing here names what would cause that moment, and nothing here shows it has
happened — this is a reading of the code, not a measurement, exactly the distinction this room
insisted on all night with the redirect-note card.

**The good news: nothing new needs building to check it.** `panes.spec.ts`'s existing failure-path
instrument (line ~121) already reads `session.painting` at the moment of the next failure — the
same query `setPainting`/`stopPainting` above feed. **If the next sighting reads `painting: false`,
this mechanism is confirmed.** If it reads `painting: true`, this whole reading is wrong and the
cause is elsewhere. No new instrument, no new run — the existing one was already pointed at exactly
this question; it just hasn't fired yet.

**Worth flagging rather than asserting:** this is a "runner state doing something unexpected, briefly,
with no cause named" shape — the same shape as `bug-ipc-native-pane-invisible-once` (also mine).
Not claiming they share a cause; both are open, both are recurrence-waiters, and if a future
sighting on either card names an actual trigger, it is worth checking whether it explains the other.

