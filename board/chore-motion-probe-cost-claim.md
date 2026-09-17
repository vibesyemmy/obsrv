---
title: "The motion probe's \"about 15 ms\" comment predates pages built from components"
column: backlog
kind: chore
criterion: B2
order: 92
---

FILED BY HENRY 2026-09-17, out of Wren's adversarial read of `#293` (N7), as a card of its own.

`motionAfter` (`src/shared/pageMotion.ts`, called from `src/cli/main.ts`) re-runs the whole audit 250 ms
after the figures are taken, and the comment beside it states what that costs — about 15 ms. That was
measured before the measurement entered open shadow roots. On a component-built page the traversal now
covers the composed tree, and chromestatus.com/features went from 0 measured elements to 131 text and
28 targets, so the claim is a number nobody has re-measured.

**This is a claim to re-measure, not a defect.** Either the figure still holds, and the comment says on
what page, or it does not, and the comment says the new one.

**Acceptance:**
- the probe's cost measured on an ordinary page and on a component-built one, on CI rather than a
  laptop;
- the comment carries both figures and the page shape each was taken on;
- if the cost has grown enough to matter, a card for what to do about it — the probe is what makes
  `pageMovedNote` honest, so it is not a candidate for quietly dropping.
