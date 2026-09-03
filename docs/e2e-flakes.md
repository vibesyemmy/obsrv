# The e2e suite's flakes, and what was ruled out

The Playwright suite drives a real Electron app that rasterises offscreen,
composites through the GPU, and streams frames over IPC. A handful of its
failures are timing-sensitive rather than real, and they surface under machine
contention. This records what was investigated so it is not investigated again.

## The symptoms

| Failure | Layer |
| --- | --- |
| `Resulting promise was garbage collected` | Playwright ↔ Electron main, via CDP |
| `UnknownVizError` from a capture | Chromium's GPU compositor |
| A seam drag landing short of the pointer | Synthesised input timing |
| A drop or mode switch not taking effect in order | Renderer ↔ main IPC ordering |
| `"afterAll" hook timeout of 30000ms exceeded` in `app.close()` | Electron's exit after `app.quit()` |

Each one passes when its file is run alone, and on a plain re-run.

## `Resulting promise was garbage collected` — what it actually is, and the fix

Playwright rewrites CDP's `Promise was collected` into that message. `app.evaluate`
issues `Runtime.callFunctionOn` with `awaitPromise: true` against the main
process's Node inspector, and **V8's inspector holds the promise it awaits
weakly**. Playwright's utility wraps the evaluated function's result in a
promise. When the function is *synchronous*, that promise is already resolved
as the inspector call returns, and from then until the next microtask
checkpoint runs the inspector's own handler, nothing references it. A garbage
collection in that gap takes it, and the call fails — although the function
ran. Main allocates hard (every tab's frames arrive over IPC), so on a loaded
runner the gap is hit a few times per thousand evaluates: "a different spec
each time, always green alone", and in the v0.22.1 tag run it landed in a
synchronous `steerNative` evaluate while a navigation was committing.

Reproduced on demand (2026-09-03, `--js-flags=--expose-gc`, a collection
forced in every gap after the function returns — microtask, `setImmediate`,
timers at 0/1/3 ms):

| Callback | Lost |
| --- | --- |
| synchronous, returns a value | 20 of 20 (and a counter showed every one had run) |
| synchronous, returns `Promise.resolve(value)` | 0 of 20 |
| async | 0 of 40 |
| either kind, through the wrapper below | 0 of 60 |

The earlier attempts that found nothing had forced collections *while a
promise was still pending*, which V8 keeps alive; the window is after
resolution, and only for a promise resolved outside a checkpoint.

**The fix is in the harness:** `launchApp` hands specs a proxy of the app
whose `evaluate` sends the caller's function as source, rebuilds it in main,
and awaits it inside an async wrapper (`hardenEvaluate` in
`tests/e2e/launch.ts`). A proxy rather than an own property because Playwright
names the API in its error text after the calling frame: through `bind` or
`.call` every error read `electronApplication.original`; through a function
named `evaluate` it reads `electronApplication.evaluate` as before.
The promise Playwright awaits then resolves inside a checkpoint and is never
unreferenced while unsettled. Nothing is retried, so nothing runs twice — the
old per-spec retry in `image-mode.spec.ts` re-ran the function on every hit
and is gone. The constraints are Playwright's own: no closures, one
serialisable argument.

Related, and not the same thing: `webContents.executeJavaScript` on a
webContents that is destroyed mid-call (a density change recreates the
target's window) never settles — it hangs, and the promise stays reachable,
so an evaluate awaiting it runs into the test timeout rather than this error.
A spec that awaits a page script across a recreation should race it.

## Ruled out

- **Apps piling up between spec files.** Sampled every 2s through a full run:
  at most 2 Electron main processes, mean 1.0. Each file's app closes before the
  next one matters.
- **An out-of-date harness.** Playwright is at the latest release (1.62.1); there
  is no upstream fix to adopt.
- **A naive drag helper.** `dragSeamTo` already moves in 12 steps and then polls
  for two identical reads before returning.
- **Suite parallelism.** `workers: 1`, `fullyParallel: false`.

## The one correlation that held

Every occurrence during development happened while **another Electron app was
running alongside the suite** — a `npm run dev` build, or the installed Obsrv.
With those stopped, it did not recur in five full runs. `UnknownVizError` and the
drag failures behave the same way: they are contention, not logic.

So: when a run goes red, check what else is running before reading it as a
regression, and re-run before diagnosing.

## One real bug this turned up

`dragSeamTo` released the mouse button on its last line, so a move that threw —
or a test that timed out partway through a drag — left the button **held down**
for the rest of the file, since every test there shares one app. Everything
after it then dragged when it meant to click, and the retry inherited the same
stuck button, which is why those failures used to arrive in threes and survive
being retried.

The release is now in a `finally`, and `beforeEach` lifts the button before it
resets the split. Failures in that file no longer cascade: before, three
consecutive tests went down together; after, at most one fails and the rest of
the file is unaffected.

That is a genuine fix. The rest below is handling.

## A green run that still fails: "1 error was not a part of any test"

The v0.18.3 tag run: 261 passed, 2 flaky (both green on retry), exit code 1.
Playwright's last lines were the retried test's first-attempt error again —
`no 2556x1179 paint within 10s` — under **"1 error was not a part of any
test"**, which fails the run whatever the tests did.

The mechanism: a few specs install a `__waitForFrame` helper *in main* that
rejected on a 10 s timer. On a loaded runner a test can stack enough 10 s
`expect.poll`s to hit its 30 s budget while that evaluate is still in flight.
Playwright abandons the call and retries the test; main's timer then fires,
the abandoned evaluate rejects, and the rejection arrives with no test to
belong to. So: **a helper installed in main must never reject on a timer.**
It resolves `null`, the evaluate returns `null`, and the spec asserts on the
Playwright side — a late *resolution* is silently dropped, a late rejection
is not. `mobile`, `orientation`, `target-source` and `rendering` do this now.

## What was done about it

`retries: 1` in `playwright.config.ts`. This is handling, not a fix — the cause
is in the harness and the GPU stack, not in product code, and it could not be
reproduced deliberately.

It does not hide anything. Playwright reports a test that only passed on retry as
**flaky**, separately from passed, so the signal survives: a genuine failure
still fails twice and still reports failed, and a flake is named rather than
silently swallowed. Without it, one contention blip turns a good branch red,
which trains everyone to re-run and stop reading the result — which is the more
expensive failure.

If the flaky count starts climbing, that is the signal to come back to this,
because it means something changed in the app rather than in the weather.

## `capturePage` on the offscreen target answers at the host display's scale

`webContents.capturePage()` on the offscreen target returns a bitmap at the
*host display's* scale factor — 3840×2160 for a 1920×1080 target on a
Retina Mac, 1920×1080 on a 1x monitor — whatever the target's own density
or text scale. The `paint` frames the app actually draws are unaffected
(`browser-identity.spec.ts` and `rendering.spec.ts` pin those). A spec
that asserts an absolute `capturePage` size therefore passes on one display
and fails on another; compare captures to each other, or read the frame
bus. Found 2026-09-03 when `text-scale.spec.ts` went red on the built-in
Retina display after passing on an external 1x monitor — the "second"
failure that followed was Playwright restarting the worker after the
first, so the next test met a fresh app without the scale it assumed.

## `solo-target.spec`: the `afterAll` that timed out in `app.close()`

Seen once, on the 0.22.1 tag run: the file's last test passed in under a
second, then `app.close()` in `afterAll` ran past the 30 s hook budget, the
file was marked failed and the whole of it re-ran green. Playwright's
Electron close is two steps — evaluate `app.quit()` in main, then wait for
the process to exit — so the process stayed up for at least 30 s after
being told to quit.

What was checked (2026-09-03):

- Every `webContents.send` in main is guarded against a destroyed window,
  and the quit path is straight-line: the main window's `close` handler
  stops the IPC listeners, destroys the sessions (the offscreen windows
  with them) and the overlay; `will-quit` stops the control server
  synchronously. Nothing defers a window creation past teardown, and
  nothing calls `preventDefault` on a close or a quit.
- The test's setup — the largest preset (`4k-27`, a density change that
  recreates the offscreen window) in the smallest window the app allows,
  then close — was repeated 26 times here with `uncaughtException` and
  `unhandledRejection` hooks writing to the app log: closes took 50–180 ms,
  with tracing on and off, and main threw nothing.

So there is no mechanism to fix yet. What is in place instead:

- The harness bounds `app.close()` (`tests/e2e/launch.ts`, 10 s). Past
  the bound it prints the app's log tail and kills the process; the spec
  stays green and the output carries the evidence.
- The app logs the quit's milestones — `quitting`, then `closing` and
  `closed` around the sessions' teardown, then `exiting` — so that tail says
  which stretch did not finish: between `closing` and `closed` is this
  code's teardown, between `closed` and `exiting` is Chromium's. Measured:
  a normal close logs all four in that order and resolves in about 90 ms;
  a quit forced to stall in `will-quit` logs all four too (the stall sits
  past the last milestone), and the close resolves at the bound with the
  tail printed.

## `devtools.spec`: "Target page, context or browser has been closed" was the app crashing

The one flaky retry in the first CI run after the collected-promise fix
was `devtools.spec.ts:31`, whose second evaluate found the app channel
closed. Not the harness: **Electron's main process died with SIGTRAP**
(`EXC_BREAKPOINT` on `CrBrowserMain`, a Chromium CHECK) and Playwright's
context closed because the CDP connection went with it.

Measured (2026-09-03), closing the target's detached inspector after its
`devtools-opened` event:

| Close issued | 0 ms after the event | 300 ms after |
| --- | --- | --- |
| synchronously inside an `app.evaluate` | crashed 3 of 3 | 0 of 3 |
| from a `setTimeout` in main | 0 of 3 | 0 of 3 |

So the crash is re-entrancy: DevTools teardown in the beat after the
frontend loads, re-entering inspector machinery while a Node-inspector
dispatch is on the stack. A menu click from the UI never sits on that
stack, so no human saw it; every spec that drives the menu through
`app.evaluate` did. The original spec closed on `isDevToolsOpened()`, which
answers for the request rather than the window, and a loaded runner
landed that close in the window.

Fixed in the app rather than the spec: `toggleDetachedDevTools` defers a
tick and refuses a second toggle while an open is in flight (that second
toggle used to re-open, for the same flag-versus-window reason). The spec
now runs the crashing sequence itself, twice, as a regression test.
