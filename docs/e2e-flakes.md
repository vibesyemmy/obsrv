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

## `arrivals.spec.ts:89`: the moved note, read once, right after a different signal settles

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
