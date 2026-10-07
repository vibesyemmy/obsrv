---
title: "the two controls for the self-reload note go green-but-blind depending on which test runs before them"
column: backlog
kind: bug
criterion: C5
order: 95
---

FOUND 2026-10-06 by Henry, while re-checking `bug-redirect-note-missing-not-late`'s acceptance on today's
tree.

`tests/e2e/mcp-live.spec.ts:746` (live audit) and `:997` (live lint) are the controls that make that card's
acceptance item (b) real: they drive `tests/fixtures/reloads-during-walk.html`, which reloads itself **to
the same address** during the walk, and they are red when the guard at `src/main/ipc.ts:245` is loosened
(Idris measured that, room #4087). **They hold in the suite's current order.** They also go **green while
measuring nothing** when a particular test precedes them, and that is this card.

## The reproduction, measured

All runs local, `--retries=0`, the bundle's guard printed before each one (`if (url === arrivals(s).url &&
!byDocument) return`).

| run | `:746` | `:997` |
| --- | --- | --- |
| the whole file, one app, as CI runs it | ✓ | ✓ |
| `:997` alone, ×3 | — | ✓ ✓ ✓ |
| `:746` alone, ×3 | ✓ ✓ ✓ | — |
| **`-g` pair, `:746` then `:997`** | ✓ | **✘** |
| `:997` twice in one app (`--repeat-each=2`) | — | ✓ ✓ |
| `:746` twice in one app | ✓ ✓ | — |
| `:746` → `:977` (preset change) → `:997` | ✓ | **✓** |
| `:746` → `:785` (a Back) → `:997` | ✓ | **✘** |
| `:746` → `:760` (live audit of another page) → `:997` | ✓ | **✘** |

**So the suite is not at risk today** — the full file passes, and so does each test alone. **The risk is
that the control's power depends on test order**: a reorder, a shard, a `-g` subset, or a new test
inserted above it makes `:997` pass while seeing nothing. A control that passes while measuring nothing is
the failure mode the whole `bug-redirect-note-missing-not-late` family exists for, and `:997` is one of two
controls for a `release: blocks` item.

## Three hypotheses, read with the corrections below — ONE of them was refuted, not three

1. **"The fixture's one reload is spent by the first test"** (its `sessionStorage` key is set once and never
   cleared) — offered as a *fit* by Idris (#4087) and **refuted**: running **either** control twice in one
   app passes both times (rows 5 and 6).
2. **"An intervening test resets it"**, mine — and the first version of the experiment was invalid:
   **`-g` runs tests in FILE order**, so the test I added at `:589` ran *before* `:746` rather than between
   the two. With a predecessor whose line really is between theirs, `:785` does not restore it.
3. **"A predecessor that leaves the target on a different page restores it"**, mine — **refuted** by
   `:760`, which measures another page and does not restore it.

## HALF-ESTABLISHED: the preset change is one of TWO things the control needs (see the corrections)

**Measured by changing one thing inside the restoring test rather than comparing two different tests.**
`:977` is `obsrv_drive { url: fixture('tall.html'), preset: 'android-65' }`. Dropping **only** the
`preset` from that call, so it still navigates away, and running `:746` -> `:977` -> `:997` three times
each way:

| `:977`'s call | `:997` |
| --- | --- |
| `{ url, preset: 'android-65' }` (as shipped) | **passes 3 of 3** |
| `{ url }` only, preset change removed | **fails 3 of 3** |

**So a preset change is what restores `:997`'s ability to see the reload, and navigating away does not.**
This is a within-test comparison with one variable moved, which is why it settles what the earlier
`:977`-against-`:760` pair only pointed at: that pair was one instance each way across two different tests.

**What it still does not say:** *why* a preset change restores it. The remaining hypothesis is that
changing the preset recreates the target's web contents and so clears the session storage the fixture
keys its one reload off. **That is unrun**, and the experiment is below.

## What was known about the one predecessor that does restore it

`:977` is `obsrv_drive { url: fixture('tall.html'), preset: 'android-65' }` — it **navigates away AND
changes the preset**, and it is the only preset change between lines 746 and 997, so the effect cannot be
confirmed on a second instance without writing a test. `:760` navigates away without a preset change and
does not restore it, which points at the preset change rather than the navigation.

**The experiment that would settle the remaining question, named rather than left to be re-derived:** load
the fixture, set a `sessionStorage` key, apply a preset change through the control server, and read the key
back. If a preset change recreates the target's web contents and clears session storage, the mechanism is
explained. **Nobody has run it** — and it is no longer needed for the fix below, only for the explanation.

## The fix this is asking for, which is not "find the cause"

**Make the two controls order-independent**, so the mechanism stops mattering: give the fixture a per-test
cache-busting query, or navigate the target to a neutral page first, so the walk always meets a fresh
document. **With its own control: insert `:785` before it and it must still pass**, which is the run that is
red today.

## What this card is not

Not the redirect card's acceptance item (b) — that is **met**, by those two controls going red under
sabotage A. **This was deliberately not folded into it**: the acceptance never asked for order-independence,
and closing a gap by widening the item it belongs to is the comfortable direction. Not a cause, either: the
mechanism is unestablished after three refutations, and the card says so rather than offering a fourth
guess.

## CORRECTED 2026-10-07 by Idris, who ran the experiment this card called unrun — four claims above are wrong

**Idris ran it at 09:50Z (room `#4246`), twice, with identical results, in the isolated harness from scratch
specs since deleted. That was BEFORE this card was merged at 10:53Z**, so it shipped carrying claims a run had
already contradicted. Each correction below was re-measured by Henry before being written here, and the two
that matter most were measured independently.

