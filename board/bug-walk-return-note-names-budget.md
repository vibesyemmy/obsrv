---
title: "The headless walk says the page did not answer its return to the top for the whole budget, when it gave the page no time at all"
column: done
owner: "Kenya"
kind: bug
criterion: C5
order: 94
---

FOUND BY KENYA 2026-09-17, in the cold read of #308 (walk limits batch 2). Wren verified the code path,
and Henry made the call on the fix (below). **Headless only.**

## The defect

`src/cli/walk.ts:88-91`: `step` waits `deadline.remaining()` and, when that runs out, throws
`walkTimeoutNote(budgetMs)`, which names the walk's **whole** budget:

    const r = await withinBudget(target.webContents.executeJavaScript(…), deadline.remaining())
    if (r.timedOut) throw new Error(walkTimeoutNote(budgetMs))

`backToTop` (`:94-100`) runs **after** the walk, when the deadline has usually just run out. So it waits
about 0 ms and reports:

> the walk could not return to the top afterwards (the page did not answer a scroll within 15 s (its
> main thread was busy or blocked)); measured where it stopped.

**The page was given no time, and the sentence blames its main thread for fifteen seconds.** The
sentence does not name its own subject: what ran out is the walk's budget, and it names the page. This
turned up in the same week those sentences are being inventoried (`docs/note-inventory.md:271` lists
this one as `cli/walk.ts:98`).

## Two paths reach it, and only one has been seen

**1. After a cut-short walk (`:183`): fires headless today, and not asserted on purpose.** A page that
holds its main thread times the walk's step out on the deadline, the `catch` pushes *"the walk was cut
short…"*, then calls `backToTop` with nothing left. `blocks-on-scroll.html` (#308) is already this
path's lever. Henry deliberately does **not** assert the sentence there, because pinning a sentence known
to be wrong is what `bug-live-raster-uncovered-said-as-painting` was filed for. Once the fix lands, the
assertion is one arm on an existing fixture.

**2. After the walk stops on its budget (`:188`): on a page whose main thread is FREE, which means the
end of every headless walk that reaches its budget. That is an ordinary tall page, not a broken one
(reasoned, then run on a fake; Wren confirmed the fall-through).** The loop `break`s at
`deadline.passed()` and falls through to `backToTop`, which runs with
`deadline.remaining()` at 0. That becomes a race: `withinBudget`'s 0 ms timer against
`executeJavaScript`'s reply. A scratch vitest run (not committed) drove `walkHeadless` with a fake
target that always answers, on a 600 ms budget:

| fake reply latency | notes |
| --- | --- |
| 0 ms, 1 ms | the budget sentence only |
| 2 ms, 5 ms | the budget sentence, **then** *"the walk could not return to the top afterwards (the page did not answer a scroll within 0.6 s (its main thread was busy or blocked)); measured where it stopped."* |

So on a page nothing is wrong with, the reply can say *"the measurement covers the whole page
regardless"* and then *"its main thread was busy or blocked … measured where it stopped"*: two
sentences that contradict each other, plus a false one about the page.

**Predicted: it fires on essentially every budget-exit headless walk.** A real `executeJavaScript` round
trip through Electron takes milliseconds, not microseconds, and the fake shows the sentence from 2 ms. So
"unmeasured" does not mean "rare": the CI measurement below settles the prediction either way.

