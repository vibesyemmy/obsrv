---
title: "Eight cards cited `docs/read-the-output-not-the-code`, which was never in the repo"
column: done
owner: "Henry"
kind: bug
order: 42
---

FOUND BY ROOK 2026-09-16, checking every file path one card names against `origin/main`.
Taken by Henry, whose memory note it was.

## RESOLVED 2026-09-16 by Henry — one ghost document, and where it came from

**Origin, established rather than inferred.** `read-the-output-not-the-code` is a note in the
session memory Henry works from, not a file in any ref. It reached the board twice: as a wikilink
on 2026-09-14 (`a1c9050`, in `bug-log-attribution`), then as the path
`docs/read-the-output-not-the-code` on 09-15 (`ebfb041`, Henry's "B1 goes to Rook"). **The path
form is the one that was copied**, onto six more cards. The three claims cards cite it for (the
warnings are the product, a sentence names its own subject, a peer reads it cold) are that note's
three lines. The third was never in the tree, which is why `CONTRIBUTING.md` lacked it.

**The sweep, which is the deliverable:** every backticked span and `[[wikilink]]` in all 76 cards
on `main`, 147 distinct path-like candidates, classified against the tree and its history.
**Three controls, all passed:** `tests/e2e/cli-snap-tiled.spec.ts` and `src/cli/main.ts` must come
back present; `docs/read-the-output-not-the-code` must come back a ghost. A first run failed its
present-control because the path chosen was only ever cited outside backticks, so that run was
void. That is recorded here so the next sweep picks a control it has seen extracted.

| class | count |
| --- | --- |
| present in the tree (by path, basename or suffix) | 85 |
| branch names, git and action refs, patterns, outside the tree | 49 |
| runtime or CI files not meant to be in the tree (`control.json`, `error-context.md`, …) | 6 |
| not paths (`/`, `completed/success`) | 2 |
| existed once: `docs/board.md` / `.html` (generated, uncommitted since #13), `docs/signing.md` (on `chore/signing`) | 3 |
| **ghost: never in any ref** | **2** — one document, with and without `.md` |

**The heuristic called seven things ghosts; reading moved five.** Four were branch names with a
`docs/` prefix (*"Branch `docs/c3-skill-audit`"*), and `server/mcp.js` is the SDK's file under
`node_modules`. They are counted in the second row. The one real ghost appears in path form on 8
cards and as a wikilink on 2. Two of those cards are the ones *about* it: this card, and Rook's
correction note on `bug-product-matches-own-prose`.

**One finding of a different kind:** `c3` and `c5-elevated` give *"THE BRANCH IS THE ADDRESS"*, and
both branches were merged and deleted. Their merges are now named on those cards.

**Fixed:** the ghost citation in `b1`, `b1-live-app`, `b1-report-diff`, `bug-diff-disowns-its-numbers`,
`bug-report-doubled-warning-prefix` and `chore-waiting-field` (path form), and `bug-log-attribution`
(wikilink), all now pointing at `CONTRIBUTING.md`'s *Writing it down*. That section gains the rule
that was only in the note — *have someone who did not write it read it cold* — and *cite the tree,
or quote the claim*. `bug-dev-app-exited`'s `[[bug-log-attribution]]` became a plain card name.

**Outside the cards, found by Rook's review.** This sweep read `board/` only. Rook's, run over more
of the tree, found `CONTRIBUTING.md` linking [`docs/dev-lane`](docs) — the same shape, never a
file in any ref (the branch was `feat/dev-lane`). The lane is documented in `README.md`'s *The dev
lane*, and the link now says so. So "the only ghost" above holds for the cards, not for the repo.
Rook also named `docs/b4-noise-ratio` and `docs/c3-skill-audit`. Those are the branch names already
counted above: a path check finds no commits for a branch, which is how they look like ghosts.

**Left alone, deliberately:** `bug-product-matches-own-prose` already carries Rook's correction
note from #37, and is in Doing on an unpushed branch. Its two remaining bare mentions are his to
reword with that work, not a conflict to hand him.

**Not done: the check in `board:check`.** Two of the classes above were settled by reading, not by
rule: `docs/` branch names, and SDK paths. A gate built on today's heuristic would go red on a
branch name. It wants those classes pinned first, and is worth its own card if anyone wants it.

---

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
