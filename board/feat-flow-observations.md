---
title: "A step can state what it expects to see, and the runner records what it saw — present or absent, never pass or fail"
column: done
owner: "Dogu"
kind: feat
order: 114
---

FILED BY WREN 2026-09-28, out of `feat-flow-report`'s own gate (`board/epics/qa-flow-reports.md` has
the order). Depends on `feat-flow-runner` for the capture half and on `feat-flow-report` for the
rendering half.

**Why this card exists.** `feat-flow-report` promised that, for a QA engineer's stated expectation,
"Obsrv reports what it saw — present/absent — without pronouncing pass or fail." `#476` cannot keep
that promise: nothing in `feat-flow-definition` (`src/shared/flow.ts`) or `feat-flow-runner`
(`src/mcp/flowRunner.ts`) captures an expectation as something checkable, or observes it, so there
is no signal for the report to render. Henry named the gap in the room (seq #2388, #2394) and the
gate on `#476` agreed the report should ship showing the expectation beside its evidence and
judging nothing, rather than inventing a verdict (seq #2395). It is a card, not a note — and its own
card rather than an amendment to `feat-flow-report`, because both modules it touches are `done` and
the report's PR should not also carry new capture logic.

**The role this plays.** The capture half of a stated expectation: a field on the step that says
what the QA engineer expects to see, validated like everything else in the definition, and a
per-step record of what the runner actually saw for each. Henry's starting sketch (seq #2388): one
`observations?: string[]` on a step, and a runner that records what it saw for each, without
judging. The report card renders the record; this card produces it.

**Acceptance:**
- **a step may carry stated observations, and a bad one is rejected with a named reason** — the
  same discipline `validateFlow` already holds for a bad step, not a boolean. Unit tests cover every
  rejection path, not just the happy one;
- **the runner records, per observation, what it saw — present, absent or unknown — and never pass
  or fail.** Same "report, don't decide" line the audit and lint groups already hold: an
  observation that comes back absent is something for the QA engineer to read, not a verdict Obsrv
  pronounces;
- **an observation on an unsettled or a failed step is `unknown`, never absent, and one on a step
  that was not reached is `not-reached`, never an implied absent.** A frame that had not finished
  painting cannot honestly say something is missing, and a step that failed never showed what it
  was meant to show — the same third state `feat-flow-report` gives the step itself;
- **each record says where it looked**, not just what it concluded — the discipline
  `walkDialogNote`/`unsettledReason`/`pageMovedNote` already hold. "Absent" must be distinguishable
  from "Obsrv looked somewhere the thing could not be" (a canvas, a shadow root, a frame it cannot
  reach, an app shell). A composed report inherits every silence of what it composes, and an
  observation is the place a silence would read most like an answer. **`absent` is recorded only
  when the reader read everything it could and names what it could not; anything less is
  `unknown`**, and a match that exists but is not rendered is reported as exactly that;
- **the report renders the record beside the stated expectation**, labelled as Obsrv's observation
  and kept apart from its own passive findings. This half changes the flow section `#476` adds, so
  it lands after that section is on `main`; the capture half does not need to wait. The two halves
  are separately gateable — one PR or two is the owner's call.

**What the existing readers can and cannot say about text** (Dogu's premise check, seq #2399; the
numbers confirmed on `main`). `audit`'s text list holds each rendered element's own text cut to 40
characters (`src/shared/audit.ts:94`), capped at 3000 entries (`AUDIT_MAX_TEXT`); `inspect` returns
one element's text cut to 60 (`src/shared/inspect.ts:244`). A match in either is sound evidence of
*present*. Nothing they return can stand behind *absent*: the string could sit past character 40
of a long text node, and any page with a paragraph has one. An earlier draft of this card said
literal text was "checkable now". That was written without reading what those commands return, and
it was wrong for the half of the question that matters.

**Decided 2026-09-28 (scope; the public shape is Henry's to accept).** An honest `absent` needs an
exact reader: one small page script and a control command that, per string, reports how many
rendered elements contain it, the first matches with their rect, what it could not read (frames,
closed shadow roots), and matches that exist but are not rendered. It is built as a second PR. The
first PR ships everything that is the same under any reader — the field, its validation, the
per-observation record — against an injected reader, and answers `unknown` wherever the reader
cannot stand behind `absent`. Two things for the owner to check and name when it ships: a new
control command widens `CONTROL_COMMANDS`, which `validateFlow` reuses (`src/shared/flow.ts`), so it
also becomes a valid flow action; and state expectations (checked, disabled, visible) need a
selector, which stays out — a different card, if anyone needs it.

**Not this card:** any pass/fail; resolving plain language into observations (that is
`feat-flow-language`, which depends on this one); a new report surface.

## DONE 2026-09-29

`#481` (Dogu, first PR): the field, its validation, and the per-observation record against an
injected reader. `#482` (Dogu, second PR): the exact reader — `observeText` plus
`observeViaControl`, answering `present`/`absent`/`unknown` for real, and naming *why* whenever it
can't — iframes in the viewport at the page's top are never searched, and the sentence says how
many and how much of the viewport they cover rather than just "incomplete". `#500` (Henry): the
reader wired into `obsrv_flow`'s dependencies, extracted into `flowRunnerDeps` specifically so "a
reader is supplied" became a checkable claim rather than an assumption about a closure no test
could reach — it had quietly been false before this PR. Together: `obsrv_flow` now answers "the
text you expected is there" or "it is not", not just `unknown`.

**Both things the card asked the owner to check and name, resolved:** the new control command
does widen `CONTROL_COMMANDS`, which `validateFlow` reuses — Idris caught that a hand-written
`{action: 'observeText', ...}` would validate as a normal flow step, contradicting the runner's
own comment that it isn't one. Fixed with `NOT_FLOW_ACTIONS`, a narrow exclusion inside
`src/shared/flow.ts` only (`CONTROL_COMMANDS` itself keeps the entry, since the runner still needs
it there for its automatic post-step call). State expectations stayed out of scope, as planned —
still a different card if anyone needs one.

**Known, stated limitation, not a silent gap:** a page with an iframe in the first viewport — a
cookie banner, an embedded video, a chat widget — can never honestly return `absent` for text that
might be inside it; the reader answers `unknown` instead, and every such sentence names how many
iframes and how much of the viewport they cover, rather than just saying "incomplete". On many
commercial pages that is the ordinary case, not an edge. Henry flagged (2026-09-29) that the
standing expectation still needs a line in the repo's own README so a user learns it before their
first run rather than from an unexpected `unknown` — outstanding, not yet written, tracked in the
room rather than this card since it belongs to `obsrv_flow`'s description as a whole.