**No CI log can answer it (checked 2026-09-17 by Kenya and, on a green main run `35233605462`, by
Wren).** The budget sentence had never fired on CI before #308's `taller-than-the-walk-budget.html`. #308's
runs (`35230375653`, `35231440742`, Henry's probes on `probe/c5-walk-limits-b2`) and batch 1's
`35200677199` never print a budget-exit walk's whole notes array: #308's budget test finds its sentence
with `said(m).find(…)` and prints the list only on failure. **So the evidence belongs to this card's
fix, which needs a control anyway:** the control run prints the notes as they are today, and the fixed
run prints what they say instead.

**Also, smaller:** the cut-short sentence's own number overstates the wait by the walk's elapsed time.
The step waited `budget − elapsed`, but the sentence says the whole budget: about 0.2 s over on
`blocks-on-scroll.html`, and about 1.5 s (ten 150 ms dwells) for a page that blocks ten screenfuls in.

**Not live.** `src/mcp/walk.ts:101-106` calls `deps.call('scroll', …)` with no budget of its own, so
there is no number to misreport. The control server answers `scrolled: null` after its 1 s window rather
than throwing. Nobody needs to go looking for this defect live.

## The fix: Henry's call

**Report the time actually waited:** capture `deadline.remaining()` before the call, and put that in the
sentence. **Not** "skip `backToTop` when nothing is left". Henry's reason: that trades one silence for
another. The walk would say nothing about failing to return to the top, and a reader could not tell
that from a walk that did return. It is the same shape as the silence rule.

**The trap, from Wren:** `seconds()` is `Math.round(ms / 100) / 10`, so the honest figure at a spent
budget prints as **"within 0 s"**. That reads like a bug in the sentence, not a fact about the walk. The
spent case needs its own phrasing, one that says the walk's budget was already gone, so the page was
given no time to answer. Otherwise a false sentence becomes an absurd one, and Henry's objection to
the other fix applies to this one too.

**Kept out of #308** (Henry): that PR only adds tests, and a product fix inside it would need its own control
and blur both stories.

## Acceptance, each with a control

- **measure path 2 inside the fix, not before it:** the fix's CI control run (today's wording) prints
  the whole `said(m)` for `taller-than-the-walk-budget.html` headless and records whether the
  return-to-top sentence sits beside the budget sentence. The fixed run prints what it says instead.
  `cli-*` is not desk-safe, so this runs on CI;
- the step's timeout sentence names the time the step was actually given, with its own wording when
  that was none. **Control:** restoring `walkTimeoutNote(budgetMs)` reds a test;
- a unit test driving `walkHeadless` on a fake target covers both paths without the desk: a step that
  never answers (cut short), and a budget exit with a reply latency above 0;
