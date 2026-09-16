---
title: "`doing` cannot tell working from waiting, and the board has no word for it"
column: next
kind: chore
order: 36
---

FILED 2026-09-16 by Henry. **The design is Rook's**, from having sat inside the ambiguity twice.
Rook offered to file it and declined to, because it does not take work without asking Opeyemi
first and has three questions queued already. Filing a card is not taking the work; taking it is
still open to anyone.

## The gap, with the evidence that produced it

**A card in `doing` with no visible movement reads as stalled to anyone who was not in the
conversation.** It cannot be distinguished from a card whose owner is waiting on a person.

Measured, twice in one hour on 2026-09-16:

- `b1-live-app` sat in `doing`, owner Rook, nothing delivered. Henry read it as abandoned and
  released it. Rook had presented the design to Opeyemi and stopped **because this card says the
  run drives the window on his desk and timing is his** — an instruction Henry wrote onto that
  card himself, then misread being followed.
- `ci/board-only-skip` was pushed with no pull request. Henry called it orphaned in two room
  posts. Rook had not opened one because opening waits on Opeyemi's word, the same rule it
  applies to every merge.

Rook has hit the same ambiguity from the inside twice — run 19 waiting on timing, `chore/signing`
waiting on a p12 password. **Every session on this board currently has at least one card parked
on Opeyemi's word, and the board says nothing about any of it**, so the only way to know is to
ask the session. That is precisely the routing this board exists to remove.

## The design, and why it is a field rather than a column

**Do not split `doing`. Add a frontmatter field.**

    waiting: "Opeyemi — timing for a run on his desktop"

Rook's argument, which is the one that decides it: **a second column says "waiting" and still
leaves the reader asking *on what, from whom* — and that is the question that determines whether
the work is in hand or free.** A column is a state that has to be interpreted; a sentence names
its own subject. That is the same rule `docs/read-the-output-not-the-code` applies to every
warning Obsrv emits, turned on the board that tracks them.

It costs nothing to read `doing` with an empty `waiting` as *moving*.

## The check it enables, which is the point rather than a bonus

- `doing` + **empty** `waiting` + no commit in N hours → **ask the owner.** This is the card that
  might be stalled.
- `doing` + **filled** `waiting` → leave the owner alone, and **chase the named person instead.**

That second line is the whole value. Today, a card parked on Opeyemi looks exactly like a card
parked on nobody, so the chase goes to the wrong person — or, as happened twice today, to nobody
and then to a release that had to be reversed.

## What a taker has to decide, because this is not purely additive

- **Does `scripts/build-board.js` render it?** The frontmatter parser is deliberately forgiving,
  so an unknown key will not break `board:check` — but an unrendered field is a record kept where
  nobody reads it, which is this week's recurring defect. It should appear on the card and in the
  Kanban view or it is not worth adding.
- **Is it required when `column: doing`?** Making it required turns "I forgot" into a refused
  push; leaving it optional means an empty `waiting` is ambiguous between *moving* and *nobody
  filled it in*. That is a two-facts silence and it needs deciding on purpose rather than by
  default.
- **What is N?** The stalled-card threshold is a number nobody has evidence for. `thresholds.md`
  is where a number like that has to justify itself, and inventing one to make today's board look
  tidy is exactly what that file exists to prevent.

## Not done deliberately

No field added and no generator change. The design is one message old and has been read by one
person other than its author.
