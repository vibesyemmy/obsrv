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
| `history.spec.ts:148` — the list falling left of the native pane at a wide split | Layout read before the split settled |
| A drop or mode switch not taking effect in order | Renderer ↔ main IPC ordering |
| `"afterAll" hook timeout of 30000ms exceeded` in `app.close()` | Electron's exit after `app.quit()` |
| `panes.spec.ts`, `.url-form input` — `page.press` times out | The app's own responsiveness, before any test instrumentation runs |
| `visibility.spec` and `log.spec`: `win.hide()` logs nothing, painting never pauses | The desk: Electron's macOS hide/show are occlusion transitions |
| `cli.spec.ts:212` — a leaked `obsrv-cli-*` temp dir after SIGTERM | **Not test noise: a real dir was left behind. Whose is the open question** |

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

## `history.spec.ts:148`, named because you will search for the line

Seen 2026-09-12 on the merged tree of two branches, neither of which
touched `history.spec` or any renderer code: "the list never falls left of
the native pane, at a wide split or in solo target", one failure in a run
of 486. It passes 11/11 when the file is run alone, and had passed in a
full run of the same tree's parent half an hour earlier.

It belongs to the drag-and-layout family above — a position read before
the split has settled — but it is written out here under its own line
number because that is what the next person will search for. Seeing it
alone in an otherwise green run, on a change that touches no renderer
code, is the signature; run the file by itself before reading anything
into it.

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

A second shape of the same error, seen on the 0.32.0 tag run: no helper in
main at all, but a Playwright-side `expect.poll` (`drawerSettled`, 10 s)
inside a test that relaunches the app. On a loaded runner the relaunch ate
the 30 s budget, Playwright abandoned the test and retried it, and the
poll's timeout rejection landed after the test had ended. Two changes: the
drawer poll is bounded at 5 s (the transition is 220 ms), and the relaunch
group is marked slow, so the budget fits what it does.

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

## `fit-cap` and `onion-skin`: red on the built-in Retina, green everywhere else

Seen 2026-09-12: `fit-cap.spec.ts:43` and both raster assertions in
`onion-skin.spec.ts` failed three runs in a row, locally, while
`typecheck`, unit and browser were green and the same commit's CI on
macos-14 passed the whole suite.

It is the `capturePage` scale above, in a second guise. What changed was
not the tree: the machine's external monitors had been disconnected, so
the Mac was on its built-in Liquid Retina XDR alone (3024×1964, 2x). The
same three specs had passed on this machine earlier the same day with a 1x
monitor attached, and they pass on CI, whose runner display never moves.

**Isolate it before reading it as a regression, the way that day did:**

- Run the specs on `main` with your branch's changes out of the way. Same
  three failed there, which is what ruled the branch out in about a
  minute.
- Check what the machine is plugged into: `system_profiler
  SPDisplaysDataType | grep -E "Resolution|Main Display"`. A 2x built-in
  as the main display is the condition.
- The desk-state skips are a second tell: a run that skips the five
  `visibility`/`log` specs and these three together is a desk story, not a
  code one.

Stopping other Electron apps does **not** help here — that was checked, and
is what separates this from the contention above.

**Since 2026-09-14 these three skip instead of failing.** `fit-cap.spec.ts`
and `onion-skin.spec.ts` probe the desk once in `beforeAll` — capture the real
window, divide by the size that window reports — and the three assertions that
read a scaled capture skip with the scale in the reason
(`tests/e2e/helpers/captureScale.ts`). Never on CI, where the runner's display
does not move and a red is still the signal. The probe is measured, not a list
of hosts: a machine that stops scaling its captures stops skipping, with
nothing to edit. Verified both ways by forcing the app's scale factor —
`--force-device-scale-factor=2` reports 2 and skips, a plain launch reports 1
and runs.

Two things it deliberately does not do. It does not skip
`onion-skin.spec.ts`'s 50% test, which also reads a captured pixel but was not
among the three observed red — if a 2× desk turns that one red as well it
belongs in the same skip, on that observation rather than on the symmetry. And
a skip is not a fix: the assertions still cannot run on a 2× desk, so what
they cover is unproven there. Comparing captures to each other, or reading the
frame bus, is what would make them desk-independent.

**A green run does not confirm this entry.** On 2026-09-12 a full suite of
489 passed with these three among them, on a machine with the externals
plugged back in. That says the condition was absent, not that the entry is
stale: the three can only fail on the built-in panel alone, so a run that
cannot fail them cannot confirm them either. Only unplug-and-rerun retires
this.

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

## `mcp.spec`'s `obsrv_diff` row ratio: contention only, message not captured

Seen twice on 2026-09-06, in two consecutive full local runs, both times at
the same position — `[191/374] tests/e2e/mcp.spec.ts:173 obsrv_diff: thin
text reproduces the ~0.5 row ratio, files on disk`, green on retry.

It does not reproduce on its own (4 of 4 with `--repeat-each 4`) or in its
own file (13 of 13), so it needs whatever else the full suite is doing at
that point. That is plausible on the face of it: the test spawns the MCP
server and the diff behind it performs *two* renders, the 1x target and the
2x reference, which makes it the most expensive single test in the file.

**The failure text was not captured.** Playwright had written it to
`test-results/*/error-context.md`, and that directory was deleted in a
tidy-up of the project root before anyone read it. So the mechanism above is
where to start looking, not something that has been established.

Next time it appears, read `test-results/` *before* cleaning anything, and
record the assertion that failed: whether the ratio fell outside 0.3–0.7
(the renders disagreeing) or one of the two PNGs was missing (the temp dir
or the write losing a race) points at quite different causes.

## `cli.spec`'s temp-dir leak check reads state this machine shares

`snap leaves no obsrv-cli-* user-data dirs behind in os.tmpdir` snapshots the
`obsrv-cli-*` directories in `os.tmpdir()`, runs one snap, and fails if any
*new* one appeared. That is not a fact about this repository. Every obsrv CLI
invocation on the machine writes such a directory, so the assertion is about
machine-global state, and anything else running the CLI during its window
reads as a leak here.

Seen 2026-09-11: it failed in two consecutive full runs (8.4 minutes each) and
passed in isolation, on a branch whose diff is nowhere near the CLI. A second
Claude session was working the same repository from its own git worktree.
Worktrees separate the checkouts; they do not separate `os.tmpdir()`.

**Two writers, and the second is the one that will waste your afternoon.** The
obvious one is that session running its own Playwright e2e. The other is its
MCP server: a headless `obsrv_*` tool call spawns a CLI process, and so writes
one of these directories — meaning an agent merely *using* the tools trips this
without ever running a test. Whoever meets it next goes looking for a leak in
their own change and finds nothing, because the directory was never theirs.

How to tell them apart, before suspecting your branch:

- Run the single test on its own. It passes: the window is then milliseconds
  rather than minutes.
- Watch `os.tmpdir()` for `obsrv-cli-*` while running nothing yourself. New
  ones appearing means another writer; none appearing does not clear it,
  because the other writer may work in bursts.
- Ask. Two agents on one machine can compare timelines, which is what settled
  it here.

Not fixed, deliberately. The test is the only thing guarding a real leak that
shipped once, so weakening the assertion to make a branch green is the wrong
trade — and doing it *because your own branch is red* is the move that turns a
ledger into a graveyard. Making it robust means scoping the CLI's user-data
directory per run, which is a change to the product rather than to the test.

## `cli.spec`'s "solid red": a download banner on the machine channel

The one that failed on CI and passed on re-run, repeatedly, and never once
locally. The failure was never about pixels:

    SyntaxError: Unexpected token 'D', "Downloadin"... is not valid JSON
      const json = JSON.parse(r.stdout)

`require('electron')` returns the binary's path and downloads the binary
first when it is missing, announcing that with `console.log('Downloading
Electron binary...')` — stdout — and then spawning its installer with
`stdio: 'inherit'`, so that lands on stdout too. `bin/obsrv.js` inherited
both, and the CLI's contract is that stdout carries nothing but machine
JSON. Locally the binary is always already there, which is why it never
reproduced; on CI it is there only if the cache restored it, which is why
it was intermittent, and why the failing attempt was always the slow one
(4–5 s against 1 s on retry — the download).

It was never a test problem. `bin/electronPath.js` now works the path out
itself, which cannot print, and hands a genuinely missing binary to a child
process whose stdout is redirected to stderr. The same fault hit the
`npx -y getobsrv` first run the README documents, where every agent parsing
stdout would have seen it.

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

Since 0.36.0 the five probe for it themselves: `hideEventsFire` in
`tests/e2e/helpers/deskState.ts` hides and shows the window once in
`beforeAll` with a listener on `hide`, and each of the five skips with
"this desk fires no hide event" when nothing fired — **off CI only**. On
CI the tests run whatever the probe said, so a runner that ever stops
delivering occlusion transitions still fails red rather than skipping
green. A local run that reports these five as skipped is that desk; one
that reports them failed is a real regression in the hide path.

**They ran on a desk on 2026-09-13, and passed.** Every local suite that
day had skipped them — through the 0.59.0 cut and the greens it shipped on —
until a run late in the day came back **0 skipped, 496 passed**, the
externals evidently plugged back in. So the hide path was exercised for the
first time that day by a branch that had nothing to do with it, and every
earlier green stands with a gap this one fills rather than repeats. Worth
knowing in both directions: a skip is the desk, and a *pass* is the only
thing that says the path still works — a green with seven skips in it has
said nothing about them.

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

## `devtools.spec`: the guard tests were decided by one sample racing the open

The two tests of that guard, `:92` (two clicks) and `:116` (three), each
failed 9 of 181 CI tries between 2026-09-13 and 09-16, four times through
the retry. It was filed as the inspector closing and then re-opening. It
never did.

Every try, passing or failing, finished in 505–648 ms around a 500 ms
sleep, while a real open-then-close takes at least 337 ms on a runner
(`:31`, which waits on the events). So the 10 s close poll was satisfied
before either toggle had run: both are deferred a tick, and
`isDevToolsOpened()` answers for the request. The verdict was the one
sample 500 ms after the clicks, racing the open and the held close. A slow
runner read `true` there exactly as a dropped close would.

Fixed in the spec, not the app: both tests wait on the target's
`devtools-opened` / `devtools-closed` events and time "stays closed" from
the close. Against sabotaged builds of `menu.ts`, delaying the held close
by 700 ms fails the old tests and passes the new ones; dropping the held
toggle, or queueing a re-open behind the close, fails both.

**Read the duration beside the error, not only the line.** A 10 s poll that
finishes in a tenth of a second on every run waited for nothing.

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

Mode three, and it is the live one — **`sync.spec.ts:139` with one signature: a
native load of `redirect.html` that is aborted in 0–1 ms (18 ms once).** It was
written up on `#485` and `#489` (2026-09-28/29) and **counted at five sightings
on 2026-10-06, below**; the paragraphs from here to "This is a third mode" are
as first written, about those two. Same assertion as mode
one (`seen.length >= 1` against zero, *"the target emitted no url-changed"*),
retry-rescued both times, on `#485` and `#489` — neither of which touches
redirect code. What separates the attempts is printed by the spec's own
instrumentation:

```
FAILED:  step-2 native load: failed in 0ms;  native commits after it: 1; target url-changed: 0
PASSED:  step-2 native load: ok in 27ms;     native commits after it: 2; target url-changed: 2
```

`#485`'s run carried the reason in its `nativeLoads` record:
`outcome: "failed", error: "ERR_FAILED (-2) loading '.../redirect.html'",
tookMs: 0`. **`ERR_FAILED (-2)` with a zero duration is an aborted
navigation, not a slow one** — Chromium's answer for a load that was
superseded before it began. In `#485`'s mirror record the abort sits 14 ms
after the target had already moved to `hairline.html` on branch `issued`: the
page's own redirect had fired, so the echoed load of `redirect.html` had
nothing left to load.

**This is a third mode, not mode one returning.** Mode one was the loop
breaker dropping a mirror it should have kept, and it was reproduced on demand
and fixed. This is the opposite end: the mirror issues a load the page has
already made obsolete, and the abort produces **no** `url-changed` for the
spec to see. Nothing here says the app is wrong to abort it; what is missing
is any arrival for the second commit the test is waiting on.

**Related, and deliberately not merged with it.** The `arrivals.spec.ts:89`
entry's own candidate — a reverse-find over **six** same-URL starts — would be
produced by the same underlying event, a redirect landing inside the mirror's
echo window. They may be one bug seen from two sides. **Two log readings do not
establish that**, and the discriminator is cheap: whoever runs the forcing
test should watch for **both** signatures. If the `arrivals` route reproduces
and the 0 ms abort never appears, they are two bugs and this entry keeps its
own.

**Counted again, 2026-10-06: five sightings, not two.** The fifth was found by
Idris reading the log of the `#581` merge's push run (room `#3854`); the fourth was
already in this file, named at the `browser-identity.spec.ts:41` entry as
"a different mechanism with its own entry" and never counted here; the earliest,
`#481`'s, is in no entry. Dogu's sweep of every saved suite job, counted
from the raw logs: `[sync138] step-2 native load: failed in …` followed by
`✘ sync.spec.ts:139` on the first attempt and `✓ … (retry #1)`, and in each the
failing attempt's own record carries one failed native load, `redirect.html`,
`ERR_FAILED (-2)`, after the target's move to `hairline.html` on branch `issued`
(`other was …/redirect.html`):

| PR or run | run (suite job) | head | created | step-2 line | `tookMs` | abort after the target's `issued` move |
|---|---|---|---|---|---|---|
| `#481` | `36455553267` (`109040931450`) | `a7c9ee13d` | 09-28 17:04Z | failed in 18ms | 18 | 22 ms |
| `#485` | `36479230614` (`109120539028`) | `cc434110d` | 09-28 20:26Z | failed in 0ms | 0 | 14 ms |
| `#489` | `36496705263` (`109177903098`) | `acd588d89` | 09-28 23:12Z | failed in 0ms | 0 | 34 ms |
| `#561`'s pull-request run | `37294297527` (`111711823346`) | `d68d497ac` | 10-05 10:05Z | failed in 0ms | 0 | 11 ms |
| `main` push, the `#581` merge | `37404143379` (`112077843475`) | `698656963` | 10-06 02:26Z | failed in 1ms | 1 | 16 ms |

The `#485` row's 14 ms is the figure written above; it reads the same from the
raw log. The other four are read the same way: the abort's `at` minus the `at` of
the `issued` row in the failing attempt's mirror record.

**What the table changes in the entry above.**
- **The 0 ms is not the discriminator.** The durations are 0, 0, 0, 1 and 18 ms.
  What the five share is the error string, the file (`redirect.html`), the order
  (the abort comes 11–34 ms after the target had already moved on) and the
  counts (`native commits after it: 1`, `target url-changed: 0`). The sentence
  above, "`ERR_FAILED (-2)` with a zero duration is an aborted navigation, not a
  slow one", is true of three of the five and says nothing about `#481`'s 18 ms
  or this run's 1 ms.
- **The hold-out from `#584` cannot be what stops it.** `sync.spec.ts` has no
  `holdNativeOut` (0 mentions on `698656963`; it launches its own app in
  `beforeAll`), and four of the five trees predate `#584` (merged 2026-10-06 as
  `9d60fcd`; three of the runs are from 09-28, and `d68d497`'s base has no
  `tests/e2e/holdNativeOut.ts`). The fifth is a `main` tree that includes
  `#584` (it is an ancestor) and failed anyway.
- **In the fifth run's job, the `arrivals` route did not reproduce while the
  abort did.** `arrivals.spec.ts:184` and `:226` and
  `redirect-mirrored-pool.spec.ts:194` were `✓` on their first attempt (tests 1,
  2, 492) in the same job as the `✘` on `sync.spec.ts:139`. The discriminator
  named above needs the `arrivals` route to *reproduce* with no abort; this is
  the other corner, so it does not decide whether they are one bug or two.

**What the sweep covered.** 178 readable suite jobs of 600 s or more, from runs created on or after 2026-09-27 through
10-06 04:26Z (the first from a run created 09-28 16:28Z), every attempt of every run, each pulled by job id through the raw API
(`gh api repos/vibesyemmy/obsrv/actions/jobs/<id>/logs`), chosen by the suite job's name and a duration of at least 600 s and not
by the run's conclusion: `37294297527` is stamped `cancelled` and its suite job is `success`. **Corrected 2026-10-06:** this
paragraph first said 177 jobs with no log empty, read with `gh run view --log --job`, which returns a run's *latest* attempt's log
for any of its job ids; six re-run runs were read as their attempt 2 twice and their attempt 1 not at all (Wren, `#3946`; Idris,
`#3947`). 177 of the 178 contain a `[sync138]` line; the one that does not is `37408764721`, a cancelled job. Two cancelled
attempt-1 jobs of 694 s and 709 s (`111969388200` and `111969404835`, runs `37369906774` and `37369912376`) answer 404
`BlobNotFound`: they are **unread**, not "without a line". The line has been in
the spec since 2026-09-16 (`dc8bd84`; its current shape, with `other native loads
after it`, from `509d2e3` the same evening); **this sweep did not read 09-16 to
09-27**, so it says nothing about those days.

