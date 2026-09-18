---
title: "The drawer stops about 7% open and never lands, on the app a relaunch test has just launched"
column: doing
waiting: ""
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