- `cli-walk-limits.spec.ts` asserts the return-to-top sentence on `blocks-on-scroll.html` headless (the
  arm #308 deliberately left out).

## MEASURED 2026-09-17 by Henry, on `#308`'s own prints — the prediction is half right

`#308` added the unconditional `console.log('budget-ended walk said: …')` this card asked for, on both
surfaces, and it has now run **twice** on the same branch. The two runs disagree, which is the answer.

| run | headless budget-ended walk said |
| --- | --- |
| `35234853920` | the budget sentence, and nothing else |
| `35239464603` | the budget sentence, **then** *"the walk could not return to the top afterwards (the page did not answer a scroll within 15 s (its main thread was busy or blocked)); measured where it stopped."* |

The live surface printed the same two sentences both times — the budget sentence and the `groupsOnly`
note — and the return-to-top sentence is in neither. So, on real Electron:

- **path 2 is real: 1 of 2 headless budget-ended walks carried the sentence, 0 of 2 live.**
- **"essentially every budget-exit headless walk" is too strong.** It is the race this card already
  described, and the page wins it about half the time at a 15 s budget on the CI runner. Two runs is
  not a rate; it is enough to rule out both "never" and "always".

**A third run landed after the lines above were written** — `35242092672`, the suite `#308` merged
on — and its headless walk carried the sentence again. Live, again, did not. The two-run table is kept
as written, since the bullets above were drawn from it:

| run | headless carried it | live carried it |
| --- | --- | --- |
| `35234853920` | no | no |
| `35239464603` | yes | no |
| `35242092672` | yes | no |

**So far: 2 of 3 headless, 0 of 3 live.** Still a race and still not a rate — but it tilts toward the
sentence, the direction Kenya's original prediction pointed, not mine.

**Two lines above are now stale and are corrected here rather than edited away:** *"No CI log can
answer it"* and *"prints the list only on failure"* were true of the runs that existed when they were
written. `#308` changed that on purpose, and the answer cost no run of its own.

### What the measurement changes about the fix

**On this path the sentence is wrong twice over, and only one half was on the card.** The card's fix —
report the time actually waited — answers the number. But on a budget exit the page's main thread is
**free**: run `35239464603`'s walk answered all **97** steps and was then told it *"did not answer a
scroll within 15 s (its main thread was busy or blocked)"*. **The blame is false too**, and no
correction of the duration removes it. The cut-short path is different, and there the blame is fair
(Wren): the thread really is blocked, and only the number lies.

So the spent-budget wording Wren asked for is not just a way to avoid printing *"within 0 s"*. It has
to stop accusing the page at all — the walk ran out of its own budget before it asked, and that is a
fact about the walk. Something of the shape *"the walk's own budget was gone before it could return to
the top, so the page was not asked; measured where it stopped."*

**Acceptance item 1 is met** (the measurement) and is kept for its second half: the fix's control run
still prints today's wording beside the fixed one. The last three items stand.

## CORRECTION 2026-09-17 by Henry, on Wren's read: my proposed wording was itself false

The paragraph above proposed *"the walk's own budget was gone before it could return to the top, so
**the page was not asked**"*. **The page is asked.** `backToTop` calls `step('top')`, which issues
`target.webContents.executeJavaScript(WALK_STEP_SCRIPT('top'))` and only then loses a race against a
zero-length timer (`walk.ts:88-100`). The page is asked and **not waited for**, which is a different
thing — and the difference is exactly what someone debugging a page that received a scroll nobody
acknowledged needs to read.

**Wren's wording, which is true on both paths:**

> the walk had no budget left to return to the top, so it did not wait for the page; measured where it
> stopped.

On the cut-short path the thread really is blocked and that sentence stays true; it simply stops
asserting a 15-second silence nobody measured. The blocked-thread fact is not lost — it belongs on the
step that actually timed out, which is where it was measured.

### A third fault in the same sentence, reasoned and NOT measured

If the page is asked and the walk merely stops waiting, then on a free main thread **the scroll
usually lands** — a few milliseconds later, before the audit or lint that follows runs. So the note's
last clause, *"measured where it stopped"*, is probably wrong too on this path: the measurement is of
the page at the **top**, not where the walk stopped.

**This is a code reading, not a result**, and it is written here as a candidate so that nobody quotes
it as one. It is cheap to settle on the fake target Kenya already built: have the fake record the
scroll position it was left at, and assert what the note claims against it. If it holds, the fix has
three things to correct in one sentence — the duration, the accusation, and the place.

## CLAIMED BY KENYA 2026-09-17, and the third fault is measured before the fix

My Doing was cleared by #329 first. @Henry's engineering call was to start rather than idle on that
bookkeeping; the claim waited for Opeyemi either way.

### The place claim, swept on the fake target rather than sampled

The card asked whether *"measured where it stopped"* is true on the budget-exit path. It is not, on
every arm where the note fires.

**Method.** `walkHeadless` against a fake target that applies each scroll **when the script finally
runs**, whether or not anyone is still awaiting it — which is what a renderer does with an abandoned
`executeJavaScript`. 600 ms budget, then a wait of latency + 30 ms standing in for the audit that
follows the walk. Reply latency swept 0 → 20 ms.

| reply latency | return-to-top note | the page's final offset |
| --- | --- | --- |
| 0 ms, 1 ms | silent | y = 0 |
| 2, 3, 5, 8, 12, 20 ms | **fired** | **y = 0** |

**So the last thing to happen is the `top` scroll landing**, and the note claims the measurement is of
where the walk stopped. A reader debugging "my full-page audit missed the bottom" is sent to the wrong
end of the page.

**What it is not:** a live measurement. It is a model with one assumption — that an abandoned
`executeJavaScript` still runs in the renderer. True of Chromium, and the fix's control run settles it
for real by printing the offset after a budget-ended walk on CI. Eight arms of a model are still a
model; @Henry's warning that the note is a race (2 of 3 headless, 0 of 3 live) is why it was swept
rather than sampled.

### So the fix corrects three things in one sentence

1. **the duration** — a 15 s wait that was about 0 ms;
2. **the accusation** — a page that answered all 97 steps, told its main thread was busy;
3. **the place** — a measurement of the top, described as where the walk stopped.

@Wren's wording answers the first two: *"the walk had no budget left to return to the top, so it did
not wait for the page"*. The last clause is what the third needs, and it should say what is true on
both paths rather than assert a position nobody measured.

**Order of work:** the unit arms on the fake target first (both paths, and the offset), then the
product change, then the CI control run that prints today's wording beside the fixed one.


## The change, 2026-09-18 by Kenya (#338): all three faults in one sentence, each with its own control

**The change** (`src/cli/walk.ts`):
- **the duration:** `step` captures `deadline.remaining()` before the call and reports *that*, not
  `budgetMs`. A step that made no wait no longer claims fifteen seconds;
- **the accusation and the place:** `backToTop` now has two sentences, because two different things
  happen. With the budget spent it says *"the walk had no budget left to return to the top, so it asked
  the page and did not wait for the answer; the page may have scrolled to the top after the measurement
  began."* — @Wren's subject, and a last clause that claims no position. With budget left and a step
  that still failed, the original sentence stands, because there the page really was waited for and
  really did not answer;
- **silence stays off the table** (Henry): a walk that could not return the page would otherwise read
  like one that did.

**Tests: `tests/unit/walkReturnToTop.test.ts`**, on the fake target, so the race is a parameter rather
than the machine's mood. Four arms on the spent path (no accusation, no invented duration, no place
claim, and the sentence still said at all), one on the cut-short path (the duration is the time the
step was given, and the accusation is fair there).

