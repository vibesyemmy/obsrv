---
title: "a flow can enter text, so a user flow can reach the pages behind a form"
column: doing
owner: Dogu
waiting: "Idris: byte-count and gate #530 before merge"
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

## A PROPOSAL FOR THE FOUR DECISIONS, 2026-09-30 — so the answer is a choice rather than an open question

Written the same night the card was filed, because the card's own value is blocked on decisions nobody
can take at 3am, and a decision is cheaper to make from stated options than from a blank page. **Nothing
here is built.** Each item names what I would do and what it costs if the other choice is right.

### 1. Where the text goes → **a selector, resolved exactly as `click` resolves one**

`{action: 'type', target: '#email', text: 'a@b.test'}`. Reuse `pointForSelector` whole: locate, scroll
into view, and **check what is drawn at the chosen point** before pressing — then focus by pressing, and
type. That inherits the wrapped-inline fix and the five refusals rather than growing a second, subtly
different resolution, which is how `bug-orientation-name` happened one surface over.

*If the other choice is right* — typing into whatever already has focus — it is a smaller feature that
cannot express "put this in the email field", which is what a flow needs.

### 2. Types or sets → **real key events, and say so**

Electron's `sendInputEvent` is already how this app forwards clicks and cursor moves
(`targetSource.ts:1406`), so keystrokes are the existing seam rather than a new one. **`keyDown` /
`char` / `keyUp` per character fires what a page listens for**: a React controlled input, an
autocomplete that opens on `keydown`, a validator that runs on `input`. CDP's `Input.insertText` puts
the string in at once and fires **no** `keydown` — faster, and invisible to exactly the widgets a QA
flow is usually there to exercise.

**The cost is honest and should be stated in the reply, not hidden**: a 40-character string is 120
events. Where that matters, an `insertText: true` opt-out can exist later — added when someone measures
a page it is too slow for, not on speculation.

### 3. Secrets → **mask by default where the page says it is a secret, opt in everywhere else**

A flow's steps and their evidence are written into a report, and a report is a file someone shares. So:

- **`input[type="password"]` is masked automatically** — the readout already tells the runner the
  element's type, so this needs no new input from the caller and cannot be forgotten;
- **`secret: true` on the step** masks anything else (a one-time code field, an API key box);
- masked means the report says **`typed 12 characters (not recorded)`** — the length is what a
  reproducer needs and the string is what it must not keep;
- the unmasked default stays for ordinary text, because *"what did it type"* is the first question a QA
  engineer asks of a failed step.

**The thing to avoid is a flag nobody sets.** Defaulting to masked everywhere would make every report
useless and train people to turn it off; defaulting to unmasked everywhere puts passwords in files.
Keying the automatic case on what the page declares is the only version that is right when nobody
thought about it.

### 4. What a refusal says → **the click family, plus three**

`not editable` (the element takes no text), `disabled`, `readonly`. Each names which, as the click's
five do. Deliberately **not** silent success: a `type` that reports `ran` having entered nothing is the
same class-1 shape as a click that presses the page behind the element
([[bug-selector-click-presses-the-gap]]).

### And one question the card did not ask, which came out of writing this

**Does `type` replace the field's contents or append to them?** A field with a value is the common case
on a re-run, and "typed the right thing into a field that already held something else" is a silent
wrong answer. Proposal: **replace by default** (select-all then type, which is what a person does), with
`append: true` for the case that wants it — and the report states which happened, because the two
produce different pages and a reader cannot tell from the text alone.

### What this proposal is worth

It is a design, not a measurement: **none of it has been run.** The one claim with evidence behind it is
that `sendInputEvent` is the seam this app already uses for input, which is a code reading of
`targetSource.ts:1406` and `overlay.ts:104-105`. The `insertText`-fires-no-`keydown` difference is
documented behaviour I have not measured in this app, and whoever builds this should measure it against
a real controlled input before trusting my sentence about it.

## CLAIMED AND BUILT, 2026-09-30 — Dogu, #530

Built to this proposal as merged (`#529`/`e014d43`): `pointForSelector` reused whole, real
`keyDown`/`char`/`keyUp` via the existing `sendInputEvent` seam, mask keyed on page-declared
`type="password"` with no `reveal` override plus `secret: true` for the rest, replace-by-default with
`append: true`, the four refusal shapes (unresolved, non-editable, disabled, readOnly). Sabotage-tested
the masking invariant at both layers it lives in (`flowRunner`'s decision, `reportHtml`'s rendering) —
each caught by exactly the test written for it. Typecheck, build, full suite (1987/1988, 1 pre-existing
skip) all clean.

**Not yet done — the card's own acceptance clause**: a live run against a real controlled input,
proving the `keyDown`/`char`/`keyUp` sequence actually produces a keystroke a React `onChange` sees,
rather than the `insertText`-shaped failure the whole design is built to avoid. Everything above is
unit/browser-level against a mocked `deps.call`. This was also Henry's own flagged unproven claim — it
stays open until measured, tracked in `#530`, not silently counted as done.

## LIVE-VERIFIED, 2026-09-30 — measured offscreen rather than on the dev lane

Henry's note: the claim is about Electron's input dispatch, which every e2e already drives offscreen —
no dev lane, no desk, and he was asleep. `tests/e2e/flow-type-text.spec.ts` (fixture logs its own
`keydown`/`beforeinput`/`input` per field, a `#controlled` field that discards any change not preceded
by its own `keydown` — the React shape without React) confirms the transport claim: real
`keyDown`/`char`/`keyUp` reach the page, in order, before the value changes. `insertText` was never
substituted.

**First run was not clean, and the thing it found was real, not the test.** Replace-by-default's
select-all was a synthetic Cmd/Ctrl+A `keyDown`/`keyUp` pair. It reached the page (`e.metaKey` read
true) but the browser's native "select all" edit command never ran — that command resolves through the
OS's own key-equivalent dispatch, which `sendInputEvent`'s direct-to-renderer injection bypasses. A
field already holding text, retyped without `append`, ended up with the new text **appended**, not
replacing it — the silent-wrong-page shape this whole feature exists to rule out, one layer up from
where the design first looked for it. Fixed in `src/shared/selectAll.ts` +
`TargetSource.selectAllAt`: sets the DOM's own selection directly (`.select()` / a `Range`), which the
real per-character keys then type over exactly as a mouse-drag selection. 8/8 on the spec after the fix,
7/7 on `flow-selector-click.spec.ts` (no regression), full suite clean.

Card's acceptance is now fully met. Nothing left open on `#530`.

## REVIEW FOUND A SECOND GAP, 2026-09-30 — Henry, confirmed by Idris, fixed

The masking rule covers the report's *text* alone. `flowRunner.ts` captures a step's own screenshot
unconditionally, and `reportHtml.ts` renders it directly above the typed block — so `secret: true` on a
field the page does not itself mark as a password (a one-time code, an API key: exactly the case the
flag exists for) left the value in that image in plain sight, under a line saying "not recorded". A
password field dodged this only by accident (the browser draws dots).

Not fixed by redacting pixels — that needs the field's on-screen position at capture time, a bigger
feature than this card asked for. Fixed by saying so: a masked step whose screenshot was captured now
states that the mask does not cover it. Sabotage-verified (`b92727c`); full suite clean.
