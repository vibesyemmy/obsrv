---
title: "The flow report is per-step and honest about coverage, not one page pretending to be eight"
column: backlog
kind: feat
order: 113
---

FILED BY WREN 2026-09-26, from the whole-team brainstorm on the QA-flow-report feature
(`board/epics/qa-flow-reports.md`, item 3 of 4). Drafted by Henry to the point of being mechanical
to write. Depends on `feat-flow-runner`.

**The role this plays.** A new section type in `src/cli/reportHtml.ts`, which already renders
grouped findings with numbered pins and crops. **A sibling surface** — a new `obsrv_flow` tool —
**not** a change to `obsrv_report`: that tool is headless by design, on purpose, and a flow is
inherently live. Reversing that decision is out of scope here.

**Acceptance:**
- **the front page leads with what was not covered, before the findings.** A QA engineer's
  costliest mistake is trusting a clean report that never reached step 4;
- each step shows step / expected / actual / evidence — scannable in ten seconds, with the
  resolved action, network call and DOM state one click down for reproduction;
- **Obsrv's own passive findings (visual/accessibility) are visually separated from the QA
  engineer's stated expected observations**, and for the latter Obsrv reports what it saw —
  present/absent — without pronouncing pass or fail. Same "report, don't decide" line the audit
  and lint groups already hold;
- **a step measured on an unsettled frame renders as a third state, `unknown`** — not folded into
  clean or dirty, and with real visual weight on the page itself, not just a field in the JSON a
  fast reader will skim past as a pass;
- per-step coverage extends `src/shared/walkCoverage.ts` rather than starting a new mechanism.

**Known, stated limitation rather than a silent gap:** per-step full-page overviews will hit the
4096px capture cap once per step — the existing limit on report pins. Ships with this named on
the card and, if it lands as a real limitation, in the report itself. Per-region capture is a
future card if it ever actually blocks someone, not built speculatively ahead of that.
