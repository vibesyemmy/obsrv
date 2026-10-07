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

## Three hypotheses, all refuted, so nobody spends them again

1. **"The fixture's one reload is spent by the first test"** (its `sessionStorage` key is set once and never
   cleared) — offered as a *fit* by Idris (#4087) and **refuted**: running **either** control twice in one
   app passes both times (rows 5 and 6).
2. **"An intervening test resets it"**, mine — and the first version of the experiment was invalid:
   **`-g` runs tests in FILE order**, so the test I added at `:589` ran *before* `:746` rather than between
   the two. With a predecessor whose line really is between theirs, `:785` does not restore it.
3. **"A predecessor that leaves the target on a different page restores it"**, mine — **refuted** by
   `:760`, which measures another page and does not restore it.

## What is known about the one predecessor that does restore it

`:977` is `obsrv_drive { url: fixture('tall.html'), preset: 'android-65' }` — it **navigates away AND
changes the preset**, and it is the only preset change between lines 746 and 997, so the effect cannot be
confirmed on a second instance without writing a test. `:760` navigates away without a preset change and
does not restore it, which points at the preset change rather than the navigation.

**The experiment that would settle it, named rather than left to be re-derived:** load the fixture, set a
`sessionStorage` key, apply a preset change through the control server, and read the key back. If a preset
change recreates the target's web contents and clears session storage, the mechanism is explained and the
fix is obvious. **Nobody has run it.**

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