**1. Hypothesis 1 was NOT refuted, and my refutation measured nothing.** The table's rows 5 and 6
(`--repeat-each=2`, labelled "twice in one app") **do not run twice in one app: `--repeat-each` launches a
fresh app per repeat.** Idris printed pids `86028` then `86660`; Henry's own probe printed **`51602` then
`52562`, with `beforeAll` running twice** — two independent measurements. So each repeat had a fresh
`sessionStorage` and could not test a consumed one-shot. **Idris's "fit" in `#4087` was substantially right
and this card called it refuted on an invalid experiment** — the same family of mistake as the `-g`
file-order one it criticises two paragraphs above.

**2. "Nobody has run it" was false when written.** The mechanism: a preset change that **moves the device
scale factor** makes `targetSource.setViewport` **`recreate()` the web contents** (`targetSource.ts:1219-1221`),
and the new contents start with an empty `sessionStorage`. Desktop to phone, phone to another phone and phone
back to desktop all clear it; **a same-dsf change (`1080p-24` to `laptop-768`) does not.**

**3. The "active ingredient" is half the mechanism.** On the failing pair the control needs **two things at
once**, by Idris's 2x2 (each cell twice, identical): a **fresh document** — if the target is already on the
fixture, the same-URL live call does not navigate, so the one-shot listener the first test consumed never runs
again — **and a cleared key**, because the key is per web contents and per `file://` origin and survives a
navigation. **Neither alone restores it; both do.** `:977` supplies both (its `url` differs *and*
`android-65` moves the dsf); `:760` and `:785` supply only the first, which is exactly why they do not
restore it. So the earlier section's measurement stands as far as it goes — removing the `preset` flips the
result — but it was read as the whole cause and it is one of two.

**4. The fix this card proposed would not have worked, and Henry verified that rather than taking it.** The
card asked for "a per-test cache-busting query, **or** a neutral page first". **The key survives both**: a
probe loading the fixture with `?a=1`, setting the key, then `?a=2`, then a neutral `file://` page, then
`?a=3`, read the key back as `1` at every step. Each option satisfies the navigation condition and neither
clears the key. **What Idris measured working, twice:** key the fixture's one-shot on `location.search`
(`'obsrv-walk-reload:' + location.search`, two occurrences in `tests/fixtures/reloads-during-walk.html`) and
give each test its own query (`?t=746`, `?t=997`) — a unique query makes the URL differ **and** the key
differ. **The pair went `✓ ✓`, and the order that was red (`:746` -> `:760` -> `:785` -> `:997`) went `✓`
throughout.** Not run with the whole file, and not sharded.

**So the fix is now specified rather than guessed, and it is still open.** The fixture is used by those two
tests only, and an unqueried load keeps the old key, so nothing else changes. **The control stays the same:**
insert `:785` before it and it must still pass.

**What this card got wrong, kept because it is the point.** Of three hypotheses it called refuted, **one
was** (a different page alone restores it — no). The other two were closer to right than their refutations:
the first was killed by an experiment that ran two apps while claiming one, and the second by an experiment
that ran its predecessor in the wrong position. **Both invalid experiments were mine, and both looked like
clean negative results.** The pattern is not "I guessed wrong" — it is that **a harness that quietly does
something other than what the sentence describes produces a confident refutation**, and I published two of
them on one card.
