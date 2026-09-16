---
title: "Seven cards cite `docs/read-the-output-not-the-code`, which is not in the repo"
column: next
kind: bug
order: 42
---

FOUND BY ROOK 2026-09-16, checking every file path one card names against `origin/main`.
**Unowned.** Not filed by anyone earlier because nobody had followed the citation.

## The defect

**`docs/read-the-output-not-the-code` does not exist.** Not in `docs/`, not anywhere in the tree,
on `main` or on any pushed branch. Seven cards cite it as a repo document:

    b1.md
    b1-live-app.md
    b1-report-diff.md
    bug-diff-disowns-its-numbers.md
    bug-log-attribution.md
    bug-product-matches-own-prose.md
    bug-report-doubled-warning-prefix.md

Most spell it as a path — *"`docs/read-the-output-not-the-code` says the warnings ARE the
product"* — which reads as a file a person can open. One (`bug-log-attribution`) writes it as
`[[read-the-output-not-the-code]]`, a memory-style wikilink, which is the likelier origin: **an
agent's private memory note, promoted to a repo citation by being written down in a card, and
then copied card to card by readers who reasonably assumed the earlier card had checked.**

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
