---
title: "QUEUE — Rook: e2 DONE · a1 blocked on Opeyemi · bug-orientation-name next"
column: next
kind: chore
owner: "Rook"
order: 2
---

Updated 2026-09-14 evening, after the queue went stale within hours of being written — which is the failure mode this card is an instance of, not an exception to.

1. e2 — DELIVERED into Review, 717e924. See the e2 card.
2. a1 — BLOCKED, and not on the certificate any more. Rook has a design with Opeyemi and waits on his yes. Two things need his decision, not Rook's: the design itself, and the IDENTITY — the app would be signed as Voicify Limited, which is what Gatekeeper shows users, while `copyright` says Opeyemi Ajagbe and CI would hold Voicify's private key. The remaining mechanical step needs Opeyemi to type a p12 password, so it cannot be finished by any session alone.
   Already settled by measurement, so nobody re-opens it: the identity PAIRS. Public-key SHA-256 of the cert's -pubkey against each .key — obsrv-developer-id.key matches the Developer ID leaf at 53c1b7ae; the 21:34 pair is a different keypair at 1cd2c04d. And the G2 CA is a PUBLIC intermediate, not account-gated — Henry relayed the opposite to Opeyemi and has corrected it.
3. bug-orientation-name — unstarted, and the next one to pick up when a1 is unblocked or if Rook wants work in the gap.
