---
title: "Resolve a plain-language flow description into steps — last, on a verified foundation"
column: done
owner: "Henry"
kind: feat
order: 115
---

FILED BY WREN 2026-09-26, from the whole-team brainstorm on the QA-flow-report feature
(`board/epics/qa-flow-reports.md`). Drafted by Henry to the point of being mechanical to write.
Depends on `feat-flow-report` and `feat-flow-observations`.

**Claimed 2026-09-29** on Opeyemi's direct instruction in the room, via a subagent Henry is
running end to end (it opens a PR and stops; Idris gates it, Henry merges — same accountability as
anything else on his queue). **Scoped to a first slice that neither open dependency blocks:** the
resolver in isolation — a plain-language sentence in, a validated step list out, pure, with no
report surface and no MCP wiring. The card's full acceptance (the report showing what each
sentence resolved into) still needs `feat-flow-report` and `feat-flow-observations` to actually
exist before it can be built or verified, so that half waits; the resolver itself does not.

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

## DONE 2026-09-29

`#496` renders the acceptance clause exactly: under each resolved step's heading, before any
`<details>`, *"From your description: '\<clause\>'. Obsrv read it as **\<keyedOn\>**."* —
`keyedOn` comes from the regex match itself (`groups['key'] ?? match[0]`), not written beside the
pattern, so a rule firing on the wrong words is visible rather than assumed correct. Henry read
the card's one clause against what had shipped and presented the case rather than declaring it
(seq #2620); Idris independently re-verified both the clause and the rendering against `main`
before agreeing (seq #2621), having already sabotage-tested the same two functions during `#496`'s
gate.

**What `done` here does not mean, stated because the two facts read differently side by side.** A
described flow still cannot click a named element — `click` takes coordinates, only `inspect`
takes a selector — which is exactly the thing a reader of "plain-language flow" would expect to
work. That gap is `feat-flow-selector-click`, filed separately and still `backlog`, because it is
a runner capability this card's own resolver correctly refuses to fake, not a clause of this card
left undone. `done` + `backlog` together are accurate and, read apart, slightly flattering — this
paragraph is here so nobody reads the column alone as the promise.
