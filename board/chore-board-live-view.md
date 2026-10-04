---
title: "the board is read over file:// and goes stale silently, so reading it means remembering to rebuild it"
column: done
kind: chore
owner: "Henry"
order: 124
---

ASKED BY OPEYEMI 2026-10-03, in his own words: *"Let's make the board update in realtime so I dont have to
refresh it to see the cards updated"*, with a `file://` link to a generated copy in another session's
scratchpad.

## What was actually wrong, which is worse than the inconvenience

**A `file://` page cannot tell you it is stale.** Chrome refuses it a fetch of its own siblings, so a page
opened that way has no way to notice that main moved; the only thing it can do is reload itself blind on a
timer, losing the reader's scroll and closing an open card every few seconds. **So the stale board and the
current board look identical** — the same failure this board was moved into the repo to escape, arriving
through the viewer instead of through the cards.

Worse, the copy he was reading sat in **another session's scratchpad**, so it was current only as long as
that session happened to rebuild it.

## Decided with him before building, in two questions

1. **Transport:** localhost with an instant push, over keeping the `file://` URL working. He chose the push
   knowing his bookmark changes.
2. **Source:** `origin/main`'s cards, polled — not the working tree's. A card moves for everyone when a PR
   merges, and a board built from one checkout's files shows that checkout's opinion. **Local edits are
   deliberately invisible**: this page answers *where is the work*, not *what am I editing*.

## What was built

`scripts/board-serve.js` (`npm run board:serve`), and three small flags on `build-board.js` it needed:

- **`--cards <dir>`**, so a build can read **another commit's** cards — materialised with `git archive` into
  a temp dir — rather than the working tree's.
- **`--md <path>`**, so serving does not write over the working tree's own generated copies. The summary line
  now names the files it actually wrote; it used to say `docs/board.md` whatever `--html` pointed at.
- **`--json <path>`**, the same data the page embeds, so the server can hand a client new cards without the
  client re-parsing a page.

**The page repaints instead of reloading.** The render was a top-level run; it is now `paint(DATA)`, called
once and exposed as `window.__boardPaint`. The server injects a ~20-line client that subscribes to `/events`
and repaints from `/data.json` on a new sha. **The live client is added by the server and never baked into
the committed page** — a `file://` copy carrying an `EventSource` would fail on open, and a test asserts the
plain build has none.

**Measured in the real browser, not argued:** scroll held at 300 px across a repaint, 4 columns (not 8, so
the clear works), 169 cards redrawn, card dialogs still opening afterwards, no console errors.

## Failure is not allowed to look like a quiet week

A broken fetch, a throwing rebuild or a dead poller all leave the last good cards on screen, which is
indistinguishable from nothing having changed. **The page carries the state of its own feed** and says when
it last managed to read main; a disconnected `EventSource` says so too, rather than going quiet.

`tests/unit/boardServe.test.ts` drives the real thing against a real bare remote and a real clone — not a
stubbed `git` — because a stub of `git archive` would assert my belief that it reads commits instead of
testing it. **The clone's working tree is given a card the commit does not have**, as the control.

**Both controls were sabotage-checked rather than trusted:** replacing the commit read with a `cp` of the
working tree fails two of the four tests, including that one.

## What this does not do

It does not serve the board to anyone but the person running it (bound to `127.0.0.1`), it does not show
unmerged local edits, and it does not make the committed `docs/board.html` self-updating — that file is
still a snapshot and still says so.

## MERGED 2026-10-04 as `054beffc2`

`#549` landed on `main` after **eight heads**: every one of the six after the first was a defect one of the
gates found, and all but one were in code I had written to fix the previous finding.

**What the gates caught that my own tests did not**, because the pattern is the point: a startup hang I had
**moved** rather than removed (the synchronous `ls-remote` sat behind a condition my tests never took); an
option-shaped `--ref` that my fix **re-opened** by deleting the `ls-remote` that had been blocking it by
accident; a refspec (`origin/main:refs/heads/zz`) that walked past the `--` I had just added, because `--`
stops an option and a colon is not one; and a repaint race that could paint an older board while the feed
line named the newer sha.

**I keep testing the mechanism I just built rather than the behaviour a caller can reach**, and `--ref` is a
string a caller controls end to end. Three heads in a row were fixed by someone else's red test.

**Measured at the merged head:** CI run `37197856918`, 446771 bytes, 0 `✘`, 0 `error TS`, 0 retries.

**The follow-up this card does not carry:** `scrollHostScriptScoping`'s 10 s `afterAll` default, which went
red in 2 of my 5 full local runs while this PR's suite ran beside it. Not my file, deliberately not touched
here (any change would have moved the head and voided both PASSes), and owed a one-line timeout by whoever
owns it.
