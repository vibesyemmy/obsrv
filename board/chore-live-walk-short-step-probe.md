---
title: "Observe whether a live walk step on a growing scroller lands short of the bottom"
column: backlog
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
