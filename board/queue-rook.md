---
title: "QUEUE — Rook: c2-retroactive routed · log-attribution in review · a1 on Opeyemi"
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

1. `c2-retroactive` — ROUTED, waiting on Rook's own user. Apply `docs/compatibility.md` to
   0.56.0–0.60.0. See that card for why Rook and for the three framings obsrv-91 left on it.
2. `bug-log-attribution` — IN REVIEW, branch `fix/log-attribution` @ 334164d, pushed and
   fetch-confirmed. Merge is Opeyemi's. Unblocks `bug-dev-app-exited`.

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

**Why this card keeps going stale, stated so the next rewrite is shorter:** a queue is a claim
about several other cards, and nothing regenerates it when they move. `npm run board` checks
that the VIEWS match the cards; it cannot check that a card's prose matches another card's
column. Every line above is therefore a hand-maintained duplicate of state that lives elsewhere,
and the honest fix is fewer lines here, not more frequent updates.
