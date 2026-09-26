---
title: "Resolve a plain-language flow description into steps — last, on a verified foundation"
column: backlog
kind: feat
order: 114
---

FILED BY WREN 2026-09-26, from the whole-team brainstorm on the QA-flow-report feature
(`board/epics/qa-flow-reports.md`, item 4 of 4). Drafted by Henry to the point of being mechanical
to write. Depends on `feat-flow-report`.

**The role this plays.** The interpretation layer: a QA engineer writes "log in, add an item,
checkout" instead of a coordinate-based recording — a recording captures clicks, not intent, and
breaks silently on any DOM change in a way that looks like a product bug rather than a stale
test. This layer resolves that description into the step list `feat-flow-definition` already
validates.

**Acceptance:**
- **the report shows what Obsrv resolved each sentence into**, visibly, so "Obsrv misunderstood
  step 2" is distinguishable from "step 2 is actually broken" — the same discipline
  `walkDialogNote`/`unsettledReason`/`pageMovedNote` already hold: name the mechanism a sentence
  is keying off, not just the conclusion.

**Deliberately last.** This is the only piece in the epic whose output cannot be checked
mechanically — everything before it is a verifiable shape. It sits on top of that shape rather
than under it, so its ambiguity stays visible instead of load-bearing.
