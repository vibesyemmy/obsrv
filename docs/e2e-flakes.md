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
| `visibility.spec` and `log.spec`: `win.hide()` logs nothing, painting never pauses | The desk: Electron's macOS hide/show are occlusion transitions |

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

## When the app dies under a spec: what the harness prints now

A spec whose app is gone sees `Target page, context or browser has been
closed` from its next call, and nothing else. Twice that was the whole
report of a real death: the inspector-close SIGTRAP above hid behind it
until the crash reports were read by hand, and `sync.spec`'s second mode
(the channel closed 130 ms into a load, once on CI) still has nothing but
that line. So from 2026-09-03 `launchApp` watches the process from launch,
and an exit that arrives before any close was requested prints, to the
runner's stderr:

- the exit code and signal, and the app's log tail (the user-data
  directory is removed after this, not on Playwright's `close` event,
  which fires first);
- the crash report macOS wrote for that pid, from
  `~/Library/Logs/DiagnosticReports`, matched by the `pid` in the
  report's body rather than by time, and polled for up to 6 s because
  ReportCrash writes it a beat after the death: exception type and
  signal, the termination line, the faulting thread and its top frames.

Measured, with main crashed by `process.crash()` from an evaluate:

```
[launch] app pid 1655 exited on its own (code null, signal SIGSEGV); no close was requested. App log tail:
  2026-09-03T16:47:42.608Z info  obsrv 0.25.0 starting: electron 43.4.1, …
[launch] crash report for pid 1655:
  Electron-2026-09-03-174746.ips
  Electron at 2026-09-03 17:47:42.9644 +0100: EXC_BAD_ACCESS (SIGSEGV), Segmentation fault: 11
  faulting thread 0 CrBrowserMain:
    Electron Framework  node::PrincipalRealm::inspector_enable_async_hooks() const
    …
```

The report arrived about four seconds after the exit line. An `app.exit(0)`
from an evaluate prints `code 0, signal null` and, after the wait, that no
report appeared — a clean exit or a kill from outside. A normal close
prints nothing. The frames are Electron's exported symbols nearest the
addresses, not a symbolicated stack; they place the fault, they do not
name the line.

## `visibility.spec` and `log.spec`: when Electron delivers no hide or show at all

Five tests failed in four full and partial runs on the evening of
2026-09-03 and passed alone once in between: `log.spec`'s "hidden and
coming back is on record" (no `window hidden` line after `win.hide()`)
and the four `visibility.spec` tests that begin by hiding the window
(painting never paused). Not the code: with a listener on the window,
`win.hide()` and `win.show()` flipped `isVisible()` and fired **no `hide`
or `show` event at all** — at the launch position, after
`app.focus({ steal: true })`, moved to the other display — and the
0.25.1 build, which had passed these tests on the same machine that
afternoon, did exactly the same when rebuilt and probed.

