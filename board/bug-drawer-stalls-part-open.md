---
title: "The drawer stops about 7% open and never lands, on the app a relaunch test has just launched"
column: next
owner: ""
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
just launched. It recovers on retry. The two stall points are close enough to each other to look like
the same event rather than two different amounts of slowness.

**Not known: whether the renderer is starved and would have finished, or whether the transition is
genuinely stuck.** The poll cannot answer this, because it gives up at 5 s and nothing records what
`--drawer-w` does afterwards. Every plausible fix depends on which of those it is, so this is the
first thing to settle and it is cheap: poll to 30 s, log the value each second, and read whether it
climbs, jumps, or sits still.

A guess worth writing down only so it is tested rather than assumed: a renderer whose window is
occluded has its compositor throttled, and CSS transitions do not advance. It fits the shape. It does
**not** obviously fit the first sighting, where the stall was on the file's shared app at a point when
no second window existed yet — so if occlusion is the answer, something other than another Obsrv
window was covering it.

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
