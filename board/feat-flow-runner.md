---
title: "A step-runner drives a flow over one held session, not N independent drive calls"
column: done
owner: "Dogu"
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

## SHIPPED 2026-09-26

`#472` merged (`9fe0ed3`). `src/mcp/flowRunner.ts` (`runFlow`/`startFlow`) + `src/mcp/flowLock.ts`.
Idris PASS'd it at `33b8672` after two real review passes:

- **First push (`e01546c`) had three defects, found by two different methods.** Henry reading and
  running the code found two: steps after a failure were silently absent rather than marked
  `not-reached` (the report's front page can't state coverage from data that isn't there); and
  `releaseFlowLock` bare-unlinked instead of checking the pid was still its own. Idris, sabotaging
  the test suite itself before reading Henry's review, found a third and distinct one: the
  `finally`-release test never actually exercised a throw, since a step's own rejection is caught
  inside `runFlow` and never reaches it — closed with a case that does.
- **Second pass, non-blocking:** the settle probe (`captureRaster`, already producing `data` and
  `settled`) now runs on a failed step too, not only a succeeded one — the screen and the reason
  at the moment of failure distinguishes a timing problem from a settled-page defect, confirmed by
  Henry's own runtime harness and Idris's sabotage, 3-for-3.

CI (`36232431630`) genuinely green: 1 `✘` byte-counted, `panes.spec.ts:85` — read in full before
merging and confirmed unrelated to this feature (`page.press` timeout typing the URL bar, not
this card's canvas-blank recurrence; retry-rescued).

No MCP tool wiring — same scope boundary as `feat-flow-definition`. `feat-flow-report` can now
build against the runner's real output shape rather than a hand-written example.
