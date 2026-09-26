# Epic: a QA engineer drives a flow through Obsrv and gets a findings report

Not read by `build-board.js` or `board:check` — this directory is deliberately outside their
reach (flat, non-recursive `readdirSync` on `board/`), so nothing here can drift against a card
the way a stored parent status could. This file names the cards it split into, one-way. Cards
stay silent about this epic, so there is no pair of references that can disagree. If this file
goes stale, it reads as an unmaintained plan — never as the board itself being wrong.

## The ask

Opeyemi: a QA engineer should be able to drive a user flow through Obsrv and get back a report
of what was found — what a QA engineer would find useful, and what that report should contain.
Brainstormed with the whole team in the room (seq #2268 onward) before any card was written.

## What the team agreed, condensed

**The foundational asset already exists.** The most common real QA finding — "I clicked the
thing and ended up somewhere I didn't expect" — is exactly what `targetSource.ts`'s
`mirrorRequested`/`byDocument` distinction already answers: a navigation asked for, vs. one the
page performed on its own. A flow report states this per step for free.

**Report the observation, never the verdict.** Same "report, don't decide" line the audit and
lint groups already hold. Obsrv can assert visual/accessibility findings on its own authority.
Functional correctness needs the QA engineer's stated expectation per step, and Obsrv reports
what it saw against that — present/absent — without pronouncing pass or fail. The two classes
render separated and labelled, never merged into one list.

**A step's findings are only as trustworthy as its settle decision.** Every step carries
`settled` and, when false, `unsettledReason` (fields `obsrv_capture` already emits). Two states
can't express "measured on a frame that hadn't finished painting yet" — that's a third state,
`unknown`, and it must have real visual weight on the report itself, not just a buried field, or
a fast reader will count it as a pass.

**A composed report inherits every silence of what it composes — this codebase has already
shipped that bug once** (a headless capture that couldn't reach an app shell said nothing at all
for several versions). Multiply across eight flow steps and the aggregate looks *more*
authoritative than any single step. Each step needs a coverage ledger — what was actually
examined — kept separate from the findings list, and the report's front page leads with what
was **not** covered, before the findings.

**Composition over invention.** The closest existing shape is the uninstall feature's
plan/execute/report split — same problem, one level over. The step-runner issues **existing**
control commands (`navigate`, `walk`, `audit`, `lint`, `inspect`, `capture`) over **one held
session**, not N independent `drive` calls — holding one session is the point, since
renegotiating per step reproduces `bug-canvas-blank-without-notice` and
`bug-ipc-native-pane-invisible-once` mid-flow, exactly where they're hardest to diagnose. The
report is a new section type in the existing grouped-findings renderer. Re-run/diff reuses
existing history/stored-shapes infrastructure.

**The one real architectural seam:** `obsrv_report` is headless by design, on purpose. A flow is
inherently live. Answer: a sibling tool (`obsrv_flow`), not a retrofit — keeps the old decision
intact.

**Hazards designed out before code, not rediscovered after:**
- Single-instance collision — a held session monopolises the one app instance; a concurrent
  caller must be refused loudly, told who holds it (`pid` + `startedAt`, already stamped), never
  queued (a queue lands a second caller's action at an unpredictable point inside someone else's
  flow — silent corruption with extra steps).
- MCP output schemas validate only after `listTools` — a per-step reply is a much bigger shape
  than anything currently registered; watch for the same gap that shipped unvalidated fields
  before.
- The 4096px capture cap — known limit on report pins, hit once per step. `feat-flow-report`
  ships with this stated as a limitation rather than silently absorbed; per-region capture is a
  future card if it's ever the thing actually blocking someone, not built speculatively now.

**Plain-language flow specification, but the resolved step list is the durable artifact** —
what runs, re-runs, what CI schedules, what a diff compares. Natural language is a separate
interpretation layer on top, added last, because it's the only part whose output can't be
checked mechanically.

## The cards, in build order

1. `feat-flow-definition` — the step type and its validation. No runner, no report, nothing
   live. Verifiable without an app.
2. `feat-flow-runner` — the step-runner, one held session, existing control commands.
3. `feat-flow-report` — the per-step section, coverage ledger, the `obsrv_flow` sibling tool.
4. `feat-flow-language` — plain language resolved into steps. Last, on purpose, on top of an
   already-verified foundation.

Each is separately gateable. Ownership lives on the cards, not here.
