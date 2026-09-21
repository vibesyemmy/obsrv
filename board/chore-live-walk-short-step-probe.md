---
title: "Observe whether a live walk step on a growing scroller lands short of the bottom"
column: done
owner: "Dogu"
kind: chore
criterion: C4
order: 80
---

FILED BY HENRY 2026-09-17, closing `bug-walk-coverage-diverges`. It is that card's one leftover, filed
under the sweep's rule that leftovers become cards and are never folded in quietly.

**What is established there:** the live and headless walks cover `app-shell-grows.html` differently
because the live walk is slower per step (about 3.7×), and growth arrives asynchronously from the
previous step's `scroll` handler. **The mechanism that follows is a reading of the code, not an
observation:** a live step applied while the feed is still reflowing lands short of a bottom that is
moving, reports `atEnd: false` honestly (`reached = applyTo(el, pos)`, then `atEndOf(scrollerEl,
reached)`), and so the walk takes one more step, which triggers the second growth.

**The probe, as Rook named it:** walk the fixture live and record, at every step, `reached` against
the scroller's `scrollHeight - clientHeight` at the moment `atEnd` is read. If any step is short while
the extent is still growing, the reading becomes an observation. If no step is ever short, the reading
is wrong, and the divergence needs another mechanism.

**Where it runs:** CI, on a throwaway `probe/` branch with a dispatch-only workflow, as the rAF and
walk-timing probes did. It is desk-free, because the harness app is enough and no visible window is
needed.

**Not a fix, and it must not become one by accident.** Taking `atEnd` after a frame is the change this
evidence might tempt, and `bug-walk-coverage-diverges` already records why it is wrong: it would
silence the note the fixture exists to raise.

## MEASURED 2026-09-17 by Dogu, on CI — four arms, not the one the card asked for first

**Claimed and built in a prior session; write-up delayed by a session boundary — recovered from the
pushed branch (`probe/walk-visible`) and the CI run it already produced (`35165871681`) rather than
re-run blind, then read fresh before writing anything down.**

**What this does NOT do, said first rather than found later:** the card asks for per-step
`reached` vs `scrollHeight - clientHeight`, read at the moment each step calls `atEnd`. What got
built instead answers the question one level up — *does making the app visible change the walk's
outcome at all* — across four conditions, aggregate rather than per-step. If the team wants the
per-step trace specifically, that is still open; this is real evidence toward the card's motivating
question, not a substitute for its literal ask.

**Arm C — does `OBSRV_TEST_TAKES_THE_DESK=1` actually change anything this runner can see?**
Checked before trusting arms A/B on the flag, because an inert flag would make "visible" and
"hidden" the same condition twice:

```
flag=off  window={"found":true,"visible":true,"focusable":false,"focused":false,"count":2}
flag=ON   window={"found":true,"visible":true,"focusable":true,"focused":true,"count":2}
```

Real change — `focusable`/`focused` flip. Arm B is a measured condition, not an inert repeat of A.

**Arm D — does this runner produce frames at all, shown or hidden?** Henry's objection to an
earlier draft of this write-up: "a window that is shown but never painted renders no more frames
than a hidden one" was asserted, not measured. Counted `requestAnimationFrame` callbacks over 1s,
window and target `webContents` separately, both visibility states, same run:

```
flag=off  shown:  window=53/s  target=19/s
flag=off  hidden: window=57/s  target=21/s
flag=ON   shown:  window=60/s  target=24/s
flag=ON   hidden: window=54/s  target=18/s
```

All four in the same range. This runner paints regardless of window visibility — the concern that
motivated arm D does not hold here.

**Arm A/B — the actual question: headless vs live, hidden vs visible+focused, on
`app-shell-grows.html`:**

```
headless  flag=off  screenfuls=3  atEnd=true  pageHeight=4712  walkMs=496   note=FIRES
live      flag=off  screenfuls=3  atEnd=true  pageHeight=4712  walkMs=1770  note=FIRES
headless  flag=ON   screenfuls=3  atEnd=true  pageHeight=4712  walkMs=463   note=FIRES
live      flag=ON   screenfuls=3  atEnd=true  pageHeight=4712  walkMs=1787  note=FIRES
```

