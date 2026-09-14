---
title: "FIXED: the coverage note measures whether the page grew instead of guessing"
column: done
kind: bug
criterion: C4
owner: "Henry"
order: 30
---

Merged 219223e, pushed 2026-09-14. Suite: 516 passed, 3 failed (the documented Retina trio, which fail on this laptop and pass on CI), 0 flaky. Unit 1251.

THE ORIGINAL CARD'S FIX WAS WRONG and was abandoned before building. It said: headless hedges, live is right, make headless match live. Henry built the missing counter-example first — a STATIC page behind an open dialog — and live announced 'the page grew as it was walked' directly beneath its own note saying 'the page never moved'. So:

  app-shell-grows    headless said held; the feed had grown
  dialog-over-tall   live said grew; the page was static

Each surface was right on the page its author had tested and wrong on the other. Matching one to the other would have replaced a hedge with a false statement.

THE REAL DEFECT was one level down: `held` inferred from `documentLocked`, a question nothing measured. THE FIX: the walk records the page's height at its first step; the note compares it with the height measured afterwards. Grew, or did not. The disjunction is gone from both surfaces rather than re-pointed.

A wrong turn worth keeping: the first version compared the walk's FIRST step against its LAST, which reads 'did not grow' on grows-as-walked.html — a fixture named for growing — because it extends after the walk's last step. Caught because a fixture whose name predicts its answer gave the opposite one.

When nobody measured (older app, no step taken) the sentence keeps its old hedge, with a unit test pinning that branch. A disjunction is the honest shape of an answer nobody took; the fault was stating a guess as fact.

Rode the same chain the blocked/panel fix mapped out: scrollHost, preload, ScrollReport, controlServer, and the ipcPayloads whitelist that silently drops unnamed fields — which has now caught three sessions in one day.

tests/fixtures/dialog-over-tall.html is committed beside app-shell-grows.html. Either alone argues convincingly for the wrong fix; only the pair makes it measurable.
