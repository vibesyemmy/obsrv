---
title: "A flow is a validated list of steps — the shared vocabulary CLI, MCP and main agree on"
column: done
owner: "Dogu"
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

## SHIPPED 2026-09-26

`#470` merged (`59f2e0c`). `src/shared/flow.ts`, `validateFlow` reusing `CONTROL_COMMANDS` as the
action vocabulary. Idris PASS'd it at `b4f0e82` after a real detour: the first push had a
key-presence discriminator (`'reason' in result`) that misclassified a valid step as a rejection
whenever its own passthrough data happened to include a `reason` key — found independently by
Henry and Idris, fixed by tagging on `ok` instead (`{ok:true, step} | {ok:false, rejection}`,
keys the function owns and the caller's data can never collide with), then hardened with a test
for the discriminator's own keys (`ok`/`step`/`rejection`) so the guard protects the fix's actual
invariant rather than just the two symptoms that broke the old one.

Unblocks `feat-flow-runner` (queued, moving to `doing`) and, per Henry's note in-room, lets
`feat-flow-report` start against the validated shape alone, ahead of the runner landing.