**Four more jobs print a failed step-2 load and the test passed.** Runs
`36474748542` (52 ms), `36467712974` (114 ms), `36612587616` (70 ms) and `37123672372` (131 ms, attempt 1) print
`step-2 native load: failed in …` with `native commits after it: 2` or `3` and
`target url-changed: 2`, and `sync.spec.ts:139` is `✓` on its first attempt. A
passing log does not print the failed load's record, so these are **not** counted
as sightings: what failed in them is unread. They do say that a failed step-2 load
alone does not fail the test; in the five that did, the target also emitted no
`url-changed`.

**What this does not say.**
- It is **not a rate.** Five first-attempt failures with this signature among
  the 177 suite jobs that reached the test is a count over a window in which the
  code under test changed; the jobs are every one saved, not a draw.
- It does **not** say this is the `arrivals` race, or that it is not
  (the "Related" paragraph above keeps that open), and it does not say the app is
  wrong to abort the load: the register's words stand, "nothing here says the
  app is wrong to abort it".
- It does **not** say every `sync.spec.ts:139` first-attempt failure is this one.
  The same jobs hold seven, and **two of the seven are teardowns**, not this:
  `electronApplication.evaluate: Target page, context or browser has been closed`,
  at 127 ms and 149 ms, with no step-2 line printed for that attempt. They are
  `#483` (run `36474113601`, suite job `109103468365`, 09-28), the one named above,
  and `#544` (run `37120875494`, suite job `111196592516`, 10-03), which this
  register did not name before. Both are retry-rescued; no job has a `:139`
  failure on its retry.
- Why the abort comes when it does is **not** read: no mirror record was parsed
  beyond the `issued` row and the failed load, and the `playwright-flaky`
  artifact (id `11387656817` on the fifth run) has not been downloaded; that
  waits on Opeyemi's go.

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

## `update.spec`: the automatic-check toggle, a 30 s `page.reload` on the tag runner

Seen once, on the v0.54.0 tag run (2026-09-12): `update.spec.ts:133 the
automatic-check toggle round-trips through main` timed out twice — first on
`page.uncheck`, then on `page.reload` at 30 s — and took the run red with it,
which skipped `Publish DMGs to a GitHub Release`. So a flake in a test about
the update checkbox is what stood between a published npm package and a
release with no DMGs on it.

It is not the tree. **The same commit had passed that same test in 410 ms on
the `main` run an hour earlier**, and it passes locally in full runs. A
`gh run rerun <id> --failed` went green in 14m5s and published both DMGs.

The shape is the one already on this page — the renderer not answering
promptly under contention — rather than anything about the update path: the
test hides nothing behind a network call (`update.spec` stubs the check), and
the two failing calls are both plain Playwright waits on the renderer.

What to do when it appears: re-run the failed job before reading anything into
it, and check whether the same commit passed elsewhere — a tag build and its
`main` build are the same tree, so a green `main` run is the control this
repository gets for free. If it starts recurring on tags specifically, the
thing to look at is what else the tag job does that `main` does not: it builds
and signs two DMGs in the same workflow, so the e2e job can be sharing a
runner with more work than usual.

**A release consequence worth knowing:** the tag workflow publishes the DMGs
only if the test job passes, and the npm publish happens *before* the tags are
pushed. A flake here therefore leaves npm and the plugin tag live while the
release page has no DMGs — for as long as it takes to notice. Re-running the
failed job is the whole fix, but nobody sees the gap unless they are watching.


## `select.spec.ts:101`: the overlay menu polls to zero rows and times out

Seen 2026-09-12 on a run that followed three other suites back to back. The
whole `select.spec.ts` file failed at line 101 — `expect.poll(() =>
menuRows(app).then(r => r.length)).toBeGreaterThan(0)` received 0 after 9.9
s — and every one of the file's nine tests passed on retry, the same
assertion in 46 ms.

The menu is drawn by Obsrv rather than by the platform: the trigger goes
through the preload hook into main and back out as an overlay. The first
open after a cold app start does that round trip with everything else the
app is doing at launch, and under load it can miss the poll window; the
retry finds an app that is already warm.

**Telling it from a regression:** a regression fails on the retry too, and
fails alone. This shape fails once, takes the rest of the file down with it
(they share the app), and the whole file is green on retry in two orders of
magnitude less time. If you see it after a change that does not touch
`src/preload`, `src/main/ipc.ts`'s select handling or the overlay renderer,
it is this.

## `tabs.spec.ts:755`: the 30 s hang that was a product bug

Seen on CI 2026-09-14: `tabs come back on relaunch › restores the urls, the
screen and which tab was in front` failed at **exactly 30.0 s** with no
assertion and no error, then `Worker teardown timeout of 30000ms exceeded`
took the eight tests after it down unrun and turned the run red. It passed on
retry in **4.4 s**. A 7× overshoot is not load drift.

**Two hypotheses were wrong**, and both were killed by measurement rather than
by argument:

1. *The single-instance lock.* The lock is keyed on the userData path and this
   test relaunches on the same one, and `src/main/index.ts` says a loser
   "exits before it has a window" — so `rendererWindow`, which has no timeout,
   would wait forever. Probed five relaunches at 1258% CPU: `close()` always
   waited for process exit and the relaunch always got its windows. Dead.
2. *`NAVIGATE_WAIT_MS` equals the test timeout.* Both are 30 s, which is a real
   collision — but a probe measured the hang at 30 s with the budget set to
   8 s, proving the budget was not in that path at all.

**What found it** was the artifact, not the reasoning. `gh run download -n
playwright-traces` yields `error-context.md`, whose page snapshot is the app
at the moment of the timeout: one tab titled *New tab*, preset `1080p 24"`,
the empty state. A fresh app that had never navigated — so the hang was the
*first* navigation, not the relaunch.

**The root cause was in the product.** `handle(IPC.navigate)` returned
`navigateBoth`, which resolves on `did-finish-load` and has no budget; the
agent's path had been given `navigateWithin` for exactly this reason and the
renderer's had not. `Toolbar.go` and `EmptyState` both *await* that answer
before syncing the address field, so on a page that never finishes loading a
real user is left looking at a loaded page with the address they typed still
pending, with nothing that will ever resolve it. The test drove that channel
and inherited the hang.

**Telling it from a regression:** this one is not flaky in the usual sense —
it is a real unbounded wait that only shows when the host is slow enough for
`did-finish-load` to be late. Fixed by routing the renderer through the same
budget, and by giving the e2e harness a navigate budget (8 s) meaningfully
under Playwright's 30 s per-test timeout, since a budget equal to the timeout
can never be observed. `tests/unit/e2eBudgets.test.ts` fails if those two
numbers are ever brought back together.

## `sync.spec.ts:138`: a flake made of a suppressed event

Seen on CI 2026-09-14, failing **both attempts** — so not a flake bounce —
with `seen.length` 0 where 1 was expected: the target had ended on the right
URL without ever reporting that it moved. The same commit had passed CI 90
minutes earlier, and the tree between them was documentation only.

**The cause was the mirror fix suppressing the event it was asked about.**
`TargetSource` withheld `url-changed` entirely while `mirroring` was set, and
that flag is only true while `load()` is in flight. A client-side redirect's
second commit therefore landed *inside* that window on a slow machine and
*outside* it on a fast one. Probed directly: the target committed
`redirect.html` and `hairline.html`, and only one of the two reached
`url-changed`. Locally that was enough for the assertion; on CI neither
escaped.

