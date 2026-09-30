---
title: "a flow can enter text, so a user flow can reach the pages behind a form"
column: backlog
kind: feat
order: 118
---

FILED BY HENRY 2026-09-30, answering Opeyemi's question — *"is there anything we need to fix in the new
feature?"* — after `feat-flow-selector-click` shipped in 0.63.1. This is the first of four answers and
the only one that is a missing capability rather than a refinement.

## What is missing

**The control vocabulary has 32 commands and none of them enters text.** Counted, not estimated:
`grep -oE "case '[a-zA-Z]+':" src/main/controlServer.ts` gives 32 distinct cases and **zero** matching
`type|fill|press|key` (checked independently by Idris).

So a flow can navigate, click, scroll, set a preset, and measure — and cannot *log in*, *search for a
thing*, *enter a coupon*, or *fill a checkout form*. Every page behind a form is unreachable to
`obsrv_flow`, which is most of what a QA flow is for.

**The resolver's own headline example names the gap.** `flowLanguage.ts` refuses *"log in, add an item,
checkout"* — the sentence the feature was designed around — and since 0.63.0 the refusal says a
description names an intent rather than an element. With clicking solved, **typing is what stands
between that sentence and a flow that runs it.**

## Why this is the top of the list

The other three gaps found in the same review are bounded: a class of site that does not work yet
(shadow DOM), a shape that refuses rather than misfires (the point heuristic), and a caveat the report
should state (`expect` is read on whatever page the step ended on). This one is categorical — *a flow
that cannot type cannot check out.*

## Not yet designed, deliberately

What a `type` command should be is a real decision and this card does not pre-empt it. At least these
have to be answered before anything is built:

- **Where the text goes.** A selector (the same resolution `click` now has, including the
  scroll-into-view and the drawn-at-this-point check), or the focused element, or a point.
- **Whether it types or sets.** `insertText` puts a string in; real keystrokes fire `keydown`, which is
  what a React-controlled input, an autocomplete and a form validator actually respond to. These behave
  differently on real sites and the difference is the feature.
- **What it must never do.** Credentials are the obvious use and the obvious hazard: a flow's steps live
  in a report, and a report is an artefact someone shares. A password typed into a step is a password in
  a file. That needs an answer before the first line of code, not after.
- **How a refusal reads** when the element is not editable, is disabled, or is behind a shadow root.

## Acceptance (draft, for whoever picks it up)

- a step can enter text into an element named by selector, using the same resolution `click` uses;
- what happens with a non-editable, disabled or absent target is a refusal that names which;
- the report shows what was typed **or** deliberately does not, and the card says which and why;
- one real run against a live form, in the same spirit as `feat-flow-selector-click`'s live clause —
  the shape of the failure it must prove against is a controlled input that ignores `insertText`.
