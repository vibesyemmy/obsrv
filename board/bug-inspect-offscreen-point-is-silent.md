---
title: "`obsrv_inspect` answers an off-screen point exactly as it answers an empty one"
column: next
kind: bug
order: 44
---

FOUND BY ROOK in run 19, 2026-09-16. **Unowned.** Not live-specific: the headless path does the
same, and the card says so rather than claiming a live finding.

## The defect

`obsrv_inspect` at `(1000, 500)` on a 412-wide screen:

    found: false    readout: null    notes: []

**No note that the coordinate is not on this screen.** So `found: false` carries two opposite
facts — *nothing is painted there* and *that point does not exist here* — and an agent that
arrived at the bad coordinate honestly (see `bug-drive-status-race-at-launch`) concludes the
page is empty.

## The same app already does this right, two calls away

`obsrv_drive`'s `highlight`, given a page rect scrolled out of view, answers:

    drawn: false
    warnings: ["the page rect is off screen at the current scroll (0, 1536); scroll it into view first"]

**The reason, the state that caused it, and the fix.** Same class of caller mistake, same tool
family, opposite treatment. This is not a missing design — it is a design applied in one place
and not the other, which is the cheapest kind of fix to argue for.

## What a fix has to decide

`found: false` is documented as "not an error", and that should not change. The question is only
whether a **note** is added when the point lies outside the target viewport. `notes` already
exists in the reply and is already an array of strings, so nothing in the schema moves.

Worth checking while there: the same silence on a `selector` that matches nothing versus one
that matches a hidden element.
