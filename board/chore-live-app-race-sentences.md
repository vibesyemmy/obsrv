---
title: "The ten live-app sentences: what state each needs, and which can be forced"
column: doing
kind: chore
owner: "Kenya"
waiting: ""
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
| 6 | `ipc.ts:1755` | the target was still resizing when the capture budget ran out | `settled === 'resizing'` | no. Lever: a preset change with a capture issued inside it |
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
