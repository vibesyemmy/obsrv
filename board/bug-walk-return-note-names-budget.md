---
title: "The headless walk says the page did not answer its return to the top for the whole budget, when it gave the page no time at all"
column: backlog
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
