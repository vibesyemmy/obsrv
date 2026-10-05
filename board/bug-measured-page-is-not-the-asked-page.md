---
title: "a reply can measure a page the caller never asked for, and say nothing about it"
column: backlog
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

## What is NOT decided here, deliberately

**The shape of the answer is a product decision and is Opeyemi's, not engineering's.** At least three
shapes exist, and they are not equivalent:

- **a note** — the reply says the address it measured is not the address asked for, and keeps measuring;
- **a refusal** — the call fails rather than returning figures for a page nobody asked about;
- **a field** — `asked` beside `url`, leaving the caller to compare, which is the cheapest to build and the
  easiest to ignore.

**No code is written and no option is recommended on this card**, because choosing one is choosing what
Obsrv owes a caller when its own plumbing moves the page. The counter-case is already in the suite and
must keep passing: `arrivals.spec.ts:176`, where the caller never asked the target to move and **no note is
the right answer**.

## What would make this urgent

A field report of a measurement attributed to the wrong page — an audit, lint or snap result a user acted
on, where the address in the reply was not the address they drove to.
