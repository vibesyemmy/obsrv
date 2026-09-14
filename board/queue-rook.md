---
title: "QUEUE — Rook: chore-guard now · flake-sync-165 next · a1 on Opeyemi"
column: next
kind: chore
owner: "Rook"
order: 2
---

UPDATED 2026-09-14 evening.

1. `chore-guard` — IN PROGRESS. Rook's own first preference; obsrv-91 released it rather than hold it against a maybe. Read the stale-lock section before building: that branch needs an observation, not a design.
2. `flake-sync-165` — QUEUED, on Opeyemi's word. Reshaped from a reproduction hunt into a margin measurement, because the flake was seen once and six runs were clean after; a hunt could end with nothing. The card now names the constants and the number to produce.
3. `a1` — BLOCKED on Opeyemi: the design, the Voicify-versus-Opeyemi identity, and the credentials. Its first step is the `chore/signing` rebase, inside the card. Rook has read that branch; it merges clean today, 447 commits on, zero conflicts.

Not Rook's unless asked: the three a4 follow-ups. Rook declined them unprompted as "mine by provenance, not by right", and `chore-uninstall-path` in particular is a decision about what Obsrv promises rather than a cleanup.

Updated 2026-09-14 evening, after the queue went stale within hours of being written — which is the failure mode this card is an instance of, not an exception to.

1. e2 — DELIVERED into Review, 717e924. See the e2 card.
2. a1 — BLOCKED, and not on the certificate any more. Rook has a design with Opeyemi and waits on his yes. Two things need his decision, not Rook's: the design itself, and the IDENTITY — the app would be signed as Voicify Limited, which is what Gatekeeper shows users, while `copyright` says Opeyemi Ajagbe and CI would hold Voicify's private key. The remaining mechanical step needs Opeyemi to type a p12 password, so it cannot be finished by any session alone.
   Already settled by measurement, so nobody re-opens it: the identity PAIRS. Public-key SHA-256 of the cert's -pubkey against each .key — obsrv-developer-id.key matches the Developer ID leaf at 53c1b7ae; the 21:34 pair is a different keypair at 1cd2c04d. And the G2 CA is a PUBLIC intermediate, not account-gated — Henry relayed the opposite to Opeyemi and has corrected it.
3. bug-orientation-name — unstarted, and the next one to pick up when a1 is unblocked or if Rook wants work in the gap.
