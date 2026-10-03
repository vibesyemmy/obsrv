---
title: "Three tests on main in 14 hours waited for a frame that did not arrive; each was rescued by its retry, and none printed whether the target was painting"
column: backlog
kind: bug
order: 123
---

**Waiting on a recurrence, and on one instrument being added.** This card groups three observations so they stop
being read as three unrelated singletons. **The grouping is a hypothesis**: they are three tests with three different
messages, and they may be three causes.

FOUND 2026-10-03 by Idris in the CI sightings sweep (`#3113`). All three are first attempts on `main` pushes, all
rescued by the retry, within about 14 hours of each other:

| run | when (UTC) | test | what it said |
| --- | --- | --- | --- |
| `36467069528` | 09-28 18:42 | `target-source.spec.ts:106` | *"no partial frame within 10 s of the change"*; its trace shows `+439 frame 0,0 400x300 of 400x300` and `+439 full frame`, so **frames did arrive, a partial one did not** |
| `36504076439` | 09-29 00:38 | `visibility.spec.ts:66` | after `setShown(true)` the `painting` poll passed, then `paintsOver(700)` read **0** (`Expected: > 2`) |
| `36541147424` | 09-29 08:11 | `orientation.spec.ts:114` | *"no 2556x1179 paint within 10s"* |

## What already covers part of this

- `bug-target-source-106-null-frame` (`later`): the first row **is** a sighting of it, later than the three it
  records (09-17). It already says what the next one must print.
- `bug-canvas-blank-without-notice` (`disclose`): `panes.spec:83`, a blank canvas, **0 sightings in this window**. Its
  candidate mechanism says *"if the next sighting reads `painting: false`"* then the app stopped painting; that read
  exists for `panes:83` only.
- `orientation.spec:114` is named by **no card and no register entry** on `main`. `visibility.spec:66` is named by none
  **by line**, but the register's `visibility.spec and log.spec: when Electron delivers no hide or show at all`
  (`e2e-flakes.md:394`) covers the file's four hide-first tests, which include `:66`, and ends *"CI has never shown
  it."* **This sighting is not that**: that entry is a desk where `hide` and `show` events never fire; here the hide events
  were delivered (the `painting` poll at `:75` passed) and the **resume** half failed at `:76`. (Dogu, `#3128`;
  `visibility.spec:79` in `bug-e2e-takes-the-desk` is a third thing, "minimising counts as hidden".)

## The gap

**None of the three printed whether the target was painting** (`session.painting`, `frameSent()` / `lastSeq`, the
instrument `#267` put in for `panes:83`). So a recurrence of any of them would again say *a frame did not arrive* and
nothing about whether the app had stopped painting or the frame was only late. That is the same position the canvas
card was in before its instrument.

## What would help, and what it must not be

Test-only: the same `painting` / `lastSeq` read, printed **on failure only**, in the two tests that do not have it
(`visibility:66`, `orientation:114`), and in `target-source:106` beside its existing trace. Not in this card's PR;
it is the card's first piece of work.

**It must not become a retry.** Each test passes on its retry, which proves a fresh app paints, and nothing about the
condition that made the first attempt wait (a retry runs in a fresh app with only the failed test, so a failure and
its retry-pass differ in everything the retry resets).

**Not claimed:** a common cause; a class (`release:` is left unset: the linked cards carry `later` and `disclose`,
and the gate's rule is that a card with no value *has not been classified*); a product symptom, since none of the
three reported a wrong answer to a caller.

## Acceptance

- the three tests print the target's painting state when they fail;
- the next sighting of any of them is read against that print and this card says whether the three share it.


## A fourth member, 2026-10-03 (Idris, room `#3196`)

`rendering.spec.ts:90` ("the target really rasterises at 1x: half the rows of ink, darker glyphs") failed its first
attempt in the merge suite of `#545` on `main` (run `37158995878`): *"no full 600x400 paint within 10s"*, after 10.1 s,
and the retry passed in 260 ms. Read from the raw log. The sweep's 168 logs held no `rendering.spec` failure, so it
is a new name in the same family, not a recount of the three. It waited for a frame, as `orientation:114` does. Same
position as the others: nothing printed whether the target was painting, so the next sighting says *a frame did not
arrive* and no more. The first piece of work (the `painting` / `lastSeq` print on failure) should cover it too.
