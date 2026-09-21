---
title: "The drawer stops about 7% open and never lands, on the app a relaunch test has just launched"
column: backlog
owner: "Henry"
kind: bug
criterion: C4
order: 32
---

`text-scale.spec.ts`'s relaunch test opens the panel on an app it launched a moment earlier, and
`drawerSettled` waits for `--drawer-w` to reach `309px`. Twice on CI it did not, and both times it
stopped in almost the same place:

    35345417630 (#350)              18.8536px   ~6% of 309   gave up at 5 s, green on retry
    35351133949 (fix/text-scale…)   22.1934px   ~7% of 309   gave up at 5 s, green on retry

The transition is **220 ms**. These are five-second waits ending 93% short.

## What is known, and what is only a guess

**Known.** It happens on `openPanel(p1)` — the app the test launches itself, not the file's shared
one, so it is not a leftover from the test before it. It happens at the moment an Electron app has
just launched. It recovers on retry.

**Both stalls are one painted frame in, which is a much better argument than the one this card first
made.** The card originally said the two values were "close enough to look like the same event". Idris
was right that this is weak: `ease` is `cubic-bezier(0.25, 0.1, 0.25, 1.0)` and nearly flat at the
start, so *any* early stall lands at a small percentage and closeness-in-percent distinguishes
nothing. Inverting the curve against the two pixel values instead (220 ms, 309 px) gives an elapsed
time, and elapsed time is quantised by the frame clock in a way percentages are not:

    18.8536px  progress 0.061015  ->  16.666 ms  =  1.000 frames at 60 Hz
    22.1934px  progress 0.071823  ->  18.500 ms  =  1.110 frames at 60 Hz

**Neither is two frames.** The first is one frame to three decimals. The second is *one late frame* —
18.5 ms is a vsync that arrived ~11% behind schedule, which is what a contended main thread produces;
a second painted frame would read 2.0, and nothing does. So the shape is: **the transition paints one
frame and then nothing paints again for five seconds.** That is falsifiable — a third sighting at 2+
frames kills it — and it is the claim to carry forward instead of the percentages.

**Not known: whether the renderer is starved and would have finished, or whether the transition is
genuinely stuck.** The poll cannot answer this, because it gives up at 5 s and nothing records what
`--drawer-w` does afterwards. Every plausible fix depends on which of those it is, so this is the
first thing to settle and it is cheap: poll to 30 s, log the value each second, and read whether it
climbs, jumps, or sits still. **Log wall-clock beside the value**, so a resume can be dated against
whatever else the main thread was doing. The two answers are already distinguishable: under
main-thread starvation the value should resume and climb once the launch work clears — which "green on
retry" quietly supports, since a retry is not racing a fresh launch — whereas something that does not
release sits flat at ~19-22 px for the whole thirty seconds.

**Main-thread contention fits both sightings; occlusion fits neither well (Idris).** My first guess was
that an occluded window has its compositor throttled. Two things weigh against it. It never fitted the
first sighting, where the stall was on the file's shared app at a point when no second window existed
to occlude it. And more decisively, **this transition cannot be compositor-only**: `--drawer-w` is
`@property`-registered as `<length>` (`styles.css:56`) and feeds `flex: 0 0 var(--drawer-w)`
(`styles.css:785`), so every frame of it needs main-thread style recalc *and* layout — unlike
`transform`/`opacity`, which occlusion throttling mainly starves. Main-thread contention during the
second app's launch needs no second window to exist, only a busy thread, and it matches "one frame in,
then the thread that would drive the next one is elsewhere for five seconds".

## The history says the tolerance has already been traded once

`docs/e2e-flakes.md:141` records this same poll going red on the 0.32.0 tag run, when it was **10 s**
and outlived a 30 s test budget: the poll's rejection landed after the test had ended, which is a red
run with every test green. The mitigation was to shorten it to **5 s** and mark the relaunch group
slow. **That trade is now failing from the other side**, which is what makes it worth understanding
rather than re-tuning: moving the number moves the failure, and it has moved once already.

Note for whoever takes it: `test.slow()` means the old reason for 5 s no longer binds this group — its
budget is 90 s, not 30 — so a longer poll is available here in a way it was not in 0.32.0. That is an
argument for why a change is *possible*, not evidence for which change is *right*. A tolerance is a
loosening and needs the measurement above first.

Worth asking whether the test needs the slide finished at all. Its subject is text scale surviving a
relaunch; the drawer is opened only to reach `.text-scale-select`. Reading an attribute does not need
a settled drawer, though `choose()` clicks the trigger, and clicking something mid-slide is its own
race — so "wait for the drawer" may be answering a real need in the wrong currency.

## Not blocking

`#354` removes a stray `openPanel` from this test. That is dead work and unrelated to this defect;
neither fixes nor worsens it.

## CLAIMED BY HENRY 2026-09-18, after it blocked a third PR

Taken because it is now the thing most often stopping other people's work — `#350`, `#354` and `#363`
have each been held by it — and because `#363` is mine, so the alternative was re-running until it
behaved, which is what this card exists to argue against.

**The probe is built and running** (`probe/drawer-stall`). It answers the card's own question and
nothing else: ten drawer opens on ten freshly launched apps inside one test, timing **every** attempt
rather than only the failures, and watching any that miss for a further thirty seconds at half-second
resolution with wall-clock offsets.

**Why ten inside one test rather than ten runs.** `ci.yml`'s concurrency group is keyed on the ref
with `cancel-in-progress`, so three `workflow run` triggers on one branch produce **one** surviving
run: the second was `cancelled` before it started (`35393854081`, measured, not assumed). Samples have
to come from inside a single run. Worth knowing for any future probe on a branch.

**Local baseline, ten for ten: landed at 250-260 ms, about 10 ms of spread.** That is the 220 ms
transition plus polling overhead, and it is the number the CI figures have to be read against. A local
run reproduces nothing — which the card already says — so the baseline is all a local run is for.

**What each outcome would mean**, fixed before the numbers arrive so the reading is not chosen to fit
them:
- every attempt near 260 ms, no misses — the stall needs something this probe does not reproduce, and
  the next move is to add the watch to the real relaunch test rather than a standalone one;
- a spread with slow-but-landing attempts — contention, and the fix is about the budget or about not
  waiting on an animation at all;
- an attempt that never lands in thirty seconds — stuck, and the tolerance is not the problem.

## PROBE RESULTS 2026-09-18 by Henry: two probes, no reproduction, three hypotheses dead

**Both probes answered the card's question with "not here", and the value is in what they rule out.**

| probe | run | numbers |
| --- | --- | --- |
| v1, ten lone opens | `35393993403` | `227 231 233 237 240 262 267 321 340 358` — ten for ten landed |
| v2, one variable at a time | `35399044461` | A lone `227-340`, B resident app alive `265-309`, C resident + navigate `270-303` — twelve for twelve |

Local baseline for both: **250-260 ms, about 10 ms of spread.**

### The first reading, twice, and why not the second

The card's readings were written before either run. Both land on the **first**: the probe does not
reproduce it. v1's 131 ms spread is wider than my laptop's 10 ms, and it is tempting to call that
"contention, confirmed" — but reading two meant attempts near or past the 5 s threshold that still get
there, and **the slowest attempt in either probe is 358 ms, which is fourteen times inside the
window.** Wren quoted the numbers rather than a conclusion both times, which is the only reason the
pre-registered reading did its job.

### Three hypotheses dead

- **A second live app starving the younger one.** v1's tail climbed (262, 321, 358, 340) and this was
  the obvious suspect — the real failure has the file's `beforeAll` app open alongside. v2's B and C
  arms sit **inside** A's own spread, and A is the widest of the three. Dead.
- **Accumulated runner state over a long run.** Both probes ran mid-way through a full suite, roughly
  where the real failure happens. Dead.
- **Other specs running alongside.** `workers: 1` with `fullyParallel: false`. Never possible.
- Earlier, and already dead: **occlusion throttling the compositor**, which Idris retired on the
  grounds that `--drawer-w` is `@property` `<length>` feeding `flex`, so every frame needs main-thread
  style recalc and layout rather than compositor work alone.

**On n.** Four per arm cannot resolve a 10% difference and does not have to. The failure is 250 ms
against 5000 ms — a twentyfold effect — and nothing within a factor of two of it appeared in
twenty-two attempts across the two probes.

### What is left, and it is not another guess

The watch now sits on `openPanel(p1)` itself — the call that actually fails — inside the real relaunch
test, and fires only on a miss: it reads `--drawer-w` for thirty seconds at half-second resolution
with wall-clock offsets, stops the moment the value lands, and rethrows. **Nothing about the
environment is being simulated any more**, so the next sighting produces the answer rather than
another candidate. Grep `DRAWER STALL PROBE`.

That answer is still the card's original question, unchanged and still unanswered: **starved and would
finish, or stuck.** Every candidate fix depends on it and no amount of re-running can say.

## NARROWED 2026-09-19 by Henry, with Idris: one live hypothesis, two dead ends, and the open question answered

### The stall is one painted frame in — now measured forward as well as backward

Idris inverted the `ease` curve against the two sightings and got 1.00 and 1.11 frames. I then produced
the number **forwards**: sampled a perfectly healthy drawer open one frame in, and read `18.0468px`
against the sighting's `18.8536px` — 0.97 frames against 1.00. A derivation that predicts a number
nobody fed it is worth more than the same derivation defended twice. **"One painted frame, then
nothing" is now a measurement.**

It still says *where* the transition stopped and not *why*: the healthy local arm went on to finish in
about 400 ms, so a one-frame reading alone is equally consistent with a transition that completes.

### The live hypothesis, with code under it rather than inference

**`window.ts:66` never sets `backgroundThrottling`; `targetSource.ts:335` sets it to `false`.** So the
throttle that slows or stops exactly this main-thread style-and-layout work is **on** for the chrome
window, which owns `--drawer-w`, and **off** for the target window. `tabs.ts:43` shows the asymmetry was
a deliberate decision for the target ("off for it by design") and there is no sign of a decision either
way for the chrome window.

**Prediction the watch already tests:** at a stall, `document.visibilityState` reads `hidden`, or rAF
comes back `rafDEAD`, or both. `visible/rafOK` with a still width kills this too.

### Two routes to testing it locally, both blocked, both for reasons already written down

Recorded so nobody spends the hour again:

1. **`win.hide()` on a developer desk does nothing.** `deskState.ts:5` already says why — on macOS
   Electron derives hide and show from the window's *occlusion state*, and some desk state keeps a
   window from ever counting as visible. Measured: after `win.hide()`, `document.visibilityState` stayed
   `visible`, rAF stayed alive, and the drawer completed normally. **The comment I cited as evidence for
   the hypothesis is also the reason I cannot check it here.**
2. **Headless Chromium reports every page visible.** `bringToFront()` on a second page leaves both at
   `visibilityState: visible`, in both directions — checked explicitly rather than inferred from one
   arm. A background tab there is not a hidden document.

A headed browser would give real visibility transitions and would also put a window on the user's
screen, so it is not available without asking. **The instrumented CI watch is the only instrument, and
that is now established rather than assumed.**

### The card's open question is answered, and the answer is "the wait stays" (Idris)

This card asked whether the test needs the slide finished at all, since its subject is text scale. **It
does, and the dependency is load-bearing rather than decorative.** Immediately after `openPanel(p1)` and
`choose(...)`, the test polls the target's `innerWidth` for `1280` — and that number comes off the same
layout the drawer feeds: `calc((100vw - var(--drawer-w) - var(--seam)) * var(--split))`
(`styles.css:78`). Removing the explicit wait removes the *name* for the failure, not the failure:
the width poll right after it is stuck on the same stalled value, and reports "the target was never
1280" instead of "the drawer never reached 309px". **Strictly worse, same root cause.**

### The fix direction, and a constraint on it that is mine to raise

Idris's proposal, if the watch confirms `hidden`/`rafDEAD`: **scope the fix to which window is frontmost
when it matters**, not to the flag and not to the wait. Flipping `backgroundThrottling` on the chrome
window is a product regression bought to quiet a test — every user's machine doing full-rate style work
while they have alt-tabbed away, which is the cost `tabs.ts` already declined to pay for the target.

**The constraint: that fix reaches for the machinery `bug-e2e-takes-the-desk` spent four recorded runs
removing.** Fronting a window during e2e is exactly what that card drove to zero activations. On CI
nobody has a desk to take, so it is harmless there — but the helpers are shared with local runs, and a
fix written without that in mind would hand back the activations that card bought. Any candidate must be
CI-scoped, or go through `showsInactive`/`OBSRV_SHOW_INACTIVE` semantics rather than a plain focus or
`show()`. Neither of us is committing to the fix before a watch actually catches one.

## SIX QUIET RUNS THAT WERE NOT EVIDENCE — Henry, 2026-09-19

**The instrument was on a branch the bug does not run on, and I did not notice for six runs.**

Both sightings happened on **ordinary PR runs** — `35345417630` (`#350`) and `35351133949` (`#354`).
The watch I built lives on `probe/drawer-stall`, which runs **only when I dispatch it by hand**. So
across six dispatched runs the instrument was sitting where the bug does not happen, and each clean
run read as *"it has not recurred"* when part of it was *"nothing was watching where it recurs"*.

The six runs were not wasted — they killed four hypotheses and the instrument got better each time —
but **"six runs, no sighting" is not the claim I was entitled to make**, and I made it more than once.

### The same mistake twice, at two scales

- **Small:** the watch sat on `openPanel(p1)` in the relaunch test, and `:194` failed eight lines away
  on the shared app. Fixed by moving it into `drawerSettled`, which every drawer wait goes through.
- **Large:** the whole instrument sat on a probe branch, and the bug happens in PR traffic. Fixed by
  `#376`, which puts a budget-safe version on `main`.

**Both times the fix was the same: put the instrument in the shared path everything goes through, not
in the place I guessed the bug would appear.** The guess was wrong both times, and the shared path
cost nothing extra.

### What goes to `main`, and why it is smaller than what the probe carries

`#376` records **two samples a second apart** on the failure path, not thirty seconds of polling.
`drawerSettled` is shared with specs on the default 30 s budget, and a long poll inside one is the
0.32.0 defect this card already cites (`docs/e2e-flakes.md:141`): the poll outlived its test, rejected
with no test to belong to, and turned a suite red with every test green. **Two samples still answer
this card's question** — advancing means slow and would have landed, identical with `rAF` silent means
the renderer is not servicing frames — and 1.3 s on a path that has already failed is affordable in
any spec.

The thirty-second watch stays on `probe/drawer-stall` for a deliberate hunt. It is the better
instrument and the worse place.

### Honest state

Six dispatched runs, no sighting, and **that number does not mean what a reader would assume it
means.** The real count of runs where the bug could have been caught by an instrument is, so far,
**zero** — and becomes non-zero when `#376` lands.

## THE INSTRUMENT IS WHERE THE BUG IS NOW — Henry, 2026-09-20

`#377` left this card saying the count of runs where an instrument could have caught the stall was
**zero, and would become non-zero when `#376` landed.** It landed. Closing that sentence rather than
leaving it as a promise.

`drawerSettled` on `main` now records two samples a second apart on the failure path — width,
`data-drawer`, `aria-pressed`, `visibilityState`, and whether rAF fires — so **every branch cut from
`main` carries it**, which is the traffic both sightings came from (`35345417630` on `#350`,
`35351133949` on `#354`). The coverage hole that made six dispatched probe runs look like evidence is
closed.

**And it has not fired.** Checked `main`'s recent CI runs directly — `35493270510` and `35492654287`,
zero `DRAWER STALL` lines in either. No sighting has been missed while nobody was looking, which was
the thing worth ruling out.

So the state is now the clean version of what `#377` could only promise: **instrumented in the right
place, and unreproduced since 2026-09-18.** The next sighting answers the card's question — starved
and would finish, or stuck — in one logged line, and the `0px` case (`text-scale.spec.ts:194`) is
separated from the `~18px` one by the same line, because the state fields say whether the click ever
landed.

Nothing here changes the five dead hypotheses or the one live one (`backgroundThrottling` unset on the
chrome window, `window.ts:66`). It changes only what happens the next time the bug occurs, which is
the only thing this card can affect while it is not occurring.


## MOVED TO BACKLOG 2026-09-21 by Henry — not fixed, and not in flight either

**This is not a fix and the column should not be read as one.** The bug has not reproduced since
2026-09-18 and nobody knows its cause. What changed is that there is nothing left to *do* on it until
it happens again, which is a different thing from being finished — `doing` should mean work in
flight, and waiting on an external event is not that.

**The silence, turned into a number rather than left as a feeling.** Seven completed `main` CI runs
since the instrument landed (`e5e5257`), byte-scanned for `DRAWER STALL`: **zero**. The denominator
does not come from the logs, because `drawerSettled` is **silent on success** — it comes from the
tree: **9 `openPanel` call sites plus 2 direct `drawerSettled` calls** across `controls`,
`onion-skin`, `text-scale` and `throttle-live`. So each suite run settles the drawer about eleven
times, and seven runs is **roughly seventy settles with no stall**.

**What that does and does not support.** It rules out "it stalls often". It does not rule out the
bug: both sightings came from **PR traffic rather than `main`**, out of weeks of runs, so seventy
settles is a thin sample against a defect with that base rate. My first attempt at this measurement
used "tests whose name mentions the drawer" as the denominator — **1 per run** — which would have let
me publish "seven runs, zero stalls" while the drawer ran eleven times as often. That is the same
mistake this card already records under *"six quiet runs that were not evidence"*, and I nearly made
it a second time on the same card.

**What reopens it, in one line:** a `DRAWER STALL` line in any CI log. The instrument is on `main`,
so every branch carries it, and the two samples it prints — width, `data-drawer`, `aria-pressed`,
`visibilityState`, rAF liveness — answer the card's open question (starved and would finish, or
stuck) without another investigation. The `0px` case (`text-scale.spec.ts:194`) separates from the
`~18px` one by the same line.