**Controls, each restoring one fault on its own:**

| restored | arms red |
| --- | --- |
| the duration named as the whole budget | **1** — the cut-short arm |
| one sentence for both paths | **2** — the accusation and the place |
| silence when the budget is spent | **4** |
| nothing (the fix as written) | **0**, all five pass |

**`cli-walk-limits.spec.ts` now pins the new sentence** on `blocks-on-scroll.html` — the arm batch 2
deliberately left out, because the sentence it would have pinned was the wrong one. That runs on CI;
`cli-*` is not desk-safe.

**Unit suite on the fixed tree: 1548 passed, 1 skipped, 107 files.**

**What is still a model, and what settles it:** the fake applies a scroll when the script runs, awaited
or not, which is what Chromium does with an abandoned `executeJavaScript`. The e2e arm above is the live
half — if a budget-ended walk on CI ever carries the old wording, or the new sentence's last clause
turns out to describe a page that did *not* reach the top, that is a finding for this card.

## DONE 2026-09-18 by Kenya: merged in #338 (`5b1b4b1`)

All four acceptance items, each against what ran:
- **the step's timeout sentence names the time it was actually given**, with its own wording when that
  was none. **Control:** restoring `walkTimeoutNote(budgetMs)` reds the cut-short arm;
- **the unit arms on a fake target cover both paths without the desk** — four on the spent-budget path,
  one on the cut-short path, with the latency swept rather than sampled;
- **`cli-walk-limits.spec.ts` asserts the return-to-top sentence** on `blocks-on-scroll.html`, the arm
  batch 2 deliberately left out while the wording was still wrong;
- **path 2's place claim was measured before the fix**, not after: at every latency where the note
  fires, the abandoned `top` scroll still lands, so the page is at the top.

**Controls, each restoring one fault alone:** the duration reds 1 arm, one sentence for both paths reds
2, silence on a spent budget reds 4, and the fix as written reds none. Unit suite on the merged tree:
1548 passed, 1 skipped.

**What is still a model:** the fake applies a scroll when the script runs, awaited or not. The e2e arm
is the live half — a budget-ended walk on CI carrying the old wording, or a page that did not reach the
top, is a finding against this card rather than a new one.

