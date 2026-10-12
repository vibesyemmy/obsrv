---
title: "a reply can measure a page the caller never asked for, and say nothing about it"
column: done
kind: bug
release: blocks
criterion: C5
order: 91
---

FOUND BY IDRIS 2026-10-05 while diagnosing `arrivals.spec.ts:218` (`#3752`), and filed by Henry as a
**separate** defect rather than as a reopening of `bug-redirect-note-missing-not-late`: the stamping that
card fixed is correct here, and this is a different question being asked of the same reply.

## What happens

A caller navigates the target to `redirect.html`. The sync bus mirrors the other pane's commit into the
target, replacing the document **before the page's own script runs**. The reply then measures
`hairline.html` — and says **nothing**.

**Nothing is the problem.** Not a wrong number: a correct measurement of a page the caller did not ask for,
with no sentence anywhere in the reply that the address moved under them.

## Why the existing guard cannot answer it

`ipc.ts`'s arrival guard, and the `isBusCommit` terms behind it, answer **"who made this commit"**. In this
case the honest answer is *the bus did*, and reporting "the page navigated after it loaded" would be the
`bug-arrivals` class — a note about Obsrv's own plumbing presented as the page's behaviour.

**The caller's question is a different one: "did I get the page I asked for?"** Nothing in the reply
answers it. The two questions have been conflated because, until now, the only case anyone had measured
was one where the answers coincided.

## The evidence, which is Idris's

Her reproduction (`#3752`) is the record: with the target's renderer on the repo's own `cpu-4x` preset,
**21 of 30 runs** take this path; idle, the margin between the page's own redirect start and the bus's
mirrored load is **4 to 6 ms**. In **22 of 22** failing runs a `console.log` placed before the fixture's
`location.replace` never printed — the document was gone before its script ran — and there was **no
document-initiated start at all**.

So this is not rare in the conditions a loaded CI machine produces; it is rare on an idle desk.

## Why this blocks

By `docs/release-gate.md`, a class 1 is **a wrong answer the caller cannot detect**. A caller who asked for
one address and is handed measurements of another, with no note, cannot detect it from the reply — the
reply looks exactly like a successful measurement of what they asked for. `release: blocks` on that
reading; a reviewer who thinks the caller can detect it from `status.url` should say so and downgrade it,
naming the field that makes it detectable.

## The shape, as relayed from the Resolver session on 2026-10-12: a note, plus an `asked` field

**Relayed, not yet confirmed where the builder works.** Resolver reports that Opeyemi picked this in Resolver's own
session at about 18:45Z. Nobody else can read that session. Until Opeyemi confirms it in the building session or
in one Wren can read, this section is Resolver's account. If the confirmation differs, change this section.

What room `#4695` carries: the chosen option, **"Note + `asked` field"**, which had been described to Opeyemi as
*"Keep measuring, add a note saying the measured address differs from the asked one, plus an `asked` field beside
`url` for machines."* Resolver adds one disclosure: it marked that option as its recommendation when it put the
question.

So the reply keeps its measurements, carries a note naming both addresses, and has an `asked` field beside `url`.

## The shapes that were open (kept for the record)

Before the choice above, three shapes were open, and they are not equivalent:

- **a note**: the reply says the address it measured is not the address asked for, and keeps measuring;
- **a refusal**: the call fails rather than return figures for a page nobody asked about;
- **a field**: `asked` beside `url`, leaving the caller to compare, which is the cheapest to build and the
  easiest to ignore.

## What is still open after the shape

- the note's exact wording;
- the type and nullability of the `asked` field;
- which replies carry it (snap, audit, lint, inspect, report, drive), and which CLI output prints the note.

No code is written yet. The counter-case is already in the suite and must keep passing: `arrivals.spec.ts`,
"the target mirroring the native pane is not the page navigating" (it was at `:176` when this card was written and
has moved since, so cite it by title). There the caller never asked the target to move, and **no note is the
right answer**.

**Whoever touches `arrivals.spec.ts` also renames its guard labels `(:71)` and `(:89)` to test titles.** They cite
lines that have been wrong since before `a0615e4` (Wren, room `#4701`).

## What would make this urgent

A field report of a measurement attributed to the wrong page — an audit, lint or snap result a user acted
on, where the address in the reply was not the address they drove to.

## FIXED 2026-10-12 in `#621` (merged `51eb7116`), by the note; the `asked` field moved to its own card

The class-1 defect was *"a correct measurement of a page the caller did not ask for, with no sentence anywhere in
the reply that the address moved under them."* **There is now a sentence**, so the wrong answer is detectable
from the reply. This card's own rule for leaving `blocks` is to name the warning that makes it detectable:
`measuredElsewhereNote` (`src/shared/measureBudget.ts`), wired into `whichPage` (`src/main/ipc.ts`):

> the figures are of ‹measured›, not of ‹asked›, which the last navigate asked for: this pane moved there after
> the navigate without the page moving itself, most often Obsrv's sync loading the page its other pane reached

It is compared, not counted. It fires only when the page measured is none of the addresses the earlier sentences
named (asked, landed, arrived at), and it never says the page navigated. That was Henry's constraint (`#4723`):
"who made this commit" stays the count's question. The counter-case, "the target mirroring the native pane is
not the page navigating", passed first time in `#621`'s suite.

**Pinned by** `tests/e2e/measured-page.spec.ts`, which drives the mechanism every run rather than the card's
race. On `main` before the fix, the inspect test failed with "the reply carried NO notes at all". Idris ran five
mutants of the wiring and all five were caught (room `#4741`). Suite job `114988475283`: 668 passed, 1 skipped,
`✘` 0, retries 0 (counted by Wren, Idris and Henry from one log, md5 `627561ca…`).

**Not covered:** the real race under `cpu-4x`, which the deterministic test stands in for; the CLI's headless
path (one pane, no bus); `docs/note-inventory.md`, which does not list the new call site yet.

**The `asked` field is not built.** Adding it is breaking (`docs/compatibility.md:12`). Opeyemi has the cost and
has not answered. It is no longer on the class-1 path, so it lives on `feat-asked-field-beside-url`, waiting on
that answer.