**`screenfuls`, `atEnd`, and `pageHeight` are identical across all four.** Visibility and focus
change neither headless's nor live's outcome on this fixture. The only thing that moves is
`walkMs` — live is consistently ~3.7x slower than headless (1770-1787ms vs 463-496ms), matching
the timing difference `bug-walk-coverage-diverges` already measured — timing, not rendering state,
is what's doing the work, and making the app visible does not touch it.

**What this settles and what it doesn't.** It directly answers "does a visible app walk a growing
page further" — no, not on this fixture, not in aggregate. It does not produce the per-step trace
that would show a step landing short of a moving bottom while the extent is still growing, which
is the literal instrument the card specifies. Given the aggregate outcome never differs across all
four conditions, a per-step trace seems unlikely to find a difference either — but "seems unlikely"
is a reason to ask before building it, not a substitute for the answer.

**The note itself, read rather than assumed to be the coverage-divergence one:** *"the walk
scrolled a panel on the page, not the page itself: this page hides the document's overflow and the
only scroller the walk found was a panel within it..."* (truncated at 160 chars in the log) — this
is `app-shell-grows.html`'s own scroller-identification note, present identically in all four runs,
not a coverage-percentage warning. Worth someone confirming this is the note the card meant before
treating "note=FIRES" as settling anything about coverage specifically.

**Data source:** run `35165871681` on `probe/walk-visible` (2026-09-17T00:16Z) — three days old
relative to today. The probe job itself (`Does a visible app walk a growing page further`)
succeeded; the run's overall CI conclusion was `failure` from the unrelated
`typecheck · unit · shader parity · e2e` job, which does not touch this probe. Not re-run for
freshness before writing this up — the fixture and the walk's generic step logic are not in the
diff path of anything merged since, but saying so rather than presenting three-day-old numbers as
today's.

## CLOSED 2026-09-21 — the literal ask dropped, the motivating question answered

Per Henry's #1564 ruling (as lead) and this card's own honest framing above, closing this requires
a scope decision rather than more measurement: either the literal per-step ask stays open as its own
card, or the aggregate answer is accepted as settling what anyone actually needed. As the one who
measured it, I'm making that call: **dropping the per-step trace, closing on the aggregate answer.**

**Why the aggregate answer is enough.** The question this card exists to serve is
`bug-walk-coverage-diverges`'s leftover — does a live, visible, focused app walk a growing page
further than a hidden/headless one. Arms A/B answer that directly and completely: `screenfuls`,
`atEnd` and `pageHeight` are bit-for-bit identical across headless/live × flag-off/flag-on. There is
no difference for a per-step trace to explain — the per-step instrument exists to show *why* a step
lands short of a moving bottom, and nothing here shows any step landing short differently by
visibility at all. Building the instrument now would measure a mechanism in service of an outcome
that has already been shown not to occur on this fixture.

**Resolving the one loose thread from the write-up above** (line 100's "worth someone confirming
this is the note the card meant"): traced `note=FIRES` to `walkDialogNote` (`walkCoverage.ts:256`),
specifically its screenfuls>0, non-dialog branch (`opened = 'and the only scroller the walk found was
a panel within it'`). This is the walk's own coverage-attribution sentence — it fires precisely when
the walked screenfuls belong to a panel scroller rather than the page, which is `app-shell-grows.html`'s
actual shape. So it is the coverage-relevant note, not a different producer, and its identical firing
across all four arms is further evidence for the same conclusion: coverage attribution didn't move
either.

**What stays open, named rather than buried.** If a live walk is ever observed to misbehave —
diverging from headless on a real page, not this fixture — the per-step `reached` vs
`scrollHeight - clientHeight` trace is still the right instrument for that investigation and can be
built then, against a case that motivates it. Opening it now, with no case in hand, would be
building evidence nobody has asked a question of yet. Per Henry's #1564: "a per-step trace is worth
its own card only if someone can name what they'd do differently with it" — nobody can, today.
