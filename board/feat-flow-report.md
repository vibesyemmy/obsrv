---
title: "The flow report is per-step and honest about coverage, not one page pretending to be eight"
column: done
owner: "Henry"
kind: feat
order: 113
---

FILED BY WREN 2026-09-26, from the whole-team brainstorm on the QA-flow-report feature
(`board/epics/qa-flow-reports.md`). Drafted by Henry to the point of being mechanical
to write. Depends on `feat-flow-runner`.

**The role this plays.** A new section type in `src/cli/reportHtml.ts`, which already renders
grouped findings with numbered pins and crops. **A sibling surface** — a new `obsrv_flow` tool —
**not** a change to `obsrv_report`: that tool is headless by design, on purpose, and a flow is
inherently live. Reversing that decision is out of scope here.

**Acceptance:**
- **the front page leads with what was not covered, before the findings.** A QA engineer's
  costliest mistake is trusting a clean report that never reached step 4;
- each step shows step / expected / actual / evidence — scannable in ten seconds, with the
  resolved action, network call and DOM state one click down for reproduction. *Split
  2026-09-29 into two halves with different costs, named before either was built (Henry): DOM
  state reuses the existing `inspect` readout (element, box, text) at one extra control call per
  targeted step — cheap. A per-step network record needs a `webContents.debugger` session held
  for the flow's duration, and `src/main/targetSource.ts:188` already says, of exactly that kind
  of session, that "detaching it wipes Electron's own emulation with it" — a flow runs under a
  preset, and device emulation **is** the preset, so an attach-then-detach for a network record
  risks dropping the flow's preset mid-run. (An earlier version of this note said the file warns
  about *timing*; it doesn't — that was Henry's own inference, corrected once he re-read the line
  he'd cited, and the emulation risk is the sharper, documented one.) So: DOM state ships first on
  its own; network ships only once a measured before/after shows whether the preset survives
  attach-then-detach — a yes/no, not a millisecond count — and if it does not, the report has to
  say the network record cost it, the way `--full-page` already warns when it changed the layout;*
- **Obsrv's own passive findings (visual/accessibility) are visually separated from the QA
  engineer's stated expected observations**, and the stated expectation is shown beside its
  evidence with Obsrv judging nothing — the same "report, don't decide" line the audit and lint
  groups already hold. *Recording what Obsrv actually saw for it — present/absent — moved to
  `feat-flow-observations` on 2026-09-28: nothing in the definition or the runner captured an
  expectation as something checkable, so this card had no signal to render, and faking one would
  be Obsrv pronouncing on something nobody measured. Not met here, by design, and named rather
  than silent;*
- **a step measured on an unsettled frame renders as a third state, `unknown`** — not folded into
  clean or dirty, and with real visual weight on the page itself, not just a field in the JSON a
  fast reader will skim past as a pass;
- per-step coverage extends `src/shared/walkCoverage.ts` rather than starting a new mechanism.

**Known, stated limitation rather than a silent gap:** per-step full-page overviews will hit the
4096px capture cap once per step — the existing limit on report pins. Ships with this named on
the card and, if it lands as a real limitation, in the report itself. Per-region capture is a
future card if it ever actually blocks someone, not built speculatively ahead of that.

## DONE 2026-09-29

`#493`: the DOM-state half of clause two (address, size, density, `loading` only when true) —
cheap, a round-trip from memory rather than a measurement, shipped first on its own. `#504`: the
measurement clause two's network half was gated on — does an attach-then-detach take a flow's
preset with it? No. Reproduced independently on a second machine after its own detector turned out
to be a coincidence of the test's original fixture, caught and fixed before merge. `#505`: the
network record itself, built on Opeyemi's explicit "build it" (room, 2026-09-29) once the
measurement cleared it.

**`#505`'s own review is worth citing in full, because the record it produced needed a second
round to be trustworthy.** Idris attacked the one inferred fact Henry asked her to attack — that a
network session's `stopped` reason was asserted as "a throttle being lifted" rather than observed
— and found the assertion was not just imprecise but reachable-today wrong: an ordinary `setPreset`
to a different density mid-flow recreates the window, detaches the old debugger for an unrelated
reason, and because the recording flag was never reset, silently killed recording for the rest of
that tab's life, not just that step. Henry's first fix corrected the flag but also cleared the
`stopped` marker on restart — which erased the exact evidence a reader would need to know a swap
had happened, caught by a new e2e test that failed on it before anyone else read the diff. Fixed a
second time: the reason is now keyed on CDP's real detach cause, the record persists until read
rather than being cleared on recovery, and one of Henry's own existing unit tests was inverted
because its old assertion encoded the bug's own premise (a dead session stays dead) rather than the
corrected behaviour.

**The epic's five cards are now all done.** `feat-flow-selector-click` remains in `backlog` —
unowned, not a clause of any card here, but the thing that makes the feature's own pitch example
("log in, add an item, checkout") actually click. Naming that distinction is why this card says
"done" rather than "the feature is finished": `obsrv_flow` meets everything this epic asked of it,
and one further card exists because a QA engineer reading "plain-language flow" would expect more
than the epic's own acceptance strictly promised.
