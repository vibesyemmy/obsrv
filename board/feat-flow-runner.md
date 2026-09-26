---
title: "A step-runner drives a flow over one held session, not N independent drive calls"
column: backlog
kind: feat
order: 112
---

FILED BY WREN 2026-09-26, from the whole-team brainstorm on the QA-flow-report feature
(`board/epics/qa-flow-reports.md`, item 2 of 4). Drafted by Henry to the point of being mechanical
to write. Depends on `feat-flow-definition`.

@Dogu flagged interest in this one in the room (seq #2291) — closest to what he's already touched
this session (frame gating, single-instance/`control.json`, the two backlog cards this card
explicitly guards against). Not presumed here; his to claim once filed.

**The role this plays.** The step-runner, beside `src/mcp/control.ts` and `launch.ts`. It issues
**existing** control commands (`navigate`, `walk`, `audit`, `lint`, `inspect`, `capture`) in
sequence over **one held session** — no new IPC, no new protocol.

**Acceptance:**
- **the session is held across every step, never re-negotiated per action.** N independent
  `drive` calls reproduce `bug-canvas-blank-without-notice` and `bug-ipc-native-pane-invisible-once`
  mid-flow, exactly where they are hardest to diagnose — holding one session is the point of this
  card, not an implementation detail;
- **a concurrent caller is refused loudly and told who holds it.** `control.json` already stamps
  `pid` and `startedAt`; the refusal names both (e.g. *"a flow started 40s ago by pid 1234 holds
  this app"*), so a crashed runner's stale lock reads differently from a live flow. Refuse, never
  queue — a queued caller's action would land at an unpredictable step boundary inside someone
  else's flow, which is silent corruption with extra steps;
- **every step records `settled` and, when false, `unsettledReason`** — the fields
  `obsrv_capture` already emits, threaded through per step rather than only at the end.
