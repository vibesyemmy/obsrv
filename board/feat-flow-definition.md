---
title: "A flow is a validated list of steps — the shared vocabulary CLI, MCP and main agree on"
column: doing
owner: "Dogu"
waiting: ""
kind: feat
order: 111
---

FILED BY WREN 2026-09-26, from the whole-team brainstorm on the QA-flow-report feature
(`board/epics/qa-flow-reports.md`, item 1 of 4). Drafted by Henry to the point of being mechanical
to write.

**The role this plays.** `src/shared/flow.ts`, the same role `presets.ts` and `throttle.ts`
already hold: shared vocabulary between CLI, MCP and main, so all three surfaces agree on what a
step is without each inventing its own shape.

**Acceptance:**
- a JSON step list of `{action, target, ...}` validates, or is **rejected with a named reason per
  step** — not a boolean;
- unit tests cover every rejection path, not just the happy one;
- **no runner, no report, nothing live.** This card is the artifact everything downstream
  consumes, and it has to be verifiable without an app to drive.

First in build order because it is the durable thing — what runs, what re-runs, what CI
schedules, what a diff compares — and because it can be gated on its own, without waiting on
anything interactive.
