# B5: the same page measured twice

*2026-09-14, against `3871e46` (0.60.0 plus the temp-directory pruner).*

Readiness B5 asks whether the same page measured twice answers the same, and
asks for **two numbers published separately**, because one cannot be read
without the other: a single figure over live sites cannot tell *the tool
moved* from *the page moved*.

Both were measured. The first is zero. The second is not, and taking it apart
found one defect of ours.

---

## Number 1 — fixtures: 0

**33 cases × 5 runs × 3 machine conditions. Not one result field moved.**

The fixtures were served over loopback from an in-memory cache of the file, so
every run received byte-identical HTML. Each run's JSON was flattened to its
leaves (3,375 per run across the 33 cases) and compared across the five.
Anything that moved would be ours.

| condition | node CPU | cases stable | result fields moved |
|---|---|---|---|
| quiet | ~0% | 33 / 33 | **0** |
| 28 busy workers | 1347% | 33 / 33 | **0** |

What was compared includes everything a user reads: walk counts and `atEnd`,
page heights, target and text counts, the `under` counts, every finding's kind
and element and box, the groups, and **the warning sentences themselves**.

The 33 cases were chosen for where drift would live, not for where it would
not: pages that lazy-load, that paint or render late, that hydrate, that grow
as they are walked, that reload mid-walk, that replace themselves on scroll,
app shells and sticky app shells, stuck chrome, a scroll-locked document, an
open dialog that steals the scroll, a consent wall over a tall page, and two
pages that never go quiet.

### The comparator was proven able to see

A sweep that reports nothing fits two facts: the tool is deterministic, or the
comparator is blind. They are opposite, so the comparator was tested by
planting differences into the saved runs:

| planted | comparator said |
|---|---|
| nothing (control) | 1 field (`walked.ms`) |
| one `targets.under` raised in run 3 | `summary.targets.under` |
| one finding dropped from run 5 | `findings.length`, `findings[0].kind`, `findings[0].element` |
| `walked.screenfuls` raised in run 2 | `walked.screenfuls` |

### Five cases measured zero, and none of them was silent

`locked`, `wall-over-a-tall-page`, `blocks-after-load`, `hydrate` and
`animated-tall` returned no findings. A case that measures nothing is stable
for a reason that is not determinism, so each was read rather than counted:
every one carried a note saying why, and **the notes were byte-identical
across all five runs**, which is the stronger result. The dialog case
distinguishes itself from the wall in its own words — "the walk scrolled a
dialog, not the page itself" against "an `<iframe>` covers 100% of the
viewport and the page beneath it did not move".

### Machine load does not reach the measurement

A first attempt at this used 8 busy workers on a 14-core machine and ran at
**0.97×** — the load never reached Electron, and "33/33 stable under load"
would have meant nothing. Discarded. At 28 workers the machine is genuinely
saturated (1347% node CPU) and the sweep runs at **1.026×**; the worst
within-five-run timing spread was *smaller* saturated (5 ms) than quiet
(8 ms).

That is the explanation for number 1 rather than a separate result: the walk
is paced by its own clock, not by the machine's throughput, so a laptop doing
other things does not change what it reports.

---

## Number 2 — real sites: it depends entirely on the site

**3 sites × 2 commands × 5 runs, 3,834 leaf fields per run.** The sites were
picked so the pair brackets what B5 calls undecomposable.

| site | what it is | fields moved | headline counts |
|---|---|---|---|
| berkshirehathaway.com | plain HTML, no ads, no lazy loading | **0 of 49** (audit), **0 of 28** (lint) | identical, all 5 runs |
| bbc.com/news | rotating headlines and ads | 10 of 99 (audit), 8 of 177 (lint) | `findings` 6 every run; `targets` 27, 27, 26, 26, **39** |
| stripe.com | marketing site with a rotating carousel | 103 of 1060 (audit), 161 of 2421 (lint) | `findings` 97 every run; `pageHeight` 15057 / 14619 |

**berkshirehathaway.com is the control, and it is clean.** A real site, over
the real internet, five runs, not one field different. Whatever moves on the
other two is not the tool's contribution to a measurement.

**The counts a user acts on held everywhere.** `findings` was 6 on every bbc
run, 97 on every stripe audit run, 200 on every stripe lint run;
`targets.under` was 6 and 97 respectively on every run. What moved was
geometry — `pageHeight`, and finding boxes shifting with it.

**bbc's movement is its content.** `snap` answers `settled: true`, so nothing
was in motion: the page simply served different headlines and ads, at
different heights, on different loads. The `targets` jump from 26 to 39 on run
5 is that — a real difference between two real pages that happen to share a
URL. Not ours, and not something the tool could or should suppress.

---

## What this found: audit and lint measure moving pages without saying so

stripe.com answers **`settled: false, unsettledReason: animating`** — when
asked by `snap`. Asked by `audit` or `lint`, it answers with `warnings: []`.

`audit` and `lint` have no settle concept at all: neither reports `settled`
nor `unsettledReason`, and neither mentions it in a note. On stripe.com that
silence covers finding boxes moving by up to **438 CSS px** between runs — 96
of 97 findings shifted, across 66 distinct deltas, the topmost being
`button.customer-stories__customer-button`, which is the auto-rotating
customer-stories carousel caught at different positions.

The movement itself is the site's and is not a defect. **The silence is
ours.** Three things follow from it:

1. A user doing a before-and-after on a page with a carousel reads moved
   coordinates as change. This is precisely what B5 exists to catch: part of
   what they read is noise wearing the shape of a result.
2. `report` pins findings onto a screenshot by these coordinates, so a
   finding can be pinned where it no longer is.
3. It is a C4 failure as well as a B5 one. The same page, asked the same
   question by two of this tool's own commands, gets an answer from one and
   silence from the other — and the agent cannot see which surface it asked.

`diff` already refuses to interpret an unsettled comparison and says so.
`snap` states it. `audit` and `lint` are the two that do not, and they are the
two whose output a user compares across runs.

**Not fixed here.** This document is the measurement; the fix is its own
change.

---

## Status after this

- **B5 fixtures: met.** 0 of 3,375 fields, 33 cases, 5 runs, quiet and
  saturated.
- **B5 real sites: measured, and the number is legible** — 0 on a static real
  site, and on the other two the movement is the site's, with the counts a
  user acts on stable throughout.
- **B5 across two released versions: not done.** That is the third part of the
  check and wants 0.59.0 and 0.60.0 installed side by side.

## Reproducing it

The harness is not committed — it is five scratch files and a fixture server,
and it is cheaper to rebuild than to maintain. What matters to keep is the
method:

1. Serve the fixtures as static bytes, so anything that moves is ours.
2. Flatten each run's JSON to leaves and compare across runs; classify a
   moved leaf as timing, path, or result.
3. **Prove the comparator can see**, by planting differences into the saved
   runs.
4. Read every case that measured nothing, rather than counting it as stable.
5. Check that any load you claim to have applied actually reached the thing
   you measured.
