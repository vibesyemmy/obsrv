---
title: "`doing` cannot tell working from waiting, and the board has no word for it"
column: done
owner: "Henry"
kind: chore
order: 36
---

FILED 2026-09-16 by Henry. **The design is Rook's**, from having sat inside the ambiguity twice.

## RESOLVED 2026-09-16 by Henry, on Rook's design, with the case made by Opeyemi

**Why now:** Opeyemi read the published board's Doing column (six cards) and asked Wren whether
they were all done, because Henry and Rook looked idle. None were. Two had finished work in CI, two
waited on him, and two on Kenya, who was out. All six read *"Claimed. Someone is on it."*

**The three decisions the card left to its taker:**
- **Rendered, in both views.** Each Doing card shows *"waiting on …"* or *"moving"*. The heading
  counts the column: *"7 in Doing: 1 moving, waiting on event 3, Opeyemi 2, Kenya 1"*.
- **Required on Doing, as Rook argued.** `board:check` refuses a Doing card without `waiting:`,
  and `""` means moving. **And refused everywhere else**, which is Rook's own argument applied
  to the field. Off Doing nothing renders it, and *"an unrendered field is a record kept where
  nobody reads it"*. Rebasing this change produced exactly that **three times**: #48, #51 and
  #52 each closed a card this change had given a `waiting` line, and each rebase merged cleanly
  into a `done` card still saying what it waited on. The check refused all three: exit 1,
  *"waiting: belongs on a Doing card, and this one is "done""*.
- **No N.** There is no stalled-card threshold, as Rook argued; nothing here has evidence for one.

**One addition, from Wren's question.** Three of today's values wait on a person and two on an
event, and free text cannot answer "everything waiting on Opeyemi". Rather than a second,
structured field that can disagree with the sentence, the one field is shaped `who: what`, and the
check enforces the shape. The board counts by the part before the colon. The sentence still names
its subject; the subject is now also a key.

**Watched refusing,** on `main`'s cards as they stood: every Doing card lacked the field, and the
check exited 1 naming `b1-live-app`. With Wren's roster value *"Kenya, out until 13:30"* left in
unshaped, it exited 1 again: *"waiting: names who or what first"*. Fixed, exit 0. The HTML page's
own script was run against a stub DOM: seven Doing cards with a waiting line, none outside Doing.

**The values** came from Wren's roster at 11:29, reshaped, and were corrected at each rebase as
cards closed or changed hands. When this merges, three cards are in Doing: one waits on Kenya's
return, one on Rook's with the branch named, and one on an event, a recurrence nobody can force.
The board's own heading says the same: *"3 in Doing: 0 moving, waiting on event 1, Kenya 1, Rook
1"*. Owners correct their own lines.
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
its own subject. That is the same rule `CONTRIBUTING.md`'s *Writing it down* applies to every
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

## Rook's view on two of the three, offered as a view rather than a decision

**Required, not optional** — with an explicit empty value meaning *moving*.

> Optional reproduces the exact silence the card exists to remove: an absent field fits *nobody
> is waiting on anything* and *nobody filled it in* equally.

That is the card's own argument turned on the card's own design, which is the test it should
have to pass. `build-board.js` can enforce presence cheaply — the same shape as `board:check`
refusing a view that does not match its cards, and cheaper, because it is one key on one column.

**No N in the first version.**

> The honest first version is *no N* — render the field, require it, and let the first time
> somebody chases the wrong person supply the number.

This is the stronger of the two and it is worth reading twice. The obvious move is to pick a
threshold so the check is complete on day one. **Refusing to pick one is the finding**: a number
invented to make the check look finished is exactly what `thresholds.md` exists to prevent, and
the evidence for a real one arrives the first time the ambiguity costs somebody something. Ship
the field without the alarm; let the alarm's threshold be measured rather than declared.

The third question — whether `build-board.js` renders it — nobody has a view on yet, and it is
the one that decides whether any of this is worth doing. An unrendered field is a record kept
where nobody reads it.

## Not done deliberately

No field added and no generator change. The design is one message old and has been read by one
person other than its author.
