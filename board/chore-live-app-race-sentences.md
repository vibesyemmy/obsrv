---
title: "The ten live-app sentences: what state each needs, and which can be forced"
column: done
kind: chore
owner: "Kenya"
criterion: C5
order: 73
---

**PULLED 2026-09-17 on Wren's routing**, as the `live-app states (10, src/main)` cluster of `c5`'s 43
unfired producers. **Filed as its own card rather than written onto `c5`**, which is Henry's and in
Doing; fold it in if he would rather.

**Measurement first, tests second** — the first deliverable is this table, not fixtures. Building a
fixture that fights the harness is how a week goes missing, and two of these look unforceable.

## The ten, and what each needs

| # | producer | the sentence | the state it needs | forced by anything today? |
| --- | --- | --- | --- | --- |
| 1 | `controlServer.ts:531` | scroll offset could not be confirmed | `deps.scroll()` answers falsy — the pane did not confirm in time | no. Lever: a page holding the main thread (`blocks-after-load.html`) under a live `scroll` |
| 2 | `frameCheck.ts:20` | frames are not being delivered to the pane (the renderer has not subscribed yet) | `ready === false`: a capture before the renderer subscribes | no, and **this one may not be forceable from outside** — see below |
| 3 | `frameCheck.ts:21` | the renderer did not say which frame it drew | `acked === null`: no draw acknowledgement | **yes, proven** — removing the `drawNow` send made it fire (#139's control, 2026-09-17) |
| 4 | `ipc.ts:1752` | the renderer has not reported the pane bounds yet; captured the full window | `targetBounds === null` at capture | no. Lever: the startup window, or the `s.tabId !== tabs.activeId` early return at `:1016` |
| 5 | `ipc.ts:1753` | the renderer has not reported the render bounds yet; captured the whole pane | `canvasBounds === null` while `targetBounds` is known | no. Same source as 4, narrower |
| 6 | `ipc.ts:1755` | ~~the target was still resizing when the capture budget ran out~~ **the page was still painting when the capture budget ran out; the PNG may show a transitional frame — an animation, or a load that had not finished** (corrected by Henry: see below) | ~~`settled === 'resizing'`~~ `settled === 'painting'` | ~~no. Lever: a preset change with a capture issued inside it~~ fired, below |
| 7 | `ipc.ts:1759` | the onion skin is blending two frames of a page that keeps painting | painting/animating **and** `onionSkin > 0` | no. Lever: `animated.html` + skin on + `captureTarget` — **the most straightforward of the ten** |
| 8 | `ipc.ts:1790` | the page keeps painting (animation or video); this is one frame of it | `unsettledReason === 'animating'`, raster path | no. Lever: `animated.html` + `captureRaster` |
| 9 | `ipc.ts:1793` | the page was still painting when the capture budget ran out | still painting at the budget, raster path | no. Lever: `loop-slow.html` or a page that paints past `RASTER_CAPTURE_MS` |
| 10 | `ipc.ts:1796` | the raster is the target's own frame; the onion skin is not blended into it | `onionSkin > 0` on the raster path | no. Lever: skin on + `captureRaster`, and it does **not** need a race |

**`1752–1759` are `captureTarget`; `1790–1796` are `captureRaster`.** That is the "two wordings" the
inventory names: the same conditions answered by two paths, and a fixture for one does not cover the
other.

## What is NOT a race, and should be done first

**7, 8, 10 need a state, not a timing:** an animating page, or the onion skin on. **10 needs neither
a race nor an animation** — only the skin on during a raster capture. These are ordinary tests and
should not wait behind the hard ones.

## What has a proven lever

**3 is already forced once.** Removing the `drawNow` send made the sentence appear in a real reply
(#139). That is a sabotage rather than a fixture, so the test form is an `OBSRV_TEST`-fenced hook, on
the precedent of `OBSRV_TEST_THROTTLE_REFUSAL` — a product change made for a test, said on the line.

## What may not be forceable, named now rather than after a week

**2 (`ready === false`) is the one I would park.** It needs a capture *between* the app accepting
control commands and the renderer subscribing to frames. The control server only answers once the
first viewport is applied, and the renderer subscribes as it mounts — so the window may not exist
from outside at all. **Before building anything for it, measure whether that window is ever open**:
instrument `bus.ready()` at the moment the first control command is accepted. If it is always true,
the sentence cannot fire in a shipped build and the honest outcomes are a named reason or removal.

**4 and 5 are the same question** one layer up: they need a capture before the renderer's first UI
report, or inside the dropped-report window at `:1016`. The second is interesting because it is not a
startup race — switching tabs drops the outgoing tab's report — but whether a capture can land there
is unmeasured.

## Order

1. **7, 8, 10** — states, not races. Three sentences, one fixture each, no new machinery.
2. **9 and 6** — a page that paints past the budget; a resize with a capture inside it.
3. **3** — the fenced hook, with the sabotage control that already worked.
4. **1** — the held main thread.
5. **2, 4, 5** — measure whether the window exists at all **before** building for it.

## THREE FIRED 2026-09-17 by Kenya — the state ones, and they are ordinary tests

`tests/e2e/live-capture-notes.spec.ts`, its own app with agent control:

| # | sentence | how |
| --- | --- | --- |
| 10 | the raster is the target's own frame; the onion skin is not blended into it | skin on, `captureRaster` — **no race, no animation** |
| 8 | the page keeps painting (animation or video); this is one frame of it | `animated.html`, `captureRaster` |
| 7 | the onion skin is blending two frames of a page that keeps painting | `animated.html` **and** the skin on, `captureTarget` |

**Controlled, because a test that asserts a sentence is exactly the kind that can pass on the wrong
one:** with all three producers reworded in `src/main/ipc.ts`, **3 failed**; restored, **3 passed**.

**One correction the run made to my own reading:** I asserted the skin was applied by checking
`reply.error` was undefined. The reply carries `error: null` and says `applied: true` — the
assertion was wrong, not the product, and it failed loudly rather than passing on a field that was
never going to be undefined.

**Desk status, checked rather than assumed:** `live-capture-notes.spec.ts` launches through the
harness (`launchApp`), sets no `OBSRV_E2E_FRONT` or `OBSRV_TEST_TAKES_THE_DESK`, and carries no
recorded activation. Its four commands are `navigate`, `setOnionSkin`, `captureRaster` and
`captureTarget`; **the fronting calls in `ipc.ts` (`setFocusable(true)`, `show()`, `focus()`) belong
to `focusWindow`**, whose whole job is fronting and which this spec never calls. **Desk-safe
locally**; CI if any of that changes.

**Seven left**, in the order on this card: 9 and 6 next (a page painting past the budget; a resize
with a capture inside it), then 3's fenced hook, then 1, then the three window cases behind a
measurement.

### What 3's hook will NOT prove, recorded before it is built

With the `drawNow` send removed by an `OBSRV_TEST` hook, the sentence fires **because we removed
it**. So the observation is *"this sentence is reachable when a draw is never acknowledged"* — not
*"an app in the field reaches this"*. Worth having, and worth not overstating: it is a reachability
proof, where a fixture firing a sentence is an occurrence proof. (Henry's caution, #271's read.)

## THREE MORE FIRED, six of the ten, and the other four have homes — Henry, 2026-09-17, while Kenya was out

**Moved on Opeyemi's instruction**, relayed by Wren (room #440): take the Doing cards to Done one
at a time, Kenya's included, and record each sentence fired on the card.

**Row 6 named the wrong sentence.** *"The target was still resizing…"* (`ipc.ts:1754`) had fired
on 2026-09-14, in `live-drive.spec.ts`'s preset-cycling test (the inventory's hand-checked table).
The unfired producer the inventory lists at that line is its neighbour, `:1755`, for
`settled === 'painting'`. **Rows 6 and 9 are one condition on the two paths**, which is the
inventory's "two wordings".

| # | sentence | the state, and how it is shown to be the lever | control (sentence reworded) |
| --- | --- | --- | --- |
| 1 | scroll offset could not be confirmed | `blocks-after-load.html` holds the main thread that the target's preload answers from, so no reply lands inside `SCROLL_REPLY_TIMEOUT_MS` (1 s). **Shown against the same scroll on a free page**, which is answered | red at `:212` |
| 6 | the page was still painting when the capture budget ran out; the PNG may show a transitional frame — an animation, or a load that had not finished | `animated.html` under `fast-4g`: a throttle turns `quiesce`'s steady-painting exit off, so the page runs the 3 s budget out. **Shown against the unthrottled capture of the same page**, which says "keeps painting steadily". `fast-4g` slows only the network, and a file page makes no requests | red at `:138` |
| 9 | the page was still painting when the capture budget ran out; the PNG may show a transitional frame | `captureRaster` under an 8-preset cycle with a 700 ms pause after each apply, CI only (below) | red at the sentence assertion in both repeats that reached it (`35218471058`); the third came back settled, a finding (below) |

**Kenya's 7 and 8 now assert whole sentences**, since a phrase check stays green when the rest of
the sentence is reworded. Red at `:110` and `:96` with those producers reworded.

### Row 9's lever, and why no page reaches it alone

`loop-slow.html`, the card's lever, is a `history.replaceState` page and doesn't keep painting.
**No page reaches the raster timeout on its own.** `captureQuiescent` stops as soon as it has been
quiet for 400 ms. Paints closer together than that reach 8 paints and the steady exit (`animating`)
well inside 8 s. Only a frame of a new size resets its coverage and its paint count, so the pane
has to keep changing size until the budget runs out. That's a preset cycle, the state
`live-drive.spec.ts` holds for the window capture.

**Measured on CI before any assertion was written, three times, because the first two answers
were not good enough.**
- Cycled back to back, 13 captures (`35215978933`, `35216528983`, `35216907463`) came back
  `timeout` 5 times and `uncovered` 8. **The first version asserted the sentence only on `timeout`,
  and its control asserted nothing** (`35216528983`: 3 of 3 `uncovered`, green with the reworded
  sentence in every reply).
- The second version asserted the sentence on both labels. **Wren's review of #292 caught it:** on
  `uncovered` that pinned a sentence already filed as wrong, and the true half ran only when the
  race allowed.
- **A 700 ms pause after each apply is the lever** (`35217795705`): 12 of 12 `timeout`, no
  `uncovered`, and no settled capture. `uncovered` is the budget running out between a resize and
  that size's first full frame. The pause shrinks that gap to a small part of each step, and each
  step stays well under the 2 s after which a covered page painting steadily leaves as `animating`.

**The test now** asserts the state (applies), `timeout`, and the sentence. Two strays are recorded
and retried, at most 3 tries in all, and each is a defect with its own card. The first is
`uncovered`. The second is a capture that came back **`settled: true` with no warning while the
preset was changing**: the control run's first repeat, which Wren had predicted
(**`bug-live-raster-settled-while-resizing`**, Backlog, 1 in 28 paused captures). Any other label
fails as a finding. **`uncovered` is not
asserted:** on that label the sentence is the wrong one (the PNG has transparent pixels and it
doesn't say so), and the paused cycle doesn't reach it, so a pin would be dead code reading as
coverage. It belongs to **`bug-live-raster-uncovered-said-as-painting`** (Backlog), with the
back-to-back cycle as its lever.

### Rows 2, 4 and 5: measured, and they do not occur from outside

**Measured before building anything, as the order above asked.** The measurement is a throwaway
spec, never committed. It launches the app, polls for the control file every 5 ms, and fires
`captureTarget` then `captureRaster` the moment control answers. That's the earliest call any agent
can make.

| where | launches | control answered after | rows 2, 4, 5 |
| --- | --- | --- | --- |
| laptop | 3 | 423–866 ms | none; the captures said only that the page was blank |
| CI runner (`35216434021`) | 9 | 1263–6854 ms | none; the same |
| laptop, **the app window reloaded** under a capture (`webContents.reload()` fired just before `captureTarget`) | 3 captures | — | none; the reloaded renderer re-subscribed inside the capture's settle |

**Why none of them can fire from outside.** Both checks run after the capture has settled. On a
quiet page that takes at least about 700 ms: two viewport reads 80 ms apart, a frame, 400 ms of
quiet, and 120 ms to draw. On a blank page it takes 3 s. The renderer's first bounds report and its
frame subscription both arrive on mount, before the capture can get that far. **Row 4's second lever
doesn't exist:** a report dropped at `:1016` leaves the bounds main already holds, so it can't make
them `null` after the first report. **Row 2's reload path is real** (`frameBus.ts:91` clears `ready`
when the app window navigates), and the reload row above shows the window closing inside a capture.

**Home: a named reason in the inventory, not removal.** They guard a renderer slower than any we
measured. A renderer that reloads mid-capture on a loaded machine is the case they exist for, and
nothing outside the app can hold that window open. Folding the reason into
`docs/note-inventory.md` is `c5`'s, which is next after this card.

### Row 3

**Home: `c5`'s DECISION of 2026-09-17, "the inventory buys no fences".** Its reachability proof
stands (#139's control). An `OBSRV_TEST` hook in `src/` for it would be bought by an audit, not a
defect. If a stale capture nobody was warned about ever turns up, that defect buys the hook.

### Desk status, re-checked for the new calls

The spec now also calls `setThrottle` (the target's debugger; nothing on that path fronts a window),
`scroll` (IPC to the pane and the target) and `status`. The fronting calls in `src/main` are still
`focusWindow`, `showWindow`'s non-harness branch, the overlay's `wc.focus()`, the DevTools menu, and
`index.ts`'s guarded focus, and the spec calls none of them. **The preset-cycle test is skipped
locally unless `OBSRV_E2E_FRONT=1`**, because `live-drive`'s preset-cycling capture pair had recorded
activations (desk run #2). The rest of the file stays desk-safe, and ran locally: 5 passed, 1
skipped.