On macOS Electron derives a window's `hide` and `show` from its occlusion
state rather than from `orderOut`, so they arrive only when the window
*transitions* between visible and occluded. Something about the desk's
state kept the window from ever counting as visible. What was ruled out
by measurement: the display asleep (`pmset -g log`; it was on, and
`caffeinate -d -u` changed nothing), the screen locked
(`powerMonitor.getSystemIdleState` said idle), the screensaver (not
running), a full-screen Space (none), another console session (one, the
user's). What was not: which window or state was covering the app's.
The user was away for the whole stretch.

So these five specs need a desk where Electron delivers occlusion
transitions, and a failure of exactly these five with no other symptom
is that desk, not the hide path. CI has never shown it. On a desk, check
`hide` fires at all with a listener before reading anything into the
failure.

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

## `sync.spec`: the redirect test, two failure modes

Mode one, seen in the v0.22.1 tag run: `seen.length >= 1` against zero — the
target never followed the native pane back to the redirecting page. Not a
stale expectation, the thing the test guards; the **loop breaker** in
`SyncBus`. It counted direction reversals between mirrors less than a second
apart, and once tripped stayed tripped while traffic continued. The file's
earlier tests mirror native-to-target and target-to-native 140 ms apart, and
the redirect's own replace can reverse once more; on a runner where those
landed inside one second the breaker dropped the very mirror the test
needed. Reproduced on demand: a hammer of the sequence every 150 ms lost
every mirror from the seventh round on.

Fixed in the app: a loop *bounces* — a pane rewrites its URL in place within
a beat of the mirrored load it was just sent, a same-document commit, the
one kind only mirroring can make endless. A click, a redirect or an explicit
load commits a new document, so those now reset the count and only in-place
rewrites after a mirror accumulate (`BOUNCE_MS`). Time alone could not draw
the line: a spec navigates as fast as a loop. The loop fixture still trips
it once; a new test does four quick reversals and expects every one to
mirror.

That first cut gave the rewrite 300 ms to arrive after the mirrored load,
and the 0.25.1 `main` run showed what a stopwatch is worth: the runner's
loop hopped every ~330 ms, no hop read as a bounce, and the fixture ran
for 15 and 17 mirrored loads on the two attempts. Reproduced here with a
fixture that rewrites 400 ms after load (`loop-slow.html`, now a test):
the breaker never fired. Two changes, both measured on that fixture:

- The bounce is a state, not a time: a pane is *armed* by a load the bus
  issued into it, and stays armed through that load's commit and the
  in-place rewrites after it, until a new document commits there. The
  time bound (`BOUNCE_MS`, 1.5 s) is a backstop for a page that never
  rewrote, so an arm cannot claim the user's own in-page click a minute
  later; the window for consecutive alternations is 3 s.
- The bus remembers *every* URL it sent into a pane, not the latest. With
  two mirrored loads in flight into one pane the superseded one still
  commits, and a single "next expected URL" read that commit as a new
  document and reset the count — the loop fixture ran for 252 loads once
  the arm was in place. Now any issued URL's commit is an echo: not news,
  not a mirror, not a reset. An echo retires what was sent before it, a
  new document retires everything, and an entry older than 10 s is
  forgotten.

The breaker also warns once per loop *episode* now, not once per tab: the
flag resets with the count, which is what let the two loop tests share an
app.

Mode two, seen once in the v0.25.0 `main` run: `Target page, context or
browser has been closed` 130 ms into the test, on the evaluate that loads
the redirecting page into the native pane. That message from `app.evaluate`
means the app channel went away — with the devtools flake it was the
process dying. Not reproduced locally (25 hammer rounds, 48 spec runs, no
exit); no crash report from CI. On the ledger, with the exit signal and
crash reports the first things to look at if it returns.

## `sync.spec`: the scroll read that hung, once

Seen once, on the 0.29.0 cycle's first `main` run for 0.28.0 (2026-09-05,
attempt 1). "scrolling the target moves the native pane" scrolled the
target to 2400, polled the native pane and saw it arrive — the poll
passed — and then the very next `executeJavaScript('window.scrollY')` on
the native pane, the same call the poll had just made, never settled. The
test hit its 30 s timeout, the harness closed the app, and Playwright
reported the evaluate as "Target page, context or browser has been
closed", which is the close, not the cause. The app's own log showed a
normal quit. Nothing in that test navigates or recreates a pane, so the
one known hang (a read on a webContents destroyed mid-call, above) does
not obviously apply.

Re-run of the failed job: green. Locally, `--repeat-each 4`: 40 of 40. No
earlier run in the previous fourteen shows the shape. On the ledger as a
one-off; if it recurs, read the app log tail for anything the native pane
did between the poll and the read, and consider racing that read against
a timer the way a spec that spans a recreation should.

What the same run did show, and what changed because of it: **a retry
cannot pass a test that depends on an earlier test's navigation.** A
Playwright retry restarts the worker — `beforeAll` relaunches the app —
and re-runs only the failed test, so the retry of that test found a fresh
"New tab" and failed on its own terms (`Received: 0`), and so did the
next test in the file, on both of its attempts, for the same reason. Two
failures on the report, one event underneath. The scroll tests now settle
the tall fixture for themselves (`onTall`), so a retry of any of them
starts from the page it needs.