Fixed by marking rather than withholding — the event always fires and carries
whether the bus caused it, and the two consumers that must ignore a mirror
(`syncBus`'s mirror-back and the arrivals counter behind "navigated after it
loaded") drop it themselves. Nothing now depends on that timing. Clean `main`
failed the test 1 run in 6 locally; with the fix, 0 in 6.

**Two things this cost on the way, both worth knowing:**

*Wiring `did-navigate-in-page` to the same flag broke the loop test.* In-page
commits were never suppressed, so marking them stopped the bus mirroring them
and "quick legitimate reversals are not a loop" began failing half its runs.
That line takes `false`, not the flag.

*A new test in `sync.spec` destabilised its neighbour.* That file shares one
app, and the loop breaker counts direction reversals within `LOOP_WINDOW_MS`
(3 s), so a test that drives four commits and hands over primes the counter
for whoever runs next. A 3.2 s settle did **not** fix it; three attempts at
timing the handover failed. It lives in `sync-mirror-mark.spec.ts` with its
own app instead — the coupling was shared state, not timing, and the remedy
for shared state is not sharing it.

## `target-source.spec.ts:234`: one click that did not land, on the day its subject changed

**Seen once**, 2026-09-17, on `#324`'s suite (`35261737827`, head `014095e`): *"forwards clicks into the
offscreen page"* failed its first attempt and passed its retry. The assertion is the page's own title
after the click:

```
> 271 |   expect(title).toBe('clicked')
Received: "data:text/html,<body style%3D…<button …onclick%3D…"
```

The title was still the document's URL, so the `onclick` had not run — the click did not reach the
page, or had not yet when the title was read.

**Why it was chased rather than shrugged at.** `target-source.spec.ts` covers `TargetSource`, and
`#314` had changed `TargetSource` that same afternoon — a new guard dropping paints from a window the
source has already replaced, plus a layout-epoch counter. A first-try failure in the spec covering
code you changed hours earlier is the one you do not get to call a flake by assertion.

**What says it is not `#314`:** five `main` runs contain that merge — `241cad2`, `8aed03c`, `006faa7`,
`eab17fe`, `3653511` — and **none** has a `target-source` failure of any kind. `#324` itself changes
only `playwright.config.ts` behind a flag CI never sets, a `package.json` script, a unit test and
prose; nothing on the input path. The change it would have to be is a dropped *paint* breaking a
*click*, and the two do not meet.

**What is NOT established:** the cause. One sighting, no repeat, no instrumentation. It is recorded
here so the second sighting is a pattern rather than a rediscovery, and so nobody re-derives the
"is it `#314`?" question that five clean runs already answer.

**Not the same test as** `target-source:106` (the partial dirty rect), which
`chore-flaky-leaders-0917` counted. That one is about paints; this one is about input.

## `vision.spec.ts:47`: the pixel was white, which answers a question the card left open

**Seen again** 2026-09-17 on `#325`'s suite (`35266612365`, head `f57477d`), first attempt, passing on
the retry. Same test and the **same numbers** `bug-flakes-gate-the-gate` recorded — `expected > 295,
received 255` — so this is that flake and not a new one.

**What is new is the rest of the message.** The assertion prints the whole pixel, and it was
`middle pixel rgb: [255,255,255]`. **Pure white: all three channels equal, nothing painted there
yet.** The assertion is `normal[0] > normal[1] + 40`, so it fails on white for the same reason it
would fail on a weak red — a magnitude comparison cannot tell "the colour came out 14% short" from
"there is no colour here at all".

**That matters because the card asks exactly this question.** `bug-flakes-gate-the-gate` singles this
test out as *"a number that came out wrong … it may be the only one here that is a rendering defect
rather than a scheduling one, and it should not be filed alongside the others without someone looking
at that separately."* A white pixel is the scheduling answer, not the rendering one: the frame the
assertion read had not been painted. **One sighting does not settle it** — the card's own sighting
may have carried a different pixel, and nobody recorded it — but the next person to look should start
by printing the pixel rather than the channel, because the two hypotheses are distinguishable and this
assertion already prints what distinguishes them.

**Not caused by `#325`,** which was the reason it was chased: that PR shortens the target pane by 26 px
while the hint shows, and it had already shifted two measurement specs. A 26 px shift moves the sampled
point *within* the content; it does not turn it white. And the four `diagonal-hint` tests passed on
their first attempt in the same run.

**Counted 2026-10-06 (`#3887`): two firings in the 178 readable suite jobs, both white, both rescued.** The test ran in 174 of the
178 readable suite jobs (runs created from 2026-09-27, every attempt, raw API; first run created 09-28 16:28Z, last 10-06 04:26Z). First-attempt `✘` in **two**, each passed on
`retry #1`, none failed on a retry: run `36556822266` (created 09-29 10:38Z; suite job `109374902472`; test 625, 438 ms, retry 373 ms) and run
`37410068785` (created 10-06 03:40Z, suite job `112096421115`, `#586`'s pull-request run; test 659, 639 ms, retry 324 ms). **Both print
`middle pixel rgb: [255,255,255]`, `Expected: > 295, Received: 255`** at `vision.spec.ts:114`: the pure white this entry describes.
It did not run in four of those jobs, all cancelled before reaching it: `37408764721` (when `#586` was pushed), `36467712974`, and
the attempt-1 jobs of `37123672372` and `37294469890`; two more jobs (`111969388200`, `111969404835`) are unread (404). **Corrected
2026-10-06:** this paragraph first said 176 of 180 and named two 7 KB logs that were attempt 2's board-only logs. **The window does not reach** the 09-17 sighting above or the three runs
`board/bug-vision-47-normal-not-red.md` cites (`34977896287`, `35853805499`, `35874763546`). Not a rate; no cause. Dogu's and
Idris's counts agree (`#3895`), and Wren pulled both rows from the raw API (`#3889`).

**Seen again 2026-10-06, and the pixel was black (`#592`'s suite, run `37463948210`, job `112270207388`, attempt 1, `success`).** First attempt `✘` in 136 ms, `retry #1` `✓` in 334 ms;
`Error: middle pixel rgb: [0,0,0]`, `Expected: > 40, Received: 0` at `vision.spec.ts:114:68`. **The first sighting whose pixel is not white** (Wren, `#4092`: the fifth sighting and the fourth with a pixel; Wren's count, not re-derived here, and the card
`board/bug-vision-47-normal-not-red.md` is Henry's). Two things this changes in what this entry says above: **(1)** the inference "pure white: nothing painted yet" leaned on white being the page's background, and black has no such
reading, so "the frame had not been painted" is a reading that still fits and is no longer the one the pixel points to; a black pixel fits a surface that was never filled, a cleared backing store, or a capture of nothing, and the entry does not know which.
**(2)** The assertion cannot tell them apart either, as above: `normal[0] > normal[1] + 40` fails on `[0,0,0]` for the same reason as on white. What is still true: every firing this register records passed on its retry, the pixel is printed, and the next
person should read the pixel before the channel. Not a rate, no cause, and no change to the 2-in-178 count above (this run was created after that window closed at 04:26Z).

## `throttle-live.spec.ts:55`: the un-throttle ratio, contention only

`the menu applies a CPU rate to the target: the same work takes several times
longer, and the footer says so` (`tests/e2e/throttle-live.spec.ts:68`) measures
three points: `plain` (cold, before any throttle), `slow` (under `cpu-6x`), and
`back` (after returning to `none`). The failing comparison is the third,
`expect(back / plain).toBeLessThan(2)` — after un-throttling, the same work
should cost under 2× its original cold time. Seen 2026-09-17 (`35250655036`,
`#314`'s PR) at 3.74×; retried green.

Not new. `board/bug-ci-main-red-37pct.md` counts `throttle-live` ×11 among its
flaky-then-green tally and `throttle-live:55` once in its per-line breakdown —
twelve sightings now, all recovered on retry, none ever a final red.

No mechanism confirmed. Two candidates, neither measured: the debugger's
CPU-throttle removal (`Emulation.setCPUThrottlingRate`) settling with some
latency rather than instantly, or plain CI-runner contention — which this same
suite's own comments already blame for a different ratio elsewhere ("a low
[applied count] is a slow or loaded runner, not the product,"
`live-capture-notes.spec.ts:329`). Twelve for twelve retry recoveries is the
evidence for calling this noise; nobody has measured which of the two it is.

**CORRECTION 2026-10-03 (the sightings sweep, below): "twelve for twelve, none ever a final red" no longer holds, and
this entry covers one of two assertions.** In the 170 `ci.yml` runs since 09-28 this test failed four times, on **two**
assertions: `back / plain < 2` (4.34 on `main`, `36530455782`; 4.21 on a PR branch, `36705363590`; both rescued; the one
above) and **`slow / plain > 3`**, which read 1.02 on `feat/flow-tool` (`36463050844`, rescued) and **0.98, then 1.00 on
the retry, on a `main` push, `36599810778` (the `#516` merge): a red `main`.** The two polls before `:62` read the app's
record of what was *asked for*, not an applied rate (`targetSource.ts:864-867` assigns `this.throttle` before it awaits
`applyThrottle()`; `ipc.ts:548-556` says the footer "still states what was asked for"), so a reading of ~1.0 says only
that the rate was not in force when the work ran, not why. Card: `bug-throttle-live-55-rate-not-in-force`. The test now
prints the state, the footer, `debuggerAttached` and a re-measure after 1500 ms when either ratio assertion is about to
fail. The paragraphs above are left as written.

## `arrivals.spec.ts:89`: the moved note, read once, right after a different signal settles

**FIXED ON `main` 2026-10-05 (`d7942280b`), so a failure here now is a REGRESSION, not a sighting.** This
entry below was written when the cause was a candidate; it is not one any more. A page's own redirect to
the address the sync bus was mirroring had its commit stamped as the bus's (`url === mirrorRequested`) and
dropped before the arrival count, so the note never arrived — it was never late. The fix is in
`src/shared/mirrorTerms.ts` (`isBusCommit`, `answeredOwnStart`) and `src/main/targetSource.ts` (a start is
answered once, by its commit, by `did-fail-load`, or by `did-stop-loading`).

**What is still open is the proof, not the diagnosis:** `bug-redirect-note-missing-not-late` stays in Doing
until `arrivals.spec.ts:89` passes on first attempt across **counted CI attempts**, because one is not a
sweep and local sweeps produced 0 of 60 on both the fixed and unfixed code. **If you are reading this after
a failure: count the attempt, say so on that card, and do not re-register this as a flake.**

`a page that really does redirect after loading still says so` polls the
target's URL until the redirect has landed (`expect.poll(...).toBe(HAIRLINE)`,
`tests/e2e/arrivals.spec.ts:97`), then makes one unpolled call to `movedNote()`
(`:52`, an `inspect` control call) and expects the "navigated after it loaded"
note to be there. Seen failing once (`35242092672`, `Received: undefined`),
green on retry in 516 ms.

The file's own header comment documents this exact shape for its sibling
test, measured: "a commit can be delivered after [the load promise] resolves
— measured at 4 ms late — so the mirror's own landing arrived unmarked." That
fix was to mark the event rather than poll around it, for a *different*
consumer of the same "navigated after it loaded" flag — the history is in
**this register's own entry** headed `sync.spec.ts:138` (at the line given by
`grep -n '^## .*sync.spec.ts:138'`), which is a heading here and not a line of
`tests/e2e/sync.spec.ts`. Idris read it as the latter while reviewing `#407`
and found a `setTimeout` counter, which is what is at that source line today;
the ambiguity was the register's, not the reader's, so it is spelled out
here. This test's consumer — `movedNote()` — was never given
the same treatment: the URL settling and the note being computed are two
different signals, and nothing here waits for the second one once the first
has settled.

**Recurred 2026-09-20 on run `35524174239`** — `#407`, the PR that added the
`toolbar.spec.ts:112` entry below, which is a docs-only change and so cannot be
the cause. Same failure, same `Received: undefined`, green on retry again.

**The sized fix was applied, and its own CI run refuted it. It has been removed.**
`expect.poll(movedNote, { timeout: 10_000 })` went in, and on run `35525940597`
it **sat the full 10 s and still got `undefined`** (10.6 s), then passed on retry
in 684 ms. Idris read that log and stopped the merge.

**So this is not a late note — it is a missing one**, and no timeout can fix a
value that is never produced. The poll made things slightly worse: it turned a
fast, honest failure into a ten-second one that reads like a timeout, which is
the costume a correctness bug should not be allowed to wear.

**What the mechanism looks like, unproven.** `ipc.ts:245` drops a commit when
`url === arrivals(s).url && !byDocument`. This test navigates to `hairline.html`,
then to `redirect.html`, whose `location.replace('hairline.html')` lands back on
the address the pane is **already recorded at** — so the note depends entirely on
`byDocument` being true. That comes from `startedByDocument`, which reverse-finds
`starts` for a matching url, and each entry's `byDocument` is
`details.initiator !== undefined` from `did-start-navigation`
(`targetSource.ts:489-495`). If that entry is missing or its `initiator` is
undefined on a given run, the commit is dropped and the note is **never** set.

That is a candidate **correctness** bug, not a test problem: the same path is how
a real page's self-redirect gets reported to a real user. Filed as
`bug-redirect-note-missing-not-late`. **Do not paper over it with a longer
wait**; the entry above that sized the poll was written before this evidence
existed and its recommendation is withdrawn.

**On "mark the event instead", which Idris raised before any of this.** Marking
is what the sibling consumer got and it is the better shape — but on this
evidence it would not have helped either, because the flag the mark would carry
is the one that is never set. The fix belongs upstream of both, in whatever
makes `byDocument` false for a genuine `location.replace`.

**This entry is the argument for the register.** It was filed as *"reasoned, not
run"* with a fix nobody had time for, and it sat here until the recurrence made
it worth doing. The alternative — investigating from scratch on the second
sighting — is what this file exists to avoid.

**Six sightings on 2026-09-28, and the candidate above now has numbers.** The
test is at `:181` today; this entry's heading keeps the line it was filed
under.

Counted across every CI log saved that night. `arrivals.spec.ts:181` failed its
first attempt on four runs (`#477`, `#478` twice, `#483`). `sync.spec.ts:139`
failed twice (`#483`, `#485`) and **those two are not the same failure**:
`#483`'s is `electronApplication.evaluate: Target page, context or browser has
been closed`, a teardown, unrelated to this entry; `#485`'s is
`the target emitted no url-changed`, `Received: 0`, which is this one seen from
the other side.

**One of the four was not a flake. `#478`'s first run failed both attempts** —
first try and retry #1, same assertion. It passed on a re-run, which is why it
merged, but a both-attempts failure says this can be deterministic within a run.
Every other sighting was rescued by the retry, and that is the whole reason the
word "flake" has stuck to it.

**What the guard's own account discriminates, and what it does not.** The block
prints `startsForThisUrl` — how many navigation starts `startedByDocument`'s
reverse-find had to choose between for `hairline.html`:

| run | first attempt | `startsForThisUrl` | retry | `startsForThisUrl` |
| --- | --- | --- | --- | --- |
| `#477` | note MISSING | **6** | note present | 2 |
| `#478` first run | note MISSING | **6** | **note MISSING** | 3 |
| `#478` re-run | note MISSING | **6** | note present | 3 |
| `#483` | note MISSING | **6** | note present | 3 |
| `#496` | note MISSING | **6** | note present | 2 |

Six candidates, **five** failures out of five. **Two or three candidates, four
passes out of five** — `#496`'s retry read 2, the same as `#477`'s. The one
exception is `#478`'s retry, which failed at three.

**The fifth row is the one that makes this more than curve-fitting, and it was
free.** The four rows above it are the sightings the prediction was *built from*.
`#496`'s is a sighting from **2026-09-29**, after the prediction was written down
here, on a branch that touches no redirect code, in a run nobody chose for this —
it was a retry-rescued cross on an unrelated feature PR, and the guard's own block
in that run reads `startsForThisUrl = 6`, `matched.fromBusDocument = false`. **A
prediction that holds on data it was not fitted to is worth more than one that
explains the data it came from**, so whoever runs the forcing test starts from
five for five rather than four for four. It is still not proven: nobody has forced
six starts on purpose, which remains the whole point of the route below.

**And the field that looks like the answer is not one.** `matched.fromBusDocument`
is `false` in every failing block — and also in every *passing* "note present"
block. On its own it discriminates nothing. The signal is the **count** of
same-URL starts the reverse-find is choosing among, which is exactly the
mechanism this entry already named: with six candidates it lands on a start whose
`byDocument` is false and the commit is dropped at `ipc.ts:245`; with two or
three it lands on the right one.

**So the forcing route this entry lacked is cheap:** drive enough same-URL
navigations before the redirect to reach six starts, then redirect. If that
reproduces on demand, the candidate above stops being a candidate. Nobody needs
to invent a fixture for it.

## THE ROUTE WAS BUILT AND IT REFUTED THE MECHANISM ABOVE, 2026-09-29

`tests/e2e/redirect-forcing-route.spec.ts` forces the condition and asserts the
one property that must hold either way: the start a redirect's commit is answered
with belongs to **that** redirect, by a boundary timestamp the test owns rather
than by a url match, which would restate `startFor`'s own predicate.

**Retired 2026-10-05** (`chore-e2e-specs-copy-the-deleted-startfor`). Its premise,
pool DEPTH and starts that are "never retired", stopped being true when `#558` made a
start answered once, and what it asserted (a recorded fact about the trace) is a subset of
what `redirect-mirrored-pool.spec.ts` now asserts through the product's own commit record.
The history below is left as written.

**In one CI run (`36578277923`), both arms:**

| arm | starts for the url | matched start | result |
| --- | --- | --- | --- |
| forced, all agent-initiated loads | 6 before, 7 after | `+55 ms` after the boundary, `byDocument: true` | **passed** |
| natural, `arrivals.spec.ts:181` | 6 — **2 mirrored, 4 not** | `mirrored: false`, **`byDocument: true`**, `fromBusDocument: false` | **failed** |

**The failing arm's matched start has `byDocument: true`.** The sentence above says
six candidates make the find land on a start whose `byDocument` is **false**, and
that `ipc.ts:245` then drops the commit. That line is
`if (url === arrivals(s).url && !byDocument) return` — **with `byDocument` true it
does not fire.** So whatever silenced the note on that attempt, it is not the drop
this entry has named since it was filed.

**What survives and what does not, kept apart on purpose:**

- **The correlation survives** — now **seven** sightings, every failure at
  `startsForThisUrl = 6`, every pass at 2 or 3. It is still the strongest signal
  here, and it is a correlation, which is all it ever was.
- **The explanation does not.** And the forcing route was built to force *that*
  explanation, which is the likeliest reason forcing it produced a pass: the right
  instrument aimed at the wrong story.

**No replacement mechanism is offered here, deliberately.** The obvious next
reading is that `fromBusDocument: false` is what silences it — and this card has
already burned two fixes on exactly that shape of reasoning, with the source's own
comments recording that neither half works without the other. A contradiction is
not a mechanism.

**The next question, which is concrete and testable.** The failing pool held **two
mirrored starts among its six**; the forced pool was entirely agent-initiated
loads, so nearly none. `startFor` skips mirrored starts, so two pools both counted
as "6" are not the same pool. The route to build next forces six **including**
mirrored ones.

**Read as evidence, not as a fix.** This is six logs counted, not a run —
promotion from *unproven* to *supported, with a way to force it*. **That promotion
was withdrawn on 2026-09-29 by the route itself; see the section below.** The
recommendation of the entry above still holds: do not paper over it with a longer
wait. Idris independently confirmed the `#478` row, both blocks and both numbers,
from the raw log.

## `select.spec.ts:69` — the presets menu measured taller than the window, once, 2026-09-29

**Named, not filed.** One sighting, on `#504`'s run (`36535881587`), retry-rescued.
`the menu stays inside the window, however long it is` asserts the menu's box fits
the renderer window on all four sides. The bottom edge failed:

```
Error: expect(received).toBeLessThanOrEqual(expected)
  Expected: <= 572
  Received:    919.59375
  > 76 |     expect(box.y + box.height).toBeLessThanOrEqual(win.h)
```

So the menu's bottom sat **348 px below** a window measured at 572 px high, and
`win.h` comes from `page.evaluate(() => window.innerHeight)` in the same helper,
two lines above the assertion.

**Two readings, opposite in consequence, and one log cannot separate them.**

1. **The clamp genuinely failed.** The test's name is the product's promise —
   *however long it is* — so a presets list taller than the window is supposed to
   be repositioned or scrolled, and was not. That is a real defect, and the
   dimensions fit it: **919 px is about the height of the full unclamped preset
   list.** Derived rather than asserted, by Idris while reviewing this entry:
   `.select-option` (`styles.css:448`) is ~5 px padding top and bottom plus text,
   `.select-group-label` similar, and there are 32 presets across a few groups —
   so ~24 px per option × 32, plus group headers and menu padding, lands in
   **870–920 px**. The arithmetic is here so the next reader can check the claim
   instead of redoing it, which is the only reason this file exists.
2. **Nothing was wrong with the menu; the window was mid-change.** `win.h` and the
   menu box are read in separate round trips, so a window still settling gives a
   height that never coexisted with that menu. The retry passing in the same run
   leans this way.

**The discriminator, for whoever picks it up:** log both numbers **and the
menu's own item count** at the moment of failure. A 919 px menu over a 572 px
window is the clamp failing; a 919 px menu over a window that is 919-or-more a
frame later is the measurement racing. Neither is guessable from the numbers we
have, which is why this entry does not choose.

**Not folded into `select.spec.ts:101`** — that entry is the overlay menu polling
to zero rows and timing out, a different failure at a different line. Sharing a
filename is not evidence, which is the `panes.spec.ts:85` lesson with a file in
place of a title.

## `sync-trace.spec.ts:77`: the loop fixture's 30 s budget, not a crash

`the loop fixture records trip, and the trace says so rather than only the
log` failed with `Target page, context or browser has been closed`
(`35242092672`), the same text this file's "`devtools.spec`: … was the app
crashing" and "`sync.spec`: the redirect test" entries both trace to a real
Electron crash. Checked for the crash-watcher's own signature before
concluding anything — `launchApp` has printed `exited on its own` or `crash
report for pid` for every confirmed crash since 2026-09-03, and neither line
appears anywhere in this run's log. That rules a crash out here.

What is in the log: `[launch] app.close() has taken 10003 ms; killing pid
30903`, and the embedded timestamps in that block match the ones in the
failing test's own captured browser log byte for byte — the same app
instance, not a reused pid. The test's own call (`load('native', LOOP)`,
awaiting Obsrv's `load()` promise on a page built to retrigger the loop
breaker) ran into the suite's 30 s test timeout; the `afterAll`'s
`app.close()` then hit the same busy process and was itself force-killed at
the 10 s bound. The closed-browser error a reader sees is what the test body
gets once teardown has already killed the process, not the root cause — the
root cause is this specific operation not finishing inside 30 s once.

Reasoned, not run (1 sighting). If it recurs: raise this test's own timeout
first, since a loop-breaker fixture racing a fixed 3 s window
(`LOOP_WINDOW_MS`, see `sync.spec.ts:138`'s entry above) on a loaded runner is
a narrower margin than most of this suite already accepts elsewhere.

## `live-capture-notes.spec.ts:183`: the stale-frame note crowds out the onion-skin one

`a window capture of a painting page with the skin on says the ghosting is
the animation` expects the reply to contain the onion-skin blending sentence
and instead gets a different, real warning: *"the pane may show an older
frame: the renderer drew frame N, the latest sent to it is M"*.

Two sightings, the identical shape both times, recovered clean on retry both
times:

    35340072824  drew 257, latest 269  (main, #351's merge run)
    35349396117  drew 259, latest 276  (main, #353's merge run)

Henry also read a third instance of this same shape earlier the same night,
without a run id to hand — noted here as his account, not independently
re-checked.

Not investigated beyond the shared shape. Both notes can be true of the same
capture — a frame stale enough to trip the pane-drift check is also stale
enough that the onion skin's own "keeps painting" comparison should still
see it — so this reads as one note's producer returning before the other's
runs, not as either sentence being wrong. Reasoned, not measured: nobody has
read the two producers' order in `capture.ts` yet. Left in the register
because it now has a consistent signature across sightings, not a fix.

## `live-drive.spec.ts:1069`: a resize capture that came back settled, once

**First sighting 2026-09-20**, on `#388`'s run `35493231097`:

```
✘ live-drive.spec.ts:1069 — a pane still being resized when the budget runs out is
  captured as moving, and names a motion that matches its warning
  expect(body.settled).toBe(false)   Expected: false   Received: true
```

**Why it was chased rather than waved through.** `settled: true` on a pane that is still moving is the
shape of `bug-live-raster-settled-while-resizing`, and the PR it appeared on changes the settle and
epoch path (`captureQuiescent`, `bug-live-raster-text-scale-mid-capture`). A flaky in the area a PR
touches is the one case where "recovered on retry" is not an answer.

**What the samples say, and they are few.**

| | `:1069` |
| --- | --- |
| `#388` run `35493231097` (with the change) | **failed**, recovered on retry |
| `#388` dispatch `35495456722` (same head, second sample) | **passed**, 15.2 s |
| `#389` run `35493020338` (full suite, without the change) | passed |
| local, 3 runs on the branch | passed |

The second CI sample was taken as a `workflow_dispatch` on the branch rather than a push, deliberately,
so the head did not move and a reviewer's verification of the content stayed valid.

**Reasons to read it as runner noise rather than a regression:** the second sample flaked a *different*
and unrelated test (`inspect.spec.ts:98`, a 30 s timeout — also a first sighting, recorded here by
mention), which is what a loaded runner looks like; and the code added on that branch is a single field
read inside an existing `if (resized || epoch !== frameEpoch)` branch, so it runs on size or epoch
changes rather than per frame, and on `TargetSource` it is `return this.unconfirmedEpoch` with no I/O.

**Reasons not to close the question:** one failure and one pass is not a rate, the local passes were on
a quiet desk and this project has already learned that a quiet desk cannot speak to a race
(`bug-drawer-stalls-part-open`), and nobody has read the resize path against the change line by line.

**If it recurs on a branch that does NOT touch `capture.ts`, it is noise.** If it recurs only on
branches that do, that is the finding this entry exists to make cheap.

**Do not run this spec locally to investigate it.** `live-drive.spec` has a recorded activation
(`bug-e2e-takes-the-desk.md:236` — *"fronts alone too"*), and running the single test with `-g` was
measured on 2026-09-20 to front the app on a developer's desk. `node scripts/desk-safe.js` answers this
before the run.

## `toolbar.spec.ts:112` — the settings toggle never arrived, 2026-09-20

**First sighting**, on `#400`'s run `35507247365` (`649029f`, the `c5` docs PR). One `✘`, passed on
retry, so the suite was green:

```
✘ 594 tests/e2e/toolbar.spec.ts:112:5 › every settings nav row starts its label at the same x (30.0s)
✓ 595 …(retry #1) (264ms)

    Test timeout of 30000ms exceeded.
    TimeoutError: page.click: Timeout 30000ms exceeded.
    Call log:
      - waiting for locator('.toggle-settings')
```

**What the numbers say on their own.** Thirty seconds waiting for a toolbar button, then the same test
passing in **264 ms** — a 113× gap between the two attempts of one test. That is not a slow assertion;
it is an element that was not there at all and then was there immediately. The first line names the
failure (`page.click` on `.toggle-settings`), so this is not a timeout wearing a teardown error.

**Why the change cannot be the cause, stated so nobody re-derives it.** `#400` touched
`docs/note-inventory.md` and `board/c5.md` and nothing else — no `src/`, no `tests/`, no build input.
A docs-only diff cannot alter when a renderer paints. **This is recorded as a fact about the runner,
not as a suspicion about a branch.**

**What it does not settle.** One sighting is not a rate ([[one-run-is-a-candidate]] applies to flakes
as much as to races), and "the renderer was slow to boot" is a story that fits the evidence rather
than a measurement of it. A second sighting on an unrelated branch would make it runner noise; a
second sighting clustered on branches that touch the toolbar or the window's show path would make it
a finding.

**Do not run this spec locally to investigate it** until `node scripts/desk-safe.js toolbar` has
answered — the standing rule is that an activation on the record is what decides, not the spec's name.

**`arrivals.spec.ts:71` — the sibling, failing the opposite way, 2026-09-20.** Run `35528436516`:
*"the target mirroring the native pane is not the page navigating"* failed its first attempt because
the note **was** there (`expect(received).toBeUndefined()` receiving *"the page navigated after it
loaded (to the same address)"*), then passed on retry in 520 ms. Its neighbour at `:89` fails when the
note is **missing**. Same guard, same field, opposite directions — recorded on
`board/bug-redirect-note-missing-not-late.md`, which this promotes from "a note goes missing" to "the
signal is unreliable both ways".

**Read that pair together before touching either test.** Tightening one direction is how you ship the
other; the `bug-arrivals` comment in `ipc.ts:230-244` already records both halves being needed, and
these two flakes are those halves failing.

**And `controls.spec.ts:86` flaked on the same run** (`35525940597`) — *"a field commits on blur or
Enter, never on a keystroke"*, 30 s, a `field.blur()` timeout. First sighting, not previously in this
register, and not caused by `#407` (which touches `arrivals.spec.ts` and documentation). Recorded by
mention so a second sighting has something to land against; nobody has looked at it.

**A second data point, from this PR's own run.** `#407` (this entry) flaked too — but a *different*
test, `arrivals.spec.ts:89`, already in the register above. Two consecutive docs-only runs, two
unrelated tests, neither branch touching what it broke. That is what a loaded runner looks like, and
it is the same reading the `capture.ts` entry above reached from the same evidence. It is two points,
not a rate, and it says nothing yet about whether `toolbar:112` specifically will return.


## A shape, not yet a cause: a `page.click` that waits its whole budget, then lands instantly

Two sightings, 2026-09-20 and 2026-09-21, on **different specs in different files**, neither
previously in this register, both on **documentation-only branches** that cannot have caused them:

| run | test | first attempt | retry |
| --- | --- | --- | --- |
| `35507247365` (`#400`) | `toolbar.spec.ts:112` — *every settings nav row starts its label at the same x* | `page.click` timeout, **30.0 s**, waiting for `.toggle-settings` | **264 ms** |
| `35597133483` (`#411`) | `vision.spec.ts:35` — *choosing a deficiency names it in the footer* | `page.click` timeout, **30.0 s** | **80 ms** |

**The signature is the whole content of this entry:** a click waits the entire 30 s budget for an
element and then finds it immediately on the next attempt. A 375× gap between two attempts of one
test is not a slow selector; it is an element that was not there and then was.

**This is a different shape from the `arrivals` pair above, and the difference matters.** Those are a
real signal arriving wrong — present when it should be absent, absent when it should be present —
and they turned out to be a product bug. These two are the app apparently not being ready to be
clicked at all, which is a claim about startup rather than about any code under test.

**What this entry is not.** Two instances is not a rate, nothing here names a cause, and "the runner
was loaded" is a story that fits rather than a measurement. It is written down now, with both examples
in hand, because the alternative is two unconnected entries that nobody joins up later — which is
exactly what happened to the `arrivals` pair until they failed in opposite directions on consecutive
runs.

**What would make it a finding:** a third sighting of the same signature, or one of these two
recurring. At that point the question to ask is what is *common* to the first attempt — app launch,
the first window paint, a shared `beforeAll` — rather than anything in the individual test, since the
tests have nothing else in common.

**A third sighting of the signature, 2026-10-05** (found by Idris reading the log, `#3448`; entered here by Dogu). Run
`37290561363`, the pull-request run of `#560` at `dc019d9`, attempt 1, `completed/success`. `update.spec.ts:115`, *the
Settings block reports every state*, failed its first attempt at **30.0 s** and passed on retry #1 in **291 ms**, a 103×
gap:

```
TimeoutError: page.click: Timeout 30000ms exceeded.
Call log:
- waiting for locator('.toggle-settings')
- locator resolved to <button type="button" title="Settings" aria-label="Settings" aria-expanded="false" class="icon-button toggle-settings">…</button>
- attempting click action
- waiting for element to be visible, enabled and stable
at launch.ts:348   (openSettings, called from update.spec.ts:116)
```

**What the log says and does not say.** The toggle was **present**: the locator resolved to the real button, so
"it never rendered" is ruled out for this sighting, as it was for the `.toggle-panel` one below. What ran out was
Playwright's pre-click wait, and the log stops before naming which of *visible*, *enabled* or *stable* it was.
The click comes from `openSettings` in `tests/e2e/launch.ts`, a helper, so it is not `update.spec`'s own code. I
did **not** read the run's `error-context.md` (an artifact; I did not download it), so the page state at the
timeout is not known. One thing the table above shows and this entry had not said (Idris, `#3450`): sighting 1,
`toolbar.spec.ts:112`, waits on the **same locator**, `.toggle-settings`; the table does not name sighting 2's
locator (`vision.spec.ts:35`). Two of three sharing one button is read from the table, **not tested**, and is not
offered as the cause.

**Not a docs-only branch this time, and it still cannot be the change.** `#560` at `dc019d9` touches a card and
`src/main/targetSource.ts`, and every changed line in `src/` is a comment (I counted the non-comment changed lines
in that diff: 0). The run was also a **slow one**: the suite job took 27 m 46 s of the 30-minute cap, and it had
**two other first-try failures**, both already in this register under their own entries and both rescued on
retry: `image-mode.spec.ts:70` (30.0 s, then 594 ms) and `tab-switch-preset.spec.ts:89` (10.1 s, then 2.1 s). Three
retry-rescued first attempts in one run; the run ended green.

**What this does to the entry's own rule.** The rule above says a third sighting of the same signature makes
this a finding and moves the question to what the first attempts have in common. The table above has two; this
is another, so by the letter of that rule the signature now has at least three: a 30 s `page.click` that finds
its element at once on the next attempt, on a spec not in the table. It is **one run**, the first this register
records for `update.spec.ts:115`, and its other `update.spec` entries (`:133`, `:85`) are different mechanisms
(a `page.reload` timeout; a poll of `getUpdate()`), so nothing here joins them. No cause is named and no card
is filed by this paragraph; it records the sighting so that a fourth has something to land against.

**A fourth sighting of the signature, 2026-10-05 (`browser-identity.spec.ts:41`).** Found by Wren reading the log
(`#3469`); entered here by Dogu from the raw job log. Run `37294297527`, the pull-request run of `#561` at `d68d497` (a
docs-only head), attempt 1; the run was later stamped `cancelled` (superseded) but its suite job finished `success`,
10:05:43Z to 10:30:41Z (24 m 58 s). `browser-identity.spec.ts:41`, *a dense laptop is still a desktop browser*, failed its
first attempt at **30.0 s** and passed on retry #1 in **1.4 s**:

```
TimeoutError: locator.click: Timeout 30000ms exceeded.
Call log:
- waiting for locator('.preset-select')
- locator resolved to <button type="button" role="combobox" … aria-label="Target screen" …>
- attempting click action
- waiting for element to be visible, enabled and stable
at helpers/select.ts:194   (choose)
```

**What the log says and does not say.** As with `update.spec.ts:115`, the locator resolved to the real control, so "it never
rendered" is ruled out; what ran out was Playwright's pre-click wait, and the log does not say which of *visible*, *enabled* or
*stable* it was. The run's `error-context.md` (an artifact) was not read. This file is `serial`
(`test.describe.configure({ mode: 'serial' })`), so the failure took the other four tests of the file down with it: they
show `-` on the first pass and ran again, all five, on the retry.

**Where it fell, for the entry's own question.** It was **test 3 of the run**, the first test of its file, in an app launched
for that file at 10:07:35. `update.spec.ts:115` was test 646 (not the first of its file) and `toolbar.spec.ts:112` was 594, so
the failures are not all at app launch. The same run's other first-attempt failure, `sync.spec.ts:139` (5.1 s), is a different
mechanism with its own entry. **No cause is named, and one more sighting is still not a rate.** The locators so far are
`.toggle-settings` (twice), `.preset-select`, and `.vision-deutan` for `vision.spec.ts:35`, which this entry did not name and
whose job log shows never resolving (read 2026-10-06, under the fifth sighting below): not one button.

**A fifth sighting of the signature, 2026-10-06 (`fit-pan.spec.ts:93`).** Found by Dogu reading the `main` push suite for the
`#586` merge (`#3868`); Idris and Wren pulled the same job and read the same figures (`#3869`, `#3875`). Run `37413726703`,
`push` at `6a04f0f13`, suite job `112107660736`, attempt 1, `success`. `fit-pan.spec.ts:93`, *fit draws the whole viewport inside
the pane and the footer says so*, test 202, failed its first attempt at **30.0 s** and passed on retry #1 in **723 ms**:

```
TimeoutError: locator.click: Timeout 30000ms exceeded.
Call log:
- waiting for locator('.view-1x')
- locator resolved to <button type="button" class="view-1x" aria-pressed="false" title="Actual size …">Actual</button>
- attempting click action
- waiting for element to be visible, enabled and stable
at setView (fit-pan.spec.ts:41)
```

**What the log says and does not say.** As with `toolbar.spec.ts:112`, `update.spec.ts:115` and `browser-identity.spec.ts:41`,
the locator resolved to the real control, so "it never rendered" is ruled out *for those*, and the log does not say which of
*visible*, *enabled* or *stable* it was. **That does not extend to `vision.spec.ts:35`** (Idris, `#3904`; read again by Dogu from the
raw job log, run `35597133483`, suite job `106324485776`): its call log is the single line `waiting for locator('.vision-deutan')`,
and the job log has no `locator resolved` and no `attempting click action`, so for that one the locator never resolved in 30 s,
which the log reads as consistent with the element not being found and does not explain. That is a different shape from the
other four, and nothing here says the five share a cause. The `fit-pan.spec.ts:93` failure was **not the first test of its file**:
`fit-pan.spec.ts:85` passed in 55 ms at 04:38:45.820Z; the app the kill line names (pid 30688) had started at 04:38:44.114Z, before it, and the failing click began after it.
This file is not `serial`: the retry ran this one test. **The harness's kill line follows it** (`app.close() has taken 10003 ms`,
a silent tail), 40.153 s after test 85 passed; less the 10.003 s close, that is 30.150 s, the click's budget (Idris, `#3871`), so
the close came after the timeout. **No cause is named, and one more sighting is still not a rate.** The locators so far are
`.toggle-settings` (twice), `.preset-select`, `.view-1x`, and `.vision-deutan`, which never resolved: not one button. The
error-context artifact and `playwright-flaky` (id `11390724548` on this run) were not read.

**What the suite minutes say about the first attempts** (Idris's table, recomputed by Dogu, 2026-10-05; the file lived in
a session scratchpad that did not survive a restart, so the figures are as posted in the room, `#3665` and `#3666`, and the raw
CI logs they came from are on GitHub). The entry's own rule asks what is common to the first attempt that stalls; the cheapest first cut is how long
the runs that show it were. Population: every macOS suite job log Idris holds that has an e2e total, deduplicated by content,
**40 rows**, Oct 2 to Oct 5, pull-request merge-ref runs and `main` pushes together, two of them `attempt 2`. **Not a sample of
anything:** the logs were pulled for other reasons. The e2e minutes are the one Playwright `passed (X m)` line.

| | n | min | median | max |
| --- | --- | --- | --- | --- |
| all rows | 40 | 19.6 | 22.6 | 26.1 |
| since `#540` (2026-10-03T22:35Z) | 36 | 19.9 | 22.65 | 26.1 |

**The two runs that show the click-wait text** ("visible, enabled and stable"): `37290561363` (`update.spec.ts:115`) at **25.7**
minutes and `37294297527` (`browser-identity.spec.ts:41`) at **23.1**. **The file does not support "the slow runs are the ones
with the stall":** the slowest e2e step, `37294469890` attempt 2 at 26.1 minutes, had no first-attempt `✘`, and `37319268852`
ties 25.7 with one unrelated flaky. Dogu cross-checked the table against 36 logs both held at the time, and the e2e minutes agreed in all 36 (`#3666`).
Columns Idris dropped as unreliable (log-span minutes, which include queue time on whole-run views, and the `(retry #` count)
are not used here.


## `live-capture-notes.spec.ts:231` — a resize capture that applied one of five, 2026-09-21

First sighting, on `#407`'s run `35603353610` — a documentation and test-comment branch that touches
no `src/`, so not the branch's doing. One `✘`, green on retry:

```
Error: try 2: settled=true label=undefined applied=1 capture=1823ms size=1280x1024 warnings=[]
expect(received).toBeGreaterThanOrEqual(expected)
Expected: >= 5
Received:    1
```

**What the line already tells you, because someone made the failure print its own state.** The capture
**settled** (`settled=true`), it took 1823 ms, it ended at the right size, and it raised **no
warnings** — and only **one** of at least five resizes had been applied when it answered. So this is
not a capture that failed; it is a capture that succeeded early and said nothing was wrong.

That is the same family as `live-drive.spec.ts:1069` above (*"a resize capture that came back settled,
once"*), and the pair is worth reading together: both are the raster answering **truthfully about a
moment** that arrived before the thing under test finished happening. Neither is the app breaking, and
neither is a timeout — which is why a longer budget is the wrong instinct here, as `arrivals.spec.ts:89`
above demonstrated the hard way.

**Not established:** whether the resizes were slow to apply or the capture was quick to settle, which
are different defects with the same line in the log. `applied=1` is the count the test read; nothing
here says when the other four landed, or whether they did.

**If it recurs**, the cheap next step is printing the timestamp of each applied resize alongside
`applied=`, so the two readings separate without a debugger.


## `live-drive.spec.ts:210` — the control socket hung up, 2026-09-21

First sighting, on `#424`'s run `35641299420` — a **documentation-only** branch, so not its doing.
One `✘`, green on retry:

```
2) tests/e2e/live-drive.spec.ts:210:5 › navigate + setPreset over HTTP actually drive the app
    Test timeout of 30000ms exceeded.
    Error: socket hang up
```

**`socket hang up` is the finding, and it is not the same shape as the other timeouts here.** The
`page.click` pair above (`toolbar.spec.ts:112`, `vision.spec.ts:35`) wait the full budget for an
element that then appears instantly — the app is up and the thing is not there yet. This one is the
**agent-control HTTP connection dying mid-request**: the client got a socket closed under it, not a
slow answer. Different layer, different question.

**Not established, and the log cannot say:** whether the app closed the connection, the server never
finished writing, or the test's own request was torn down at the 30 s deadline and `socket hang up`
is the *consequence* of the timeout rather than its cause. The order matters and one sighting does
not fix it.

**If it recurs**, the thing to read is whether the control server logged the request at all — that
separates "never arrived" from "arrived and the answer was lost", which no amount of client-side
timing can. `bug-drive-instance-clobber`'s history is relevant if a second instance is ever in play,
though nothing here suggests one was.

## `cli-walk.spec.ts:192`: the grown page was still growing, and a different sentence answered

Seen once, on run [`35838826196`](https://github.com/vibesyemmy/obsrv/actions/runs/35838826196)
(`#449`, 2026-09-23), rescued on retry in 1.3 s.

```
Expected pattern: /the page grew as it was walked/
Received string:  "this page was still moving when it was measured: 40 had been replaced in the
                   252 ms after the figures were taken — …"
```

**Two sentences compete for the same run, and they answer different questions.**
`grows-as-walked.html` is a feed that extends as it is scrolled, so it is *designed* to be moving
when the measurement lands. `walkCoverageNote` says *"the page grew as it was walked"* only when the
page ends up **taller than the walk covered**; the motion probe says *"still moving when it was
measured"* when boxes move in the 250 ms **after** the figures are taken. A page that keeps growing
can satisfy the second and miss the first, depending on which side of the probe its last growth
lands.

**What this is not.** It is not the walk losing its way, and on the run where it was seen it was not
the branch's own change either: `#449` carried `#446`'s new `walkHostNote`, and that sentence is
emitted only for an **element** scroller. `grows-as-walked.html` declares **no `overflow` at all**,
so the document scrolls its root, `walkStep` sends no `host`, and `textOutsideHost` never runs.
The assertion also joins **all** warnings before matching, so an appended sentence cannot displace
what it looks for. Both checked rather than assumed (Idris verified the fixture independently).

**If it recurs**, read which of the two sentences arrived, not whether the test failed: the motion
note means the growth was late rather than absent, and the walk's own account of the page is
unaffected. A fix, if one is ever wanted, is a fixture that stops growing before the probe — not a
longer wait, which cannot make a still-growing page settle.

**Counted again, 2026-10-06.** In the 178 readable suite jobs (09-28 to 10-06 04:26Z, raw API, every attempt) the test has six
first-attempt `✘`, in six runs, each passed on `retry #1`: `36463050844` attempt 2, `36592408376`, `36596468138`, `37123672372`, `37160406685` attempt 2, `37346134084`. **`#588`'s attempt 1 (`37428504822`) is the seventh:** 1.3 s,
retry ✓ 1.2 s, and the sentence that arrived instead was the motion note ("this page was still moving when it was measured: 40 had
been replaced in the 255 ms after the figures were taken"). Which sentence arrived in the six was not re-read. Not a rate; no cause.

## `frame-bus.spec.ts:40`: the wait admitted an unpainted frame

Seen once, on run [`35851213703`](https://github.com/vibesyemmy/obsrv/actions/runs/35851213703)
(`#454`, 2026-09-23), rescued on retry in 98 ms.

```
expect(received).toEqual(expected)
- Expected: [255, 0, 0, 255]     // #0000ff in BGRA — the page's blue
+ Received: [0,   0, 0,   0]     // nothing drawn yet
```

**The mechanism is in the wait, not the bus.** The test loads a blue page at 200x100 and waits for a
frame at that size whose **green channel is 0**, a test written to skip the white `about:blank` that
precedes it. **Green is also 0 in a fully blank frame**, so a frame at the right size whose pixels had
not been painted satisfied the predicate, `findLast` picked it, and the assertion compared blue
against nothing.

**Fixed at the cause** rather than recorded and left: the predicate now also requires
`first4[3] !== 0`, so it waits for a frame with opaque alpha — one that was actually drawn. **This
cannot hide a product defect.** If the bus ever delivered only blank frames, the wait would time out
and the test would fail loudly; before the change it could pass on one and fail on the next run.

**If something like it recurs**, the question to ask of any `first4` predicate is which frames it
*admits* rather than which it excludes: the white-page guard here was written against one wrong frame
and silently accepted a different one.

## `tab-switch-preset.spec.ts:89`: the failure landed before the spec's own instrumentation

Seen once, on run [`35875864196`](https://github.com/vibesyemmy/obsrv/actions/runs/35875864196)
(`#459`, 2026-09-23), rescued on retry.

```
Error: expect(received).toBe(expected)
Expected: true     Received: false
   91 |   expect((await call('setPreset', { id: LAPTOP.id })).body.applied).toBe(true)
```

**It failed on the test's FIRST `setPreset`** — a setup step, before any tab is opened or switched, and
before the behaviour the test exists to check. The card this test guards,
`bug-preset-after-tab-switch-lands-on-the-other-tab`, is **done**: the defect was reproduced with the
gap forced open and fixed. **A flake here does not mean that bug is back**; it means the test's own
setup did not hold.

**Two readings the log cannot separate.** `applied: false` is either *the app had not finished bringing
the viewport up, so nothing applied*, or *the viewport was already at `laptop-768`, so there was nothing
to change*. Both produce the same byte.

### The gap worth fixing before the next sighting

**The spec prints `[tab-switch] …` lines, and every one of them is downstream of this assertion.** The
run's log carries instrumented output from the *passing* attempt and **nothing at all** from the failing
one: a failure at line 91 produces no `[tab-switch]` line, because the first one is printed at line 102.

**So the earliest failure is the least instrumented**, which is the same shape as
`bug-vision-47-normal-not-red`'s first sighting throwing away the blue channel — the fact that decides
between the readings existed only inside an assertion that had already stopped the test.

**If it recurs**, the thing to add is not a longer wait: print the viewport and the resolved preset
*before* the first `setPreset`, so `applied: false` can be read as "already there" or "not up yet". That
is a two-line change to the spec and it is worth making the next time anyone is in the file.

### Counted again, 2026-10-06: five sightings, four different statements, and two that print the app's reply

Idris's table (`#3934`), each failing statement re-read by Dogu from the failure block's own `>` and `at` lines in the saved job
logs; the 09-23 row is this entry's own. Line numbers are as each job's tree printed them, and whether the spec changed between the
runs was not checked.

| run | date | length | failed at | the spec's `[tab-switch]` reply line | kill-line tail |
| --- | --- | --- | --- | --- | --- |
| `35875864196` (`#459`) | 09-23 | not re-read | `:91`, the first `setPreset(LAPTOP)`'s `applied` (this entry) | none: the line prints later | not read (before the kill-line sweep) |
| `36519694953` | 09-29 | 2.2 s | `:94`, the second `setPreset(LAPTOP)`'s `applied` | none | `quitting` |
| `36599810778` | 09-29 | 5.4 s | `:106`, the `rendererCaughtUp` poll, 3000 ms | `applied=false presetId=laptop-768` | `quitting` |
| `37290561363` | 10-05 | 10.1 s | `:93`, the `rendererCaughtUp` poll, 10,000 ms | none | `quitting` |
| `37425109815` | 10-06 | 5.4 s | `:106`, the same poll, 3000 ms | `applied=false presetId=laptop-768` | **silent** |

**What the printed line is.** `[tab-switch] setPreset reply: …` (`tab-switch-preset.spec.ts:101-102` on `main` at `857c5bc8`) is
the reply to the **phone** `setPreset` the test sends straight after `activateTab(b)` with the gap held open (`hold(HOLD_MS)`,
600 ms, through `OBSRV_TEST_TABS_CHANGED_DELAY_MS`, `ipc.ts:1371`). That is the call the test exists to check, not a setup step.
A passing attempt prints `applied=true presetId=iphone-61`; the two `:106` failures printed `applied=false presetId=laptop-768`.

**What `applied=false` means in the app.** `controlServer.ts:467` sends `setPreset` through `applyAndConfirm` (`:763`), which
applies the patch and polls `status` every 25 ms for up to `APPLY_WAIT_MS = 2_000` (`:81`) for `s.presetId === id && pageBack(s)`,
then replies `{ ok: true, applied, ...status }` (`:795`). So the failing reply says that for 2 s after the phone preset was
sent, `status` never showed `iphone-61` on the tab in front and still showed `laptop-768`. `applied` is the whole predicate and it
has two clauses; the failing reply prints `presetId=laptop-768`, so the first (`s.presetId === id`) is the one that did not hold,
not `pageBack`. "On the tab in front" is main's own record: `status()` resolves the tab at call time (`ipc.ts:1634` onward: an
agent's command "lands on whichever tab is in front when it arrives") and `uiState.presetId` reads `tab().presetId`
(`ipc.ts:917`); the code does not say which tab received the patch (Idris, `#3938`). The gap is 600 ms. Then `:106` waits
3000 ms (`HOLD_MS * 5`) for `rendererCaughtUp` (`:55`: the renderer's selected tab sits where main's front tab does) and did not
get it. **Only the two `:106` sightings are on the question the test's header says it was written for** (a preset sent between
main switching tabs and the renderer learning of it): `hold(HOLD_MS)` is `:98`, and `:91`, `:93` and `:94` fail before it, with no
forced gap, in plain apply and catch-up calls (Wren, `#3939`). A defect that exists only in the held gap cannot produce those
three, so the five cannot all be the done card's defect; at most the two at `:106` could. Idris saw the pairing first (`#3934`);
the source reading is Dogu's (`#3937`), checked by Idris (`#3938`).

**What this does not say.**
- **That the defect is back.** `bug-preset-after-tab-switch-lands-on-the-other-tab` is `column: done`, and its title says the
  defect was reproduced with the gap forced open and fixed (2026-09-16, Henry). The sentence above, "a flake here does not mean that bug is back", is about
  the `:91` shape; this entry did not cover `:106` until now, and nothing here reopens or edits a card (that is Henry's).
- **That it is not.** A runner starved past 2 s and 3 s fits the same two lines, and so does a stalled app: `applied=false
  presetId=laptop-768` is also what a reply prints when nothing was applied within 2 s. The logs do not show which tab received
  the preset, and the retry passed every time (2.4 s on the latest).
- Two `:106` sightings six days apart are a pair, not a rate. No cause. They differ in the close tail (`quitting` on one,
  silent on the other), so the tail is not set by which failure came before it.

## `cli.spec.ts:212`: a leaked temp dir after SIGTERM, and why this one is not noise

Seen **twice** on 2026-09-28, both rescued on retry: run
[`36463050844`](https://github.com/vibesyemmy/obsrv/actions/runs/36463050844) attempt 2 (`#477`), and
then [`36470833485`](https://github.com/vibesyemmy/obsrv/actions/runs/36470833485) — **the run of the
PR that added this entry.** Twice in roughly six suite runs that evening. **It is listed here because
it is the one entry in this file that is not a timing artefact:**

```
Error: expect(received).toEqual(expected)
- Expected  - Array []
+ Received  + Array [ "obsrv-cli-5iX7Fu" ]
```

The test snapshots every `obsrv-cli-*` directory under `tmpdir()` **before** spawning, SIGTERMs the
launcher mid-render, and asserts nothing new survives. A name appearing in that diff means **a temp
directory was genuinely left behind.** The assertion did its job; something did not clean up.

**The reading that would make it noise is ruled out.** With parallel workers, a sibling test's live
directory could show up in the diff and the assertion would be over-broad — but
`playwright.config.ts` sets `fullyParallel: false` and `workers: 1`. There is no sibling. And the
`before` snapshot excludes anything that already existed, so it is not an older run's rubbish either.

**Two readings remain, and this run cannot separate them:**

- **The test's own child leaked.** SIGTERM arrived before the CLI's temp-dir cleanup ran, so the
  signal won a race against teardown. That is a real intermittent product defect, and the retry
  passing means the race sometimes goes the other way.
- **A previous test's child leaked, and this test was blamed.** Tests run sequentially, but a prior
  child process need not have finished exiting when `before` is snapshotted — a directory it creates
  or abandons a moment later appears new to this test.

Either way **a directory was leaked**; what is unknown is by whom. The distinction matters because
the first is a bug in cleanup-on-signal and the second is a bug in attribution.

**The second sighting tilts it, without settling it.** Both runs leaked **exactly one** directory, with
different random suffixes — `obsrv-cli-5iX7Fu` then `obsrv-cli-GdfJSz`. A previous child leaking late
would depend on how two exits happened to overlap, and would not be expected to produce a count of
exactly one on both occasions; one child leaking its own directory would. That is a tendency, not
proof, and the creation-time measurement below is still what would answer it.

**If it recurs**, the thing worth capturing is the leaked directory's **creation time and contents**
against the spawn time of this test's child — that separates the two readings in one reading, where
the pass/fail alone never will. Note that a leaked directory now disappears on its own overnight for
an unrelated reason (something sweeps `/private/tmp`), so it cannot be inspected the next morning.

**Not investigated further here, deliberately:** `tests/e2e/cli.spec.ts` is not a file this session
may edit without Opeyemi's say-so, so this entry is a record rather than a fix, and nothing about the
spec or the CLI's teardown was changed.

## `panes.spec.ts`, the `page.press` timeout, named because it shares a test with a card it is not evidence for

Seen once, on run [`36232431630`](https://github.com/vibesyemmy/obsrv/actions/runs/36232431630)
(`#472`, 2026-09-26), rescued on retry in 339 ms.

```
TimeoutError: page.press: Timeout 30000ms exceeded.
Call log:
  - waiting for locator('.url-form input')
    - locator resolved to <input ... value="file:///…/tests/fixtures/hairline.html"/>
  - elementHandle.press("Enter")
```

The failing test is *"the target canvas shows the page, not a blank"* — `bug-canvas-blank-without-notice`'s
own test — which made the failure look like a sighting of that card at first glance. **It is not one.**
The card's recurrence signature is a specific assertion (`the canvas stayed blank: N white of M pixels`)
inside a `try`/`catch` that reads `frameSent()` and `session.painting` on failure, well into the body of
the test. This failure is at the test's **very first action** — `page.fill` then
`page.press('.url-form input', 'Enter')`, before the test has navigated anywhere, let alone measured the
canvas or run that diagnostic block. (No line number given on purpose: the first version of this entry
named one, and the comment added to the spec pointing back at this entry pushed that exact line down six
— the identical class of error this entry exists to warn against, caught by Idris before it shipped.)
Filing it as a dated sighting on that card would credit a mechanism (`frameSent`/`painting`) that was
never queried.

**Playwright's own semantics narrow it further than "the app was slow".** `fill` succeeded — the
locator resolved with the right value already set, so the element existed and was interactable a
moment earlier. `press` waits for *actionability*, and a selector failure fails fast; thirty full
seconds means the element was found and stayed **un-actionable** — covered, disabled, or unfocusable
— rather than the runner being generally starved (Henry, #2343).

**A specific, testable candidate, unverified: the loading strip that lives inside the URL field
itself** (`feat/url-loading-strip` put a CSS-transition element in that exact box). An overlay
sitting on top of the input for the whole budget is exactly what makes `press` wait forever rather
than fail immediately.

**What the artifact available for this run can and cannot say.** `playwright-flaky` on this run
holds a trace, but only for the **retry** (the passing attempt, 339 ms) plus the failing attempt's
plain-text `error-context.md` — no screenshot or DOM snapshot from the failure itself. So the
loading-strip hypothesis is the leading one, not a confirmed one: nothing in what was captured shows
the input's actual covered/disabled state at second thirty.

**If it recurs**, a trace with screenshots on the *first* attempt (not just the retry) would settle
it directly — check whether tracing is configured to retain on every attempt or only the last one.
Short of that, checking whether the loading strip's own transition can outlive a fast `fill`-then-
`press` sequence is the next cheapest thing to look at.

**The missing screenshot is the anomaly worth chasing, and it took a matched comparison to say so
safely.** `screenshot: 'only-on-failure'` is configured, and the failing attempt's own directory in
this run's artifact is present but holds only `error-context.md` — no PNG. That was first read as
evidence toward "the app was generally unresponsive," then retracted for resting on an unverified
step: nothing had shown the setting producing a file under this harness at all, and
`playwright.config.ts` already documents Electron silently ignoring a comparable trace setting.

**The retraction held until a matched case was actually measured, not argued.** Run
[`35807960696`](https://github.com/vibesyemmy/obsrv/actions/runs/35807960696)'s `playwright-flaky`
artifact — a flake, same harness, same config era — has exactly the shape ours is missing:
`error-context.md` **and three PNGs** (`test-failed-1/2/3.png`) in the plain (non-retry) directory,
confirmed independently by downloading the artifact directly rather than taking the file listing on
trust (Henry, #2364). **So the setting does fire for a flake's failed attempt in this harness — it
just did not fire for ours.** A page too wedged to be screenshotted is a different animal from an
input that merely changed state, and that gap between the matched case and this one is the thing
worth chasing on the next sighting, not an open question about whether the mechanism works at all.

## `image-mode.spec.ts:70`: a zero pixel where a dropped 2x export should read red, named rather than attached

Seen once, `#493`'s run (`36501957420`), retry-rescued in 629 ms. `a dropped 2x export is shown at
its 1x size` reads the canvas's centre pixel and expects it above 150 (red); it got 0:

```
Error: expect(received).toBeGreaterThan(expected)
  Expected: > 150
  Received:   0
  > 118 |   expect(px[0]).toBeGreaterThan(150)
```

`#493` touches `src/cli/reportHtml.ts`, `src/mcp/flowRunner.ts` and `src/mcp/flowTool.ts` — a
different subsystem entirely, confirmed by two people independently (Henry, Idris). Not this PR's
doing.

**Deliberately not filed against `bug-canvas-blank-without-notice`, on this same night's own
lesson.** `panes.spec.ts:85`'s `page.press` timeout was filed against that card by three people on
the strength of its title before any of them reached a canvas assertion at all — this sighting at
least *is* a pixel read, which is more than that one ever was, but a centre pixel reading zero
still fits two different causes with opposite consequences:

- a genuine blank canvas — the card's own subject;
- **a capture taken before the image painted** — a timing race, a different bug.

One log cannot separate them. The retry passing in 629 ms leans toward the race (the app painted
correctly moments later, on the same runner) without settling it — a canvas that stays genuinely
blank would not be expected to self-heal on a bare retry, but one run is a candidate, not a
measurement. **The discriminator is whether the canvas was ever painted**, readable from
`playwright-flaky.zip`'s trace for this run. Whoever picks this up should read the trace before
writing either cause down, the same way the matched-comparison entry above did for a missing
screenshot rather than arguing from what seemed likely.


## THE SECOND ROUTE WAS BUILT, AND IT DOES NOT REPRODUCE EITHER, 2026-09-29

`tests/e2e/redirect-mirrored-pool.spec.ts` is the route the section above asked
for: the pool's **composition**, not merely its count. The first route forced six
same-url starts and passed; the failing arm also had six, but **two of them were
the bus's own**, and `startFor` skips mirrored starts (`targetSource.ts:1064`), so
the two pools were never the same pool.

**How the composition is forced.** Mirrored starts at the redirect's landing
address come from the bus mirroring the NATIVE pane's redirect hop into the
target, so this drives `native.load(redirect.html)` directly — the same lever
`arrivals.spec.ts:139` uses for the other direction — with a `navigate` between
passes to contribute the non-mirrored half.

**It forces a pool strictly deeper and strictly more mirrored than the failing
one, and the find still answers correctly.** Local sweep, 11 runs (1 + 10 with
`--repeat-each`), 0 crosses:

| | starts for the landing url | of which the bus's | matched start |
| --- | --- | --- | --- |
| the natural failure (run `36578277923`) | 6 | 2 | an earlier visit — note missing |
| this route, 11 local runs | **9–12** | **6–7** | `byDocument: true`, `fromBusDocument: false`, **9–12 ms *after* the boundary**, every run |

**What that settles and what it does not.** It settles that pool depth and the
presence of mirrored starts are **not sufficient** to make `startFor` answer with
a stale start: on this machine a pool twice as deep and three times as mirrored as
the failing one is attributed correctly every time. It settles nothing about CI,
where this entry's own numbers are 3 in 20 against 0 in 40 locally — **a local
null here is the same weak evidence it was for the natural test**, and is written
down as a measurement of the route, not a verdict on the card.

**What to read when this runs in CI.** The route prints the pool before the
redirect and the matched start after it, on pass as well as failure, so a CI run
gives the comparison this entry has never had: the failing shape's pool and a
forced pool's, side by side, from the same runner. If the route passes in CI while
`arrivals.spec.ts:181` fails in the same run, that is a second refutation from the
other end — the condition is forced harder than the failure needs and still does
not produce it — and the search moves off `startFor` entirely.

**The card stays class 1 and stays open.** Two routes have now been built for one
named mechanism and both passed; the correlation (seven sightings, every failure
at six candidates) is unexplained, and a missing note is still a wrong answer the
caller cannot detect.

## `redirect-mirrored-pool.spec.ts:124` — a first-attempt failure on `#560`'s run, 2026-10-05

**One sighting, retry-rescued, the run green.** Run `37293811824`, the pull-request run of `#560` at `23701e6`,
attempt 1, `completed/success`. This spec is the second route built above to reproduce the `arrivals` redirect
bug; this is the first first-attempt failure of it this register records. Found by Idris reading the log
(`#3456`); entered here by Dogu from my own pull of the same log (461,375 bytes, 2,306 lines), where it is the
run's only `✘`: first attempt **1.9 s**, retry #1 passes in **2.0 s**. The failing line is the spec's last
assertion (`:168`, `toBeGreaterThanOrEqual(boundary)`):

```
Error: the commit was answered with a start from 205 ms before the redirect was triggered — an earlier visit to
the same address, chosen out of a pool of 11 where 5 were the bus's
Expected: >= 1791195659638
Received:    1791195659433
```

**What the test's own prints say, which is the part worth keeping.** Failing attempt: the `hairline` pool before
the redirect `{"total":11,"mirrored":5,"byDocument":3}` and after it `{"total":11,"mirrored":5,"byDocument":3}`,
**identical, so no new `hairline` start had been recorded when the test read the trace**; the start it matched
was `byDocument=false fromBusDocument=true`, 205 ms before the boundary. Passing attempt: `{14,5,6}` before and
`{15,5,7}` after, one new document-initiated start, 98 ms **after** the boundary.

**Idris's reading, inferred from the spec's code and those prints, not reproduced; I did not read the run's
`error-context.md`.** The loop's last pass (`i = 5`, odd, `FORCE_STARTS = 6`) leaves the target at `hairline`.
After the boundary the spec does `navigate(REDIRECT)` and then `await expect.poll(targetUrl).toBe(HAIRLINE)`
(`:153`), and that poll can be satisfied at once by the old URL, before the redirect has started; `startsNow()`
then reads a trace with no start for the redirect yet, so the newest non-mirrored `hairline` start is an older
one. I read those lines and the order is as described; whether the old URL really satisfied the poll in this run
is the part nobody has shown. **If so it is a race in the test, not in the product.**

**Not a regression of `#558`, on Idris's evidence, not re-done by me:** her diff of `main` before and after `#558`
shows it changed start recording only by adding `answered: false`, with no change to `at`, `url`, `byDocument`,
`mirrored` or `fromBusDocument`. Her history: no first-attempt failure in the 29 pre-`#558` CI logs she holds and
one in the 4 suites since; uniform over those 33 the one would fall among the last four 12 percent of the time
(4 of 33), so it is **not evidence of a regression**. I did not recount any of those logs.

**What this entry is not.** No cause is confirmed and no card is filed by it; the run was green and `#560` was not
held by it. A separate finding from the same message (`#3456`) is **not** this entry's business: this spec and
`redirect-forcing-route.spec.ts` still compute a copy of the `startFor` rule that `#558` deleted (`startFor` now
appears in `src/` only in three comments in `targetSource.ts`, which I grepped on `main`; no line numbers, because
they moved by five within minutes of my first grep, when `#560`'s comment edit merged above them); Wren routed that
as a chore (`#3457`).

## `redirect-mirrored-pool.spec.ts:176` — the converted spec's first first-attempt failure in CI, 2026-10-06

**One sighting, retry-rescued, the run green.** Run `37394200312`, the pull-request run of `#580` at `37b97e0`,
attempt 1, `completed/success`; the tested tree is `92ac39d Merge 37b97e0… into 2b279b3`, which carries `#567`
(the conversion of the spec above, merged as `17433b716`). Found by Idris reading the log (`#3818`, `#3819`); entered
here by Dogu from the raw job log (`112046223528`, 00:29:01Z to 00:54:34Z, 25 m 33 s; 193,868 bytes, 1,412 lines),
where it is the run's only `✘`: test 492 failed its first attempt at 00:49:26.7Z in **2.3 s**, and retry #1 (test
493) passed in **2.4 s**. The error is the spec's first recorded-fact assertion (`:273`, Idris):

```
Error: no document-initiated, non-mirrored start of hairline was recorded after the redirect was triggered
```

**What the spec's own prints say, which is the part worth keeping** (they are printed on pass and fail alike, before
any assertion). Failing attempt: the `hairline` pool before the redirect `{"total":13,"mirrored":6,"byDocument":4}`,
after it `{"total":14,"mirrored":7,"byDocument":4}`; **the `hairline` starts since the boundary are one entry,
`{+25 ms, byDocument false, mirrored true}`**; the commits since the boundary are `redirect` at +23 ms
(`mirroring: false`, `byDocument: false`, `answeredOwnStart: false`) and `hairline` at +38 ms (`mirroring: false`,
`byDocument: false`, `mirrorRequested: null`, `answeredOwnStart: false`). Passing retry: pool `{14,7,5}` before and
`{15,7,6}` after; the one `hairline` start since the boundary `{+40 ms, byDocument true, mirrored false}`; commits
`redirect` at +33 ms and `hairline` at +71 ms (`byDocument: true`, `answeredOwnStart: true`, `mirroring: false`).

**The reading (Idris, `#3819`; Dogu read the same print and agrees it says this, and has not reproduced it).** The bus's
mirrored `hairline` start arrived 2 ms after the redirect page committed, so the page's own `location.replace` produced
no start before the document was replaced. **That is the shape of `arrivals.spec.ts:218`'s CI failure** (`37346121793`:
the mirrored start 24 ms after the redirect start, no document-initiated start at all), and of the race Idris measured
for it (`navigate` loads the redirect page into both panes, and the spec's premise is that the target's own redirect
wins by milliseconds; with the target on `cpu-4x` `:218` fails 21 of 30). "Same trigger" here rests on the printed
record: Idris's throttle run on this spec had not happened when `#3819` said so.

**One difference, recorded as a question and not a finding.** The landing commit here is stamped **`mirroring: false`**
with `mirrorRequested: null`, where `:218`'s failing print had `mirroring: true` with the mirror still in flight. The
assertions after the one that fired (`mirroring` false, `answeredOwnStart` true) were not reached, so what they would
have said is unknown. **If a bus-loaded commit can be classified after `loadMirrored` has cleared `mirrorRequested`, the
product would stamp it as the page's own arrival**, the opposite misattribution to `:218`'s, on an attempt where the page
never redirected itself. Candidate only; no one has built that input.

**Why the sweeps did not see it, and the accounting.** The spec was swept idle (Dogu 13 of 13, Idris 40 of 40) and under
24 CPU burners (Idris 60 of 60); on a developer machine the target wins the race by 4 to 6 ms idle (Idris measured that for `:218`, 35 of 40 runs, not for this spec), which is why. Dogu's PASS
of `#567` (`#3642`) said it did not cover the spec's rate in CI. Of the CI attempts of the converted spec Idris has
read, 10 passed first try and this one did not (`#3819`); Dogu holds three passes (`#568`'s, `#569`'s, and `main` at
`ad3650646`) and this one. **That is not a rate**: the runs were read for other reasons and nobody sampled them.

**What this entry is not.** No cause is confirmed here and no card is filed by it; the run was green and `#580` is not
held by it (a one-line timeout change cannot touch a spec). **Added the same day, after it was first written:** the change that
addresses it, holding the native pane out of the redirect page in both this spec and `arrivals.spec.ts:218` so the target's own
redirect has no competitor, is Idris's and **merged as `9d60fcd0a` (`#584`, Dogu's PASS `#3834`)**; the spec's test is now at
`:194`, not `:176`. Before it, the unforced spec on `cpu-4x` failed 12 of 20 in Dogu's controls (13 of 20 in Idris's) with this
entry's message; after it, 30 of 30 on `cpu-4x` and on `cpu-6x`. **The throttle is a model of CI's renderer, not a measurement, and
one CI attempt of the forced spec exists and is clean (`#584`'s own pull-request run `37399494485`, test 492, first try); that is
one attempt and says nothing about a rate, and the `main` suites after `#584` are the next.**

## `mirror-302.spec.ts:99` and `native-pane.spec.ts:62` — two 30 s hangs with one shape, 2026-09-29

**Named, not filed**, and named together because the two logs are the same log
with the spec name changed:

| spec | run | branch | retry |
| --- | --- | --- | --- |
| `mirror-302.spec.ts:99` — *a server redirecting the bus own mirrored load is still the bus* | `36556822266` | `docs/select-menu-overflow` | passed in 326 ms |
| `native-pane.spec.ts:62` — *back returns to the previous document* | `36577980330` | `fix/vision-confirm-tell` | passed in 199 ms |

Both:

```
Test timeout of 30000ms exceeded.
Error: electronApplication.evaluate: Target page, context or browser has been closed
```

**Read the second line, not the first.** A 30 s timeout is what the runner says
when anything hangs; the news is that the `evaluate` failed because **the app was
already gone**. Neither spec is about app lifetime, both are one `evaluate` away
from their assertion, and both were rescued by a bare retry in under 330 ms — so
the hang is not the product's navigation behaviour being slow, it is an Electron
process that went away under a test that was still talking to it.

**Why they are one entry and not two.** Filing them separately would invite two
people to read one runner-level fault as two navigation bugs, which is the mistake
`panes.spec.ts:85` cost this file. They are also on **different PRs touching
different subsystems** (a docs-only branch and the vision-confirm fix), neither of
which can plausibly kill an Electron process in a mirror or history test — which
is itself evidence that the cause is neither PR.

**The discriminator, for whoever picks this up:** whether the process **exited**
or was **closed by the harness**. `launchApp`'s teardown and Playwright's own
timeout both close the app, so "has been closed" is produced by a crash *and* by
the timeout that follows a hang elsewhere in the same test. The logs in the run
artifacts carry the Electron stdout up to the last line before the close; a crash
leaves a signal or a stack there, a harness close does not. Read that before
writing either cause down.

**Counted again, 2026-10-06 (`37428504822`, `#588`'s pull-request run): the same two lines on both attempts of one job, and the
next attempt of the run passed.** The sweep (178 readable suite jobs, 09-28 to 10-06 04:26Z, raw API, every attempt) has one earlier
first-attempt `✘` of this test, `36556822266` above, rescued. In `#588`'s run, attempt 1 (suite job `112153643896`):
`mirror-302.spec.ts:99` failed at 30.0 s (test 434) **and again on `retry #1` at 30.0 s (test 435)**, each with `Test timeout of
30000ms exceeded.` and `electronApplication.evaluate: Target page, context or browser has been closed`, at `launch.ts:105` via
`mirror-302.spec.ts:106:13` (Idris, `#3944`). Each attempt's app has a harness kill line directly before its `✘` (10,002 ms and
10,005 ms, both silent: `starting` and `gpu`, no `quitting`). Attempt 2 of the run (suite job `112163825257`), the same head and the
same merge ref: the test passed in 258 ms. **So "rescued by a bare retry in under 330 ms" above is true of the two sightings it
covers and not of this one**, and the discriminator above (did the process exit, or did the harness close it) is still unread:
`error-context.md` and `playwright-flaky` were not downloaded. One run, no cause, no rate; `#588`'s diff is one docs file.

## THE EIGHTH SIGHTING RULES OUT THE DROP FOR ITS OWN ATTEMPT TOO, AND NAMES WHERE TO LOOK NEXT, 2026-09-29

Run `36596468138` (`#516`'s own suite), `arrivals.spec.ts:181`, note MISSING, retry-rescued.
`startsForThisUrl: 6` again — the correlation's eighth sighting. **What is new is the rest of the
print:**

```
"matched": { "at": 1790698691453, "url": ".../hairline.html",
             "byDocument": true, "mirrored": false, "fromBusDocument": false },
"startsForThisUrl": 6
```

Read against the same print's `starts`, that matched entry is **the redirect's own start**. The six
hairline starts in order are `690242`, `690758`, `690763`, `691065`, **`691453` (matched)**, `691478`;
`redirect.html`'s own start is at `691421` and its **commit** lands at `691443`, so the match is the
very next navigation start recorded after the redirect page committed — 10 ms after that commit, and
ahead of the later mirrored start at `691478`.

**The numbers in the first version of this section were mislabelled**, and the correction is kept here
rather than quietly fixed: I wrote *"the `redirect.html` start is at `1790698691443`"*, having stitched
a start's fields onto a commit's timestamp while reading the block as text. `691443` is the commit;
`691421` is the start. Idris parsed the array instead of reading the slice and caught it. The reading
the section rests on is unchanged and is stronger stated properly — the match is the closest start
after the redirect's commit, not merely one that is not obviously stale.

So on this attempt `startFor` **answered correctly** — and with `byDocument: true`,
`ipc.ts:245`'s `if (url === arrivals(s).url && !byDocument) return` cannot fire, so the commit was
counted.

**The note was still missing. That places the silence downstream of the guard this entry has named
since it was filed**, for the second sighting in a row, and this time with the chosen start visibly
correct rather than merely carrying a surprising flag.

### Where the silence can still come from

`ipc.ts:274`, the only other gate on this sentence:

```ts
const seen = arrivals(s)
if (seen.count > asked.atCount && seen.url) pre.push(navigatedAfterLoadNote(asked.asked, seen.url))
```

`atCount` is snapshotted at `ipc.ts:321`, **after** `await Promise.all([s.native.load(wanted),
s.target.load(wanted)])`. A client-side redirect commits during the load it is part of, so whether the
`hairline.html` arrival is counted **before or after** that snapshot is a race between `load` resolving
and the replace committing. If it lands first, `atCount` already includes it, `seen.count >
asked.atCount` is false, and the note is never made — **with every field this entry has been printing
looking exactly right.** The `settle` hook two lines below only arms when the count did *not* move,
which is the opposite case.

**Stated as a candidate, and deliberately not as a mechanism.** This card has had two mechanisms and
both were refuted by routes built to force them; a third reading that fits one trace is worth exactly
as much as the last two did at this stage. No fix is proposed on it.

### The discriminator, and it needs no product seam

If the arrival really did precede the snapshot, then `landedAt` — recorded in the same object, from the
same `load` — was already `hairline.html`, so **`landedElsewhereNote` should have fired instead**: a
different sentence about the same journey, saying the caller asked for `redirect.html` and the load
landed on `hairline.html`.

**Nobody has ever looked.** `movedNote()` called `inspect` and returned only the match for *"navigated
after it loaded"*, discarding every other note in the reply. So eight sightings cannot distinguish:

| the reply carried | means |
| --- | --- |
| **no notes at all** | the class-1 silence this card is filed on — and the `atCount` race is then the live candidate, needing the two counts exposed to go further |
| **a `landedElsewhere` note** | the product *did* say something; the test has been looking for the wrong sentence, and the class is not what this card says it is |

`tests/e2e/arrivals.spec.ts` now reads **all** the notes, prints them in the guard block on pass as
well as failure, and names them in the failure message so the next reader does not have to find the
print. Watched green locally first, which is the only way this file trusts an instrument: `:71`
baseline carries `notes: []`, `:89` baseline carries exactly one sentence — the
navigated-after-load one, **and no `landedElsewhere`**. The two arms therefore differ, which is what
makes the next sighting answer the question instead of adding to the count.

## `throttle-live.spec.ts:48` — a `beforeAll` timeout waiting for `.toggle-panel`, twice in one night, 2026-09-29

**Named, not filed**, and named as **one** failure seen twice rather than two sightings, because the
two logs carry the same hook and the same deadline:

| run | branch | what the log says |
| --- | --- | --- |
| `36585126404` | `fix/vision-confirm-paints` | `"beforeAll" hook timeout of 30000ms exceeded` at `throttle-live.spec.ts:28` |
| `36608642138` | `feat/flow-selector-click` | the same, **plus the cause**: `TimeoutError: locator.click: Timeout 30000ms exceeded. Call log: - waiting for locator('.toggle-panel')` |

Both retry-rescued (13 ms on the second), so both runs concluded green.

**The `(0ms)` on the test line is not a signature, and reading it as one is the trap here.** It was
first relayed as *"the same `(0ms)` environmental flake"*, which is how Playwright prints a test that
**never ran** because its hook failed — the duration belongs to the test, and the failure belongs to
`beforeAll`. Two different `beforeAll` failures would print the identical `(0ms)`. What actually makes
these the same is the hook, the file line and the deadline, and only the second log carries the locator
that was being waited on.

**So the mechanism candidate is the panel toggle, not the throttle.** Nothing in either failure has
reached a throttle assertion: the hook opens the drawer before any test runs, and `.toggle-panel` was
not clickable inside 30 s. This repo already knows that control is time-sensitive — the drawer poll is
bounded at 5 s elsewhere (`snap-tiled-hygiene`) — so a renderer that had not painted the toggle yet
fits, and a 30 s wait that ends in a retry passing in 13 ms fits it well.

**Half the discriminator is already answered by the log this entry was written from**, which Idris found
by reading further down it than I had. The call log does not stop at *"waiting for locator"*:

```
- waiting for locator('.toggle-panel')
  - locator resolved to <button type="button" aria-pressed="false" aria-label="Side panel" class="icon-button toggle-panel" …>
- attempting click action
  - waiting for element to be visible, enabled and stable
```

So for this sighting the toggle was **present** — a real button, with its own aria state — and the wait
that ran out was Playwright's pre-click check. **"It never rendered" is ruled out**, and what remains is
which of the three that check waits on: not visible, not enabled, or not stable. Those are three
different bugs — a pane still hidden, a control deliberately disabled, and a control still moving — and
the log stops before naming which, because it never got past the wait.

**So the question for whoever picks this up is narrower than the one this entry first wrote down:** read
the page snapshot in the run artifacts' `error-context.md` for the toggle's computed visibility and
`disabled` state at the moment of the timeout, and check whether anything animates the toolbar at
startup. Also worth knowing: the click comes from a **shared helper** (`helpers/select.ts:97`), so
whatever this is, it is not `throttle-live`'s own code and other specs using that helper are exposed to
it equally.

**And the lesson about the first version of this paragraph is the entry's real value.** I wrote a
discriminator naming two possibilities while holding a log that had already eliminated one of them. The
log went four lines further than I read. That is the same shape as the `(0ms)` misreading two paragraphs
up, and the same shape as `movedNote()` discarding the rest of a reply: **read to the end of the block
you already have before writing down what someone should go and find out.**

## `target-source.spec.ts:234` — a click forwarded into the wrong document, once, 2026-09-29

**Named, not filed.** One sighting, run `36608642138` (`feat/flow-selector-click`), retry-rescued in
90 ms. *"forwards clicks into the offscreen page"* asserts the fixture's title becomes `clicked`:

```
Expected: "clicked"
Received: "hairline-fixture"
```

**The click was forwarded correctly — into the wrong page.** `button.html`'s click handler sets the
title to `clicked`; the title read `hairline-fixture`, which is a different fixture this same spec file
loads in other tests. So nothing here is evidence about click forwarding, and a reader who stopped at
the test's name would file it against exactly the wrong subsystem.

**Kept because of how nearly it was dismissed for the wrong reason.** It was first set aside as
*"unrelated: this PR doesn't touch `targetSource.ts`"* — which is true, and is an argument from the
file list rather than from the failure. A test named *"forwards clicks"* failing on a PR that changes
how a flow produces clicks deserves the log read, and reading it gives a better answer than the file
list did: the document was wrong, and `#519`'s diff mentions `hairline` zero times (checked
independently by Idris).

**The discriminator:** whether the preceding test's `navigate` had committed when this one clicked.
Inherited page state within a spec file is the default explanation for a wrong-document failure in this
repo — `panes.spec.ts:83` is the recorded case — and the run's trace carries the commit order.

## `sync-mirror-mark.spec.ts:41`: it also fails **alone**, and its error text is teardown, not cause

**Seen 2026-09-30 on main**, run `36716844854`, head `dd3911f` (the `#535` merge — a build-script message
and a board card, which cannot touch sync). **418074 bytes, exactly one `✘`, 0 `error TS`.** The suite's
conclusion was `success`, because the retry passed.

    ✘  522  sync-mirror-mark.spec.ts:41  a mirrored commit is reported and marked, not withheld (30.0s)
    ✓  523  sync-mirror-mark.spec.ts:41  … (retry #1) (1.1s)

**30.0 s then 1.1 s** — the first attempt spent the whole timeout, the retry finished in about a second.

**Why the error lines do not name a cause, which is the trap this file exists to prevent.** The failure
detail reads:

    Test timeout of 30000ms exceeded.
    Error: electronApplication.evaluate: Target page, context or browser has been closed

and earlier in the log:

    [launch] app.close() has taken 10002 ms; killing pid 38732

**Read the clock before believing either.** The app started `13:07:48.792`; 30 s later the test timed out;
`app.close()` then hung its own 10 s and was killed at `13:08:29.86`. So **the closed-target error and the
hung close are both consequences of the timeout**, produced by teardown after the fact. **What the test was
waiting on for 30 s is not in this log.** Anything that names `evaluate` or `app.close()` as the cause is
reading the aftermath.

**What it refines on `bug-ci-main-red-37pct`.** That card records `sync-mirror-mark:41` failing inside the
two multi-spec runs (`735f60f`, `b89ec67`) and calls it a shared environmental signature with
`devtools:116`. **Tonight it failed on its own** — one cross in the entire suite, `devtools` green. So the
cluster is not the only shape: this test flakes solo, which makes it its own problem rather than only a
passenger of a bad runner.

**Still true, and still the interesting part:** this is the file created to *fix* sync coupling by giving
the test its own app. It has its own app here — the log shows a fresh pid — and it still hung.

## A silent close sits before some failures: what the harness's own kill line shows (2026-09-29 to 2026-10-05)

**What the line is.** `boundedClose` in `tests/e2e/launch.ts` gives `app.close()` ten seconds; past that it prints
`[launch] app.close() has taken N ms; killing pid P. App log tail:` and the tail of the app's own log, then kills the process.
The app logs `quitting` on `before-quit` (`src/main/index.ts:222`), so a tail with no `quitting` means `app.quit()` did not
reach `before-quit` in those ten seconds; a tail with it means the quit began and did not finish.

**The ten hits, in eight raw CI job logs.** Found by `grep -F 'app.close() has taken'` on the job log
(`gh api repos/vibesyemmy/obsrv/actions/jobs/<job id>/logs`), not on the run page; the `error-context.md` artifacts were not
read. Every one of these ten sits directly before a `✘` line; **that does not hold across the days counted below**. All ten
were re-read from the raw logs by Dogu on 2026-10-05 (the four from 09-29 and 09-30 were first found by Wren, `#3659`).

| run | date (UTC), where | next `✘` after the hit | length | app-log tail | read by |
| --- | --- | --- | --- | --- | --- |
| `36504076439` | 09-29, `main` push, job failed | `visibility.spec.ts:66` | 2.1 s | `quitting` logged | Wren, Dogu |
| `36599810778` | 09-29, `main` push, job failed | `tab-switch-preset.spec.ts:89` | 5.4 s | `quitting` logged | Wren, Dogu |
| `36716844854` | 09-30, `main` push | `sync-mirror-mark.spec.ts:41` (the entry above) | **30.0 s** | **silent** | Wren, Dogu |
| `36726476051` | 09-30, pull request | `tabs.spec.ts:177` | 5.0 s | **silent** | Wren, Dogu |
| `37190742650` | 10-04, pull request, job failed | `throttle-live.spec.ts:89`, **the retry** (the first attempt's `✘`, 2.8 s, is the line before the hit) | 0 ms | **silent** | Dogu only |
| `37206763443` | 10-04, `main` push (`#548`) | `sync-mirror-mark.spec.ts:41` | **30.0 s**, retry 1.2 s | **silent** | Dogu, Idris |
| `37290561363` | 10-05, pull request | `image-mode.spec.ts:70` | **30.0 s**, retry 594 ms | **silent** | Dogu, Idris, Wren |
| `37290561363` | 10-05, pull request | `tab-switch-preset.spec.ts:89` | 10.1 s | `quitting` logged, 16 s after the `gpu` line | Dogu, Idris, Wren |
| `37290561363` | 10-05, pull request | `update.spec.ts:115` | **30.0 s**, retry 291 ms | **silent** | Dogu, Idris, Wren |
| `37294297527` | 10-05, pull request | `browser-identity.spec.ts:41` | **30.0 s**, retry 1.4 s | **silent** | Dogu, Wren (Idris read the hit and the 30.0 s, not the retry's time) |

**Seven of the ten tails are silent** (two lines, `starting` and `gpu: compositing enabled, webgl enabled`); three log
`quitting`. In Dogu's 42 macOS suite logs from runs created between 2026-10-03T22:35Z (`#540`) and 2026-10-05T14:50Z there are
**23 first-attempt `✘`**, and **five of them ran the full 30.0 s**: four have a hit (`sync-mirror-mark.spec.ts:41`,
`image-mode.spec.ts:70`, `update.spec.ts:115`, `browser-identity.spec.ts:41`) and the fifth, `tabs.spec.ts:929`
(`37160406685`), closed normally. Of the other 18 first-attempt failures, one has a hit (`tab-switch-preset.spec.ts:89`). Sixteen of the
42 logs have a first-attempt `✘`; all four logs with a hit are among them, and **none of the 26 logs without one has a hit**.
The calls that stalled for the 30 s were `page.click` (`.toggle-settings`, `.preset-select`), `page.press`
(`.url-form input`) and one **main-process** `electronApplication.evaluate` (`sync-mirror-mark.spec.ts:46`).

**What it says.** The register's earlier reading, that the hung close is the *aftermath* of the timeout (the
`sync-mirror-mark.spec.ts:41` entry above), stands. What this adds: in a silent tail the app, or the harness's link to it,
did not reach `before-quit` in the ten seconds of the close, and in the four 30 s failures the test's own call had already
waited the whole 30 s. That is not what an element that was slow to become clickable looks like. A silent close also sits before
a short failure (`tabs.spec.ts:177`, 5.0 s) and before a 0 ms retry (`throttle-live.spec.ts:89`), so it is "a silent close sits
before some failures of any length", not "a 30 s stall is a silent app".

**One datum, and a reason for doubt (Idris, `#3660`, one laptop, not CI).** A local instrumented run for `#558` (2026-10-05,
a scratch event-logger patch in `targetSource.ts`, 24 CPU burners) produced five slow closes under load with that patch, and
**all five tails have `quitting`**, 0.3 to 1.8 s after the `gpu` line. The patch is an unmeasured confound (the same loop was
not run without it), and the file the figures came from (`ev558-load-run.txt`) did not survive a session restart, so this rests
on the post alone. It is a reason to doubt that a starved runner explains the silent seven, and not a refutation of what a CI
runner does: a starved runner **is not shown to be** the explanation.

**What it does not say.** No cause: a blocked main-process loop, a stuck harness connection and a runner-level stall all
still fit, and the logs cannot tell them apart (a process snapshot taken at the kill could rule some of them out;
none is built, and nothing here depends on one). Not a rate: the logs were pulled for other reasons by three people and
cover different windows; the 42 are Dogu's, the older four are Wren's, and Idris's CI logs overlap Dogu's and read the same
way where they overlap (`#3660`). One hit (`37190742650`) was read by one person. The silent tails are not proved to be one
thing.

**Counted again, 2026-10-06: 30 hits in 26 jobs. The table above is the part of them its windows reached.** Dogu, from
the raw job logs, after the `main` push for the `#586` merge (`37413726703`, below) added a silent hit the table lacks and raised
the question of how many others it lacks. **The logs:** 178 readable suite jobs of 600 s or more, from every attempt of every run
created on or after 2026-09-27 through 10-06 04:26Z (the first from a run created 09-28 16:28Z), each pulled by job id through the
raw API (`gh api repos/vibesyemmy/obsrv/actions/jobs/<id>/logs`), bytes and hash per row, 178 distinct hashes. **Corrected
2026-10-06:** this paragraph first said 29 hits in 25 jobs from 180 job ids read with `gh run view --log --job`, which returns a
run's *latest* attempt's log for any of its job ids. Six re-run runs were read as their attempt 2 twice (174 distinct logs) and
one hit in an attempt-1 job, `36585126404`, was never read (Wren, `#3946`; Idris, `#3947`). Eight jobs answer 404 and are
**unread, not zero**: the 694 s and 709 s attempt-1 jobs `111969388200` and `111969404835`, and six of 555 s or less that were
cancelled or skipped. **A control:** in this register's own window (runs created 10-03T22:35Z to
10-05T14:50Z) the sweep finds the same 42 jobs and the same six hits as the table, and all ten of the table's tails and
next-`✘` rows read the same from these logs.

**What the 30 are.** Every hit took 10,001 to 10,022 ms to close (Dogu's parse; Idris's parser reproduced the range and both
ends, `#3904`). **14 tails are silent** (two lines, `starting` and `gpu`) and **16 log `quitting`**. **The next result line after
the hit is a `✘` in 24 and a `✓` in 6.** 11 of the 24 `✘` ran the full 30.0 s: 8 after a silent tail and 3 after one that logged
`quitting` (`throttle-refused.spec.ts:164`, `image-tabs.spec.ts:82`, `native-pane.spec.ts:62`, all 09-28 and 09-29). Five jobs with
a hit contain no `✘` at all (`36464104648`, `36619187164`, `36648615234`, `36653034749`, `37399203900`). The ten rows above plus
these 20 are the 30; the 20 follow, with the same columns (the next result is the first `✓`, `✘` or `-` line after the hit;
whether each `✘` was then rescued was not read):

| run | run created (UTC), where | next result after the hit | length | app-log tail | read by |
| --- | --- | --- | --- | --- | --- |
| `36464104648` | 09-28, pull request | ✓ `consent.spec.ts:119` | 7 ms | `quitting` logged | Dogu, Idris (parser) |
| `36470833485` | 09-28, pull request | ✓ `tabs.spec.ts:1080` | 16.7 s | `quitting` logged | Dogu, Idris (parser) |
| `36479230614` | 09-28, pull request | ✘ `throttle-refused.spec.ts:164` | 30.0 s | `quitting` logged | Dogu, Idris (parser) |
| `36486270346` | 09-28, `main` push | ✘ `image-tabs.spec.ts:82` | 30.0 s | `quitting` logged | Dogu, Idris (parser) |
| `36519694953` | 09-29, `main` push | ✘ `tab-switch-preset.spec.ts:89` | 2.2 s | `quitting` logged | Dogu, Idris (parser) |
| `36519694953` | 09-29, `main` push | ✘ `update.spec.ts:85` | 10.1 s | `quitting` logged | Dogu, Idris (parser) |
| `36526844845` | 09-29, pull request | ✘ `live-capture-notes.spec.ts:101` | 3.6 s | `quitting` logged | Dogu, Idris (parser) |
| `36530455782` | 09-29, `main` push | ✘ `sync-trace.spec.ts:63` | 30.0 s | **silent** | Dogu, Idris (parser) |
| `36541147424` | 09-29, `main` push | ✘ `live-capture-notes.spec.ts:231` | 14.9 s | `quitting` logged | Dogu, Idris (parser) |
| `36541147424` | 09-29, `main` push | ✘ `orientation.spec.ts:114` | 10.6 s | `quitting` logged | Dogu, Idris (parser) |
| `36556822266` | 09-29, pull request | ✘ `mirror-302.spec.ts:99` | 30.0 s | **silent** | Dogu, Idris (parser), Wren |
| `36577980330` | 09-29, pull request | ✘ `native-pane.spec.ts:62` | 30.0 s | `quitting` logged | Dogu, Idris (parser) |
| `36585126404` | 09-29, pull request (attempt 1) | ✘ `throttle-live.spec.ts:48` | 0 ms | **silent** | Dogu, Wren, Idris (raw pulls, `#3946`, `#3947`) |
| `36608642138` | 09-29, pull request | ✘ `throttle-live.spec.ts:48` | 0 ms | **silent** | Dogu, Idris (parser) |
| `36619187164` | 09-29, pull request | ✓ `sync-mirror-mark.spec.ts:41` | 1.1 s | **silent** | Dogu, Idris (parser) |
| `36648615234` | 09-30, pull request | ✓ `quit.spec.ts:26` | 11.7 s | `quitting` logged | Dogu, Idris (parser) |
| `36653034749` | 09-30, `main` push | ✓ `navigate-budget.spec.ts:93` | 3.3 s | `quitting` logged | Dogu, Idris (parser) |
| `37355564026` | 10-05, `main` push | ✘ `throttle-live.spec.ts:82` | 0 ms | **silent** | Dogu, Idris (parser) |
| `37399203900` | 10-06, pull request | ✓ `vision-confirm.spec.ts:125` | 31 ms | `quitting` logged | Dogu, Idris (parser), Wren |
| `37413726703` | 10-06, `main` push | ✘ `fit-pan.spec.ts:93` | 30.0 s | **silent** | Dogu, Idris (parser), Wren |

*Read by.* **Dogu** parsed all 19 rows from the saved logs. **Idris compared all 19 by parser, not by eye** (run, date, where, next
result and spec, length and tail: 0 mismatches, with a control that does mismatch, `#3904`) and the ten rows of the table above
the same way (spec, length and tail: 10 of 10, `#3906`); Idris did not read the raw neighbourhood of each of the 19 and did not
check whether each `✘` was rescued. **Wren compared the next-result kind, the tail and the 30.0 s flag of all 29 rows by parser**,
from a third pull of the 25 jobs the two tables name (0 mismatches, `#3907`), and **read the raw logs** of `36556822266`,
`37399203900` and the whole `fit-pan` job (`#3889`, `#3899`, `#3875`). "(parser)" in the column marks a comparison, not a read.

**What this changes in the section above.**
- **"Seven of the ten tails are silent" is true of those ten and is not the shape of the set.** Across the 30 it is 14 silent and
  16 not. A silent tail is not the majority, and the three `quitting` hits before a 30.0 s `✘` show that 30.0 s does not mean silent.
- **"Every hit sits directly before a `✘` line" holds for the ten and not across the days read here:** 6 of the 30 are followed by
  a `✓`, five of them with `quitting` logged and one silent (`36619187164`, before `sync-mirror-mark.spec.ts:41` passing in 1.1 s).
  A slow close is not always followed by a failure.
- **"None of the 26 logs without a first-attempt `✘` has a hit" holds for the 42 and is not general:** four of the five jobs with
  no `✘` and a hit are before that window (09-28 to 09-30) and one is after it (`37399203900`, run created 10-06 01:26Z).
- **`37413726703` (`fit-pan.spec.ts:93`, below) is the 14th silent hit and the latest of the 30.** By the table's own
  definition it is its eleventh row.

**What this does not say.** No cause; the same three explanations still fit, and 14 silent against 16 `quitting` does not say
they are one thing or two. Not a rate. "Next result line" is what was read, not each hit's whole neighbourhood, so a `✓` after
a hit does not say the close was harmless. **Two counts, one definition:** Dogu's and Idris's (`#3895`, `#3947`, `#3955`: own
parsers) agree on every figure here, and a third parse by Wren (`#3907`, `#3946`, `#3949`, from the API's own run list) reads the
same. All three now read the logs through the raw API, which rules out a parser slip and not a defect in the stored logs
(Wren checked the per-attempt logs zip for the six re-run runs: 12 of 12 job-attempts agree, `#3958`), and all read the same
`app.close() has taken` line, so the agreement says the count is right for that definition, not that the line is the right thing
to count. `error-context.md` and `playwright-flaky` are unread.

**More hits after the sweep, 2026-10-06.** The sweep above ended at 04:26Z. Since then `ci.yml` has run three times:
`37418289163` (the `#587` pull-request run: 0 hits), `37425109815` (the `main` push for its merge: 1) and `37428504822` (the `#588`
pull-request run: 3 hits in attempt 1, none in attempt 2). The totals above are the sweep's and are not edited; with these four hits
they would be **34 hits in 28 jobs, 17 silent, 17 `quitting`, 27 followed by a `✘` and 7 by a `✓`** (Dogu and Idris, `#3947`).

| run | run created (UTC), where | next result after the hit | length | app-log tail | read by |
| --- | --- | --- | --- | --- | --- |
| `37425109815` | 10-06, `main` push | ✘ `tab-switch-preset.spec.ts:89` | 5.4 s | **silent** (10,008 ms; two lines) | Dogu, Idris, Wren (raw pulls, `#3933`, `#3934`, `#3935`) |
| `37428504822` attempt 1 | 10-06, pull request | ✓ `consent.spec.ts:119` | 8 ms | `quitting` logged (10,005 ms; five lines) | Dogu, Idris, Wren (`#3944`, `#3945`) |
| `37428504822` attempt 1 | 10-06, pull request | ✘ `mirror-302.spec.ts:99` | 30.0 s | **silent** (10,002 ms; two lines) | Dogu, Idris, Wren (`#3944`, `#3945`) |
| `37428504822` attempt 1 | 10-06, pull request | ✘ `mirror-302.spec.ts:99`, `retry #1` | 30.0 s | **silent** (10,005 ms; two lines) | Dogu, Idris, Wren (`#3944`, `#3945`) |

The first is the second 5.4 s `tab-switch-preset.spec.ts:89` hit; the earlier one (`36599810778`) logged `quitting`. See that entry
above. The last two are the same test failing both attempts of one job, each with its own silent close; see the
`mirror-302.spec.ts:99` entry.

**Counted again, 2026-10-07: 8 new hits in 6 jobs after the boundary run, which brings the totals since 09-27 to 38 hits in 32 jobs (21 silent and 17 `quitting`; 31 followed by a `✘` and 7 by a `✓`).** **Two different quantities, and the first version of this entry did not say which it was giving** (Henry's count of `#4221` read the 38 as a sweep total and got 21; Henry's 21 is right): **the sweep's own raw window is 21 hits in 11 jobs**, of which 12 are the snapshot probe's deliberate hangs (excluded), 1 is the boundary run's, already in the 30 above, and **8 are new** (7 silent, 1 `quitting`); **the 38 is the cumulative figure**: the earlier sweep's 30 in 26 (09-27 to the boundary) plus these 8 in 6, with silent 14 + 7 = 21 and `quitting` 16 + 1 = 17. That the raw window's 21 and the cumulative's 21 silent are equal is a coincidence, not a link. (Dogu's count; since read by Idris, Wren and Henry, who each reproduce the window's hit-level figures: `#4218`, `#4219`, `#4221`.) **The sweep:** every `ci.yml` run created after 2026-10-06 04:26:00Z and before 08:26Z on 10-07 (**this takes in run `37413726703`, the boundary, which the section above already counts: it is one of the jobs read and its hit is not counted twice**), every attempt, the suite job of
each pulled by id from the raw API: **42 runs listed: 37 of id up to `37590281828`, and five above it** (`37591086451` and `37591133225`, whose suites were cancelled and are read, with no hit; `37593043755`, `37593275426` and `37593512567`, whose suites were still running and are **not** read). **40 suite jobs read, 0 unread**, 22 of them 600 s or more. **It reproduces the totals already recorded:** its hits
between the boundary and run `37437677489` are the four in the table above and `37437677489` (`solo-target.spec.ts:128`), which with the 30 in 26 above are the
**35 in 29, 18 silent and 17 `quitting`** the snapshot card quotes. Four more since, all silent, all followed by a `✘`:

| run | run created (UTC), where | next result after the hit | length | app-log tail | read by |
| --- | --- | --- | --- | --- | --- |
| `37437677489` | 10-06, `main` push | ✘ `solo-target.spec.ts:128` | 30.0 s | **silent** (10,009 ms; two lines) | Dogu |
| `37454972364` | 10-06, pull request (`#592`'s branch; the job was later cancelled) | ✘ `mcp-live.spec.ts:977`, `retry #1` | 4.1 s | **silent** (10,002 ms; two lines) | Dogu |
| `37455521138` | 10-06, pull request (`#593`'s own suite) | ✘ `fit-pan.spec.ts:93` | 30.0 s | **silent** (10,008 ms; two lines) | Dogu; the snapshot, Wren (`#4038`) |
| `37463948210` | 10-06, pull request (`#592`'s suite at `4bc5914e`) | ✘ `flow-type-text.spec.ts:100` | 30.0 s | **silent** (10,003 ms; two lines) | Dogu; Idris (`#4129`: figures matched from Idris's own pull) |

The first row is already counted in the 35 and is listed because the register did not have it. **The last two rows carry the two real-hang snapshots** (see the snapshot card); `37454972364` predates the snapshot on its merge
ref and has none. **Excluded, and why:** 12 hits in four jobs of 71 to 106 s on the branch `probe/kill-snapshot` (runs `37452623714`, `37453082900`, `37454123538`, `37454530676`): those are
the snapshot probe's own deliberate hangs (controls 1 to 3 on the card), not natural hits, and each is under the 600 s this register's count uses.

**What this does not say.** No cause. Not a rate. **The denominators below are two populations and the percentages are not a trend** (Henry, `#4221`): applying this register's rule (suite jobs of 600 s or more) to the sweep gives 21 new readable jobs after the boundary job (`112107660736`, already in the 178), six of which carry the eight new hits, so **since 09-27 the pool is 32 jobs with a hit among 199 readable ones, about 16%** (the 26 in 178 before, about 15%, is the same pool without the newest 21 jobs, not an earlier measurement of the same thing), and **the newest 21 alone are 6 with a hit, which is too few jobs to say whether anything changed**. **A second count of the hits by Idris (`#4218`), from Idris's own population and parser, reproduces every hit-level figure** (8 hits in 6 jobs after the boundary, 7 silent and 1 `quitting`, and the same close durations); **Idris's window ends at run `37590281828`, which is 38 suite jobs and 19 of 600 s or more, so 32 of 197 (16.2%)**. The two jobs of mine that Idris's population lacks are suite jobs of runs created after that, `37591086451` (`#598`'s branch) and `37591133225` (`#599`'s), both cancelled, 1,222 s and 1,069 s, with no hit: that is the whole difference, and either denominator gives about 16%. The 178 was not re-derived for this, the
window is different, and a job that was cancelled after a hit (`37454972364`) counts as a hit. `37454972364` is also the one hit in this table where the next result is a `retry #1` `✘` and not a first-attempt one. **Also seen in the same logs, not kill-line hits, each
a known entry:** `cli-walk.spec.ts:192` (`#597`'s suite, run `37590281828`: first attempt `✘` in 1.3 s, `retry #1` `✓` in 1.2 s) and `live-capture-notes.spec.ts:231` (`main`'s push suite for the `#596` merge, run `37590020307`, job `112689058136`:
first attempt `✘` in 57.1 s after five tries with `settled=false` (`no capture reached its budget covered in 5 tries`), `retry` `✓`; read from the raw log, md5 `79c94db3`, the same as Idris's count in `#4208`).

**Method, for the next count.** Pull every suite job by id from the raw API (`gh api repos/vibesyemmy/obsrv/actions/jobs/<id>/logs`),
listing jobs per attempt (`/runs/<id>/attempts/<n>/jobs`), with bytes and a hash per row; for any run with `run_attempt` above 1,
compare the attempts' hashes before counting; list a 404 as unread. `gh run view --log --job <id>` is not safe for a re-run run:
it answers with the latest attempt's log for either job id.

## Sightings sweep 2026-10-03: what no card or entry covered

Idris, for Wren (`#3110`). **Window:** the 170 `ci.yml` runs created since 2026-09-28T00:00Z through 10-03; raw logs for
168 (two cancelled runs have empty logs). The suite ran in 103. Parsed from the Playwright list lines, one key per
file and title so a moved line does not split a test: **70 first-attempt failures, 38 distinct tests; the retry rescued 50
and both attempts failed 20.** vitest `FAIL` lines in any log: 0; `error TS`: 0. On `main` pushes, 13 of 39 suite runs had a
first-attempt failure and 2 ended red (`36504076439`, `arrivals`; `36599810778`, `throttle-live`).

**"Covered" means** a mention of the same `file:line` in this register or a card on `main` `f6007be`, re-checked by title
and in the `base.spec:N` and `base.spec.ts:N` forms. A test named only by title in prose can be missed by that match.

**Not recurrences (10 of the 20 not covered).** Both attempts failed on PR branches that had a real defect, which CI
caught: `feat/flow-type-text` (`36661734023`, `36663145446`; eight `mcp.spec` and `mcp-live.spec` tests, *"obsrv_inspect
emitted 4 keys its own output schema does not declare"*, fixed in `c656b5f`) and `feat/flow-tool` (`36451259567`,
`36455653071`; the tool-count assertion in `mcp.spec:65`).

**Singletons nothing covers.** Each is one first attempt, rescued by the retry:

| test | run | where | first line |
| --- | --- | --- | --- |
| `image-tabs.spec.ts:82` two tabs holding two files each show their own | `36486270346` | `main`, 09-28 | `Test timeout of 30000ms exceeded.` |
| `visibility.spec.ts:66` hiding the window stops rasterising, and showing resumes | `36504076439` | `main`, 09-29 | `paintsOver(700)` read 0, expected > 2, after the `painting` poll passed |
| `update.spec.ts:85` the state survives a renderer reload | `36519694953` | `main`, 09-29 | `Timeout 10000ms` polling `getUpdate()` for `available` (this register's `update.spec` entry is `:133`) |
| `sync-trace.spec.ts:63` a pane already on the URL records already-there | `36530455782` | `main`, 09-29 | `Test timeout of 30000ms exceeded.` (this register's entry is `:77`) |
| `orientation.spec.ts:114` rotating a phone preset swaps the real raster | `36541147424` | `main`, 09-29 | `no 2556x1179 paint within 10s` |
| `text-scale.spec.ts:141` the painted frame is the page at the scale | `36705154232` | `main`, 09-30 | `electronApplication.evaluate: Resulting promise was garbage collected` at `launch.ts:105` |
| `throttle-refused.spec.ts:164` a refused throttle is not shown as in force | `36479230614` | PR `test/flow-live-e2e`, 09-28 | `Test timeout of 30000ms exceeded.` |
| `cli-walk-limits.spec.ts:262` a page that locks its scroll | `36665868209` | PR `feat/flow-type-text`, 09-30 | `{"screenfuls":5,"atEnd":false,"ms":2483}` |
| `tabs.spec.ts:177` a scroll in the background tab mirrors within it | `36726476051` | PR `docs/flake-sync-mirror-mark`, 09-30 | Expected 1600, received 0 after a 5000 ms poll (this register's entries are `:755`; a card names `:266`) |

**`visibility.spec.ts:66` and the entry about that file.** The `visibility.spec and log.spec: when Electron delivers no hide
or show at all` entry above covers the file's four hide-first tests, `:66` among them, and says CI has never shown it.
**The CI sighting is a different mechanism**: the hide events were delivered (the `painting` poll at `:75` passed) and the
resume half failed at `:76`. It is listed in the table because no entry names `:66` by line, not because that entry is wrong.

**`text-scale.spec.ts:141` is the "garbage collected" class, through its own fix.** The error at `launch.ts:105` is
inside `hardenEvaluate`, which the section above says makes the awaited promise "never unreferenced while unsettled". One
in 168 logs, rescued by the retry. The section's claim is *that this class is fixed*; this is one counter-observation, not a
frequency.

**What was done with them.** `throttle-live:55` (above) got a card and a diagnostic. `target-source:106`, `visibility:66`
and `orientation:114` all waited for a frame within 14 hours on `main`: `bug-target-no-frame-family`. The second failure mode
of `arrivals.spec.ts:202` (`36665868209`: the note present, the matched start `byDocument: false`) is on the redirect card.
The six recurrence-waiter cards with **0 sightings in 103 suite runs** (`canvas-blank`, `controls-72`, `controls-blur`,
`ipc-native-pane`, `tabs-266-gate-leak`, and the uninstall unit test) are unchanged; zero in five days is a low rate,
not a fix.

**Limits.** This is one parse of retained logs by one reader. The `arrivals` table behind the redirect card was
independently recounted over its narrower window (Dogu, `#2972`); this sweep as a whole was not, though Wren checked the
`throttle-live` run by hand (`#3114`). No row was reproduced.

## `boardServeBrowser.test.ts`: `ENOTEMPTY` in the teardown, once, 2026-10-06

A unit test, not an e2e spec, listed here because it is the same kind of record (a CI failure that was not the claim under test) and the
register already carries the other unit-step ones. **One sighting in 484 saved suite logs: a candidate, not a rate.**

`#594`, run `37461396063`, attempt 1, job `112261642861`: the test's `afterEach` failed with `ENOTEMPTY, Directory not empty:
…/board-serve-browser-GYIFEr` at its `rmSync` (`boardServeBrowser.test.ts:48`). No assertion error in the log. The retry passed: attempt 2
of the same run (`37461396063`, job `112263020983`) was `success`, counted by Idris, Henry and Dogu (`#4077`, `#4079`, `#4078`).

**The reading, which is of the code and not a measurement of that run:** the hook sent `SIGKILL` to the server and removed the directory in the
same turn. The server's poller runs `git fetch` as its own child, so killing the server does not stop a git that is mid-write in
`clone/.git`, and a recursive remove racing a writer is the usual way to `ENOTEMPTY`. (`tar -x` in `buildAt` extracts into a *different* temp
directory and is not the writer here.) The log does not show a git in flight at the kill.

**What was changed and what the control shows** is on `board/bug-board-serve-test-teardown-enotempty.md`: the two `boardServe*` hooks now
kill, wait for the exit (bounded), and remove with `maxRetries: 5`; a test with a real detached late writer passes **0 of 10** on the old
teardown (red every time) and **10 of 10** on the fix. **Removing the exit wait alone leaves that control green, so the control does not show the exit wait
matters**; the retries are what covers a late writer. Henry's own run of main's literal shape against a detached writer, 6 trials each, agrees (old 0 of 6
clean, new 6 of 6). The control is a model of the mechanism, not a reproduction of the CI window: both writers are hot loops, and neither says anything about the CI rate.
Its first version slept a fixed 150 ms before the kill and was **blind when the writer started late** (old teardown red 0 of 8 at 250 ms late); it now waits for the writer's first file and
fails if none appears (red 8 of 8 at 0 to 1000 ms late). A starved runner that delays the *kill* past the writer's 700 ms is not covered.
`tests/unit/teardownWiring.test.ts` fails if either hook stops using the helper, or a new file kills a child and removes a directory without `maxRetries`.

**What would change this entry:** a second `ENOTEMPTY` from either hook after the fix, which would put the 5.2 s retry window or the named
writer in question.
