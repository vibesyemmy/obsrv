---
title: "Two peer sessions cannot read the board at all"
column: done
kind: bug
owner: "Henry"
order: 26
---

CLOSED 2026-09-14 — dissolved by moving the board into the repo, not fixed. Nothing was granted to anyone.

The diagnosis below stands and is worth keeping, because the wrong half of it is instructive: this was recorded as a sharing permission for hours, and the measurement that settled it showed three accounts rather than one account with a gap — so there was no addressee to share with and the permission fix never existed.

`board/` is writable by everyone who can open a pull request, which is all four of us. Claiming a card is editing its file. The read half had already been solved by the generated file being public.

Raised 2026-09-14. Rook (room #21) and Kenya (#23, and direct) both get the same refusal reading the artifact's `tasks` collection:

    no such artifact, collection, or document (or no access — the two are deliberately indistinguishable)

Three times each, independently. Two sessions blocked identically is one permission, not two coincidences.

NARROWED 2026-09-14 after the push of 403717b. This was recorded as ONE problem and is TWO, and the read half already had an answer sitting in the repo: `git pull && cat docs/board.md` works for every session, because the generated board is a public file and the artifact is not the only copy. Henry spent hours treating the artifact as the only board while the workaround was the very file he had built for exactly this. So the live cost is WRITES ONLY.

That also changes what the fix has to be. If reads are served by the repo and writes are not, then the question is not `how do we share the artifact` but `what is the write path for a session that cannot reach it` — and one answer is that there may not need to be one, if claiming a card can happen through the same public file by pull request. That is a different design from sharing an org-internal artifact more widely, and it should be chosen rather than defaulted into.

WHAT IT COSTS RIGHT NOW: neither can claim a card, set an owner, or move anything to Review. Every board move today has gone through Henry by hand, which means the board is accurate only while one session is awake to update it, and a card sits `unclaimed` while someone is actively working it. That is exactly the quiet staleness docs/board.md was built to guard against, arriving through the door nobody watched.

Both refused to hand-edit docs/board.md instead, which was right — scripts/build-board.js says in its own header that the snapshot exists to be regenerated rather than edited back into agreement, and a generated file saying `Kenya, Doing` while the artifact says `unclaimed` is the defect the file exists to prevent.

The message is deliberately ambiguous between `does not exist` and `you cannot see it`, so the refusal itself cannot tell us which. Needs Opeyemi: check who the artifact is shared with. If org-internal sharing cannot reach these sessions at all, then the artifact is not usable as a multi-session board and docs/board.md is not a snapshot of the real board but the only board — which is a different design and should be decided rather than drifted into.
