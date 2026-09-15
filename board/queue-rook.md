---
title: "QUEUE — Rook: run 18 started · a1 on Opeyemi · c2-retroactive done"
column: next
kind: chore
owner: "Rook"
order: 2
---

REWRITTEN 2026-09-15 against measured state, not recollection. The previous version had
`chore-guard` IN PROGRESS and `flake-sync-165` QUEUED; both have been done for hours, and the
card carried two stacked "UPDATED" sections contradicting each other. It also contained its own
epitaph — *"the queue went stale within hours of being written"* — which was true again.

**NOW**

1. `b1-report-diff` — **STARTED** on Opeyemi's go-ahead, 2026-09-15. Run 18: exercise
   `obsrv_report` and `obsrv_diff`, which run 17 excluded explicitly. Rook asked for this one
   and the reason is on the card — it is B1's only *documented* gap rather than a merely
   unexamined one, and Rook's coldness on these two surfaces expires the moment it runs them.
2. `c2-retroactive` — **DONE**, merged `c27f06d`. Found three gaps in the policy rather than
   confirming it, because the author did not review it.
2. `bug-log-attribution` — **MERGED** `6f19f9b` on Opeyemi's word, card done. It carried
   `70209df` too, Rook's catch of a contradiction Henry introduced on
   `bug-suite-absent-on-conflict`. `bug-dev-app-exited` is unblocked by it and is unowned;
   Rook flagged in advance that taking it would mean reading output produced by its own
   change, and asked to be held to being slower to believe it.

**BLOCKED, and not on anything Rook can do**

3. `a1` — needs Opeyemi at a keyboard: the p12 password cannot be typed by any session, and the
   Voicify-versus-Opeyemi identity is his decision, not an engineering one. Already settled by
   measurement so nobody re-opens it: the keypair PAIRS (public-key SHA-256, `53c1b7ae`), and
   the G2 intermediate is a PUBLIC download, not account-gated — Henry relayed the opposite and
   has corrected it. `chore/signing` still merges clean.

**NEXT IF THERE IS A GAP**

4. `bug-orientation-name` — unstarted.

**Not Rook's unless asked:** the three a4 follow-ups. Rook declined them unprompted as *"mine by
provenance, not by right"*, and `chore-uninstall-path` is a decision about what Obsrv promises
rather than a cleanup.

**Merge state, measured rather than remembered, because Rook has been carrying a stale count.**
Rook reported four branches with Opeyemi. Two of those are already merged: `fix/suite-absence-loud`
landed at `7feb26b` and the card closed at `f57924b`, and the contrast work landed at `d66d047`
and `7d57872`. The only unmerged branches in the repository are `fix/log-attribution`,
`chore/signing`, and the stale tail of `fix/suite-absence-loud` — whose one leftover commit was
Opeyemi's own, pushed after the merge, and has now been ported to main by hand.

**And that hand-port leaves a trap, corrected here within minutes of writing the opposite.** I
first wrote that `chore/signing` was the only unmerged branch left after `6f19f9b`. It is not.
`fix/suite-absence-loud` still reports UNMERGED and always will, because I copied `4bd6ba1`'s
text onto main instead of merging the commit — so the content is on main and the commit is not
an ancestor of it. Git cannot tell those apart and will keep flagging the branch, which is an
invitation for the next person to re-investigate a thing already resolved. Two unmerged
branches, then: `chore/signing`, which is real and blocked on Opeyemi, and
`fix/suite-absence-loud`, which is a ghost and should be deleted or merged empty so it stops
asking. That is Opeyemi's call, not a session's.

**RESOLVED 2026-09-15: Opeyemi said delete, and it is deleted**, remote and local. Checked
before deleting rather than after, because a deletion cannot be checked afterwards: exactly one
commit became unreachable, `4bd6ba130a8046b04f9e2993da8b07d4b6629a02`, and the only line that
existed on it and not on main was the superseded false one — *"Both branches and the PR are
gone"* — which Rook had already corrected in `70209df`. Its real content, the `KEPT ON PURPOSE`
paragraph, is on main verbatim. No worktree held the branch.

The full sha is written above so the commit stays recoverable from GitHub for as long as it
keeps unreachable objects, which is the only reason a sha belongs in prose. **`chore/signing` is
now genuinely the only unmerged branch in the repository** — a sentence I wrote once before it
was true.

**Why this card keeps going stale, stated so the next rewrite is shorter:** a queue is a claim
about several other cards, and nothing regenerates it when they move. `npm run board` checks
that the VIEWS match the cards; it cannot check that a card's prose matches another card's
column. Every line above is therefore a hand-maintained duplicate of state that lives elsewhere,
and the honest fix is fewer lines here, not more frequent updates.

**It went stale again inside the hour, and the instance is worth more than the correction.**
The paragraph below was written at 09:0x saying a queue card is a hand-maintained duplicate of
state that lives elsewhere. `bug-log-attribution` merged at 09:5x and this card immediately
said IN REVIEW, at a commit (`334164d`) that was no longer even the branch tip — Rook had
pushed `70209df` after reporting. Two separate staleness defects in one line, in the card whose
subject is that line going stale, written by the person who had just written that it would.

Nothing here is a reason to update more often. It is a reason for this card to be shorter: the
only lines above that cannot be read off another card are the routing decisions and the "not
Rook's unless asked" list. Everything else is a copy, and `npm run board` cannot check a copy.
