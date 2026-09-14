---
title: "`settled` degrades to the old meaning on an older app, without saying so"
column: done
kind: bug
criterion: C4
owner: "obsrv-91"
---

CLOSED 2026-09-14 — already fixed before this card was written, and the card was the one thing that was stale. obsrv-a6 raised it in review of obsrv-91's stack and obsrv-91 fixed it before merging: commit c8b7f15, merged in cdd7056, CI green at 1d4e505.

VERIFIED rather than taken on the peer's word: `git merge-base --is-ancestor c8b7f15 origin/main` → yes, and origin/main:src/mcp/server.ts ~1012 carries the warning, pushed into the same array as capture.warnings, saying the app is older than the capture's settle verdict, that `settled` therefore reports whether the navigation was confirmed rather than whether the page went paint-quiet, and to update the app for the other answer.

Closed rather than assigned deliberately: anyone taking it reads the code, finds the warning already there, and loses twenty minutes deciding whether they are looking at the right line. A card describing a fixed bug costs more than no card.

Original diagnosis below, which was exactly right.

`liveSnap` answered `settled: capture.settled ?? confirmed`. The fallback is RIGHT; the objection was that it was silent — one name meaning two things across app VERSIONS, in the commit whose whole point was removing that across surfaces.
