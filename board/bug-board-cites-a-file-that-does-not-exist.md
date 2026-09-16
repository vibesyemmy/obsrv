---
title: "Seven cards cite `docs/read-the-output-not-the-code`, which is not in the repo"
column: doing
owner: "Henry"
kind: bug
order: 42
---

FOUND BY ROOK 2026-09-16, checking every file path one card names against `origin/main`.
**Unowned.** Not filed by anyone earlier because nobody had followed the citation.

## The defect

**`docs/read-the-output-not-the-code` does not exist.** Not in `docs/`, not anywhere in the tree,
on `main` or on any pushed branch. **Eight cards cite it**, seven as a repo path:

    b1.md
    b1-live-app.md
    b1-report-diff.md
    bug-diff-disowns-its-numbers.md
    bug-product-matches-own-prose.md
    bug-report-doubled-warning-prefix.md
    chore-waiting-field.md

and one, `bug-log-attribution.md`, as `[[read-the-output-not-the-code]]` — a memory-style
wikilink, and the likelier origin: **an agent's private memory note, promoted to a repo citation
by being written into a card, then copied card to card by readers who reasonably assumed the
earlier card had checked.** Henry has since confirmed that origin from the commit history: the
oldest card carrying the path is `ebfb041`, his own routing commit, and the note is in his
session's memory.

> **Count corrected 2026-09-16, and the correction is the card's own subject.** The first version
> said *seven*, listed `bug-log-attribution` among the path-citers where it does not belong, and
> **omitted `chore-waiting-field` entirely** — which Henry found by sweeping with controls. The
> eight-file list was on my screen when I wrote the seven-file one: I transcribed it and dropped
> the last line.
>
> **What made it stick was a second check that agreed for a different reason.** I then counted
> with a narrower pattern — the `docs/` path form only — which returned **7**, because it excluded
> `bug-log-attribution`'s wikilink while including the `chore-waiting-field` I had just dropped.
> Two different errors, one of transcription and one of scope, producing the same number. **A
> confirming count is not a check when it counts a different set**, and the agreement is what
> stopped me looking.

## Why it is worth a card rather than a find-and-replace

**The principle is real and has a home.** `CONTRIBUTING.md`, under *Writing it down*: *"Obsrv's
output is sentences, and the sentences are the product"*, followed by *a sentence must name its
own subject* and *name the two facts a silence would be produced by*. `compatibility.md` carries
the caller-facing half — wording may change in a minor, match on structured fields, never on
prose. So every argument built on the citation still stands; **only the address is wrong.**

**But it is the board's most-cited authority, and it cannot be read.** Anyone following it —
a new session, or anyone deciding how much weight the argument carries — finds nothing, and has
to either take the citing card's word or go looking. That is exactly the position this board
keeps discovering is expensive.

**And it is the house defect wearing a citation.** A sentence pointing at a subject that does not
exist — quoted approvingly, in cards *about* sentences pointing at subjects that do not exist.
`b1-live-app` cites it to argue that the way to check a sentence is to have a peer read it cold;
nobody read this one.

## What a fix has to decide

Not mechanical, which is why this is a card and not a chore:

- **Point them at `CONTRIBUTING.md#writing-it-down`**, the cheapest fix, and accept that a
  section anchor is a weaker citation than a file.
- **Create `docs/read-the-output-not-the-code.md`** so the seven citations become true, if the
  principle has grown past what `CONTRIBUTING.md` holds — it is cited for at least three distinct
  claims (warnings are the product, sentences name their own subject, have a peer read it cold)
  and only the first two are in that section.
- **Whether other phantom paths exist.** This one was found by checking the paths in *one* card.
  Nobody has checked the rest of the board, and the same sweep that found it would find others.
  **That sweep is the actual deliverable**, and a fix that corrects seven citations without
  running it has closed one instance of an unmeasured class.

## The check that would have caught it, and costs seconds

Every `` `path/like/this` `` in `board/*.md` tested with `git cat-file -e origin/main:<path>`.
It needs a control — a card citing a path known to exist must come back present, or an all-clear
means the extractor matched nothing. Candidate for `board:check`, which today verifies the views
match the cards and says nothing about whether a card's claims are true.
