---
title: "`blocked` and `panel` dropped by the scroll-report whitelist — fixed"
column: done
kind: bug
criterion: C4
owner: "obsrv-e7"
order: 29
---

SUPERSEDED BY THE C4 CARD — kept for the history, not for tracking. This card was opened when the finding looked like one bug; it grew into the five-then-seven-commit stack that the 'Field-level sweep' card now carries, and it went stale describing pre-merge state.

The fix itself: obsrv-e7 found and fixed it. Root cause was parseScrollReport in shared/ipcPayloads.ts — a whitelist, so a field added to the type, the preload and the control reply still arrived undefined until named there. It dropped `panel` too, which left the live surface silent on a locked page with no dialog role. Reviewed by obsrv-a6 (commit 02656b8) and the panel half independently reproduced on a separate fixture.

Merged in cdd7056 and pushed 2026-09-14. Live status and open questions are on the C4 card.
