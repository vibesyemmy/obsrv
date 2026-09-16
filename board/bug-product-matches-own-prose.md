---
title: "The product routes a warning by matching its own prose"
column: next
kind: bug
order: 37
---

FOUND BY ROOK 2026-09-16, while reading the fifteen warning call sites for the report/diff trio.
Flagged rather than taken — Rook is mid-trio. **Unowned.**

## The defect

`src/cli/main.ts:363` decides what to do with a warning by pattern-matching the warning's own
sentence:

    /kept painting/.test(m)

**`compatibility.md` tells callers never to match on warning prose** — *"Human-readable text on
stderr is not a contract and may be reworded at any time… Match on structured fields, never on
prose."* The product does the thing its own policy forbids, to itself.

## Why it is worse than an ugly line

**The sentences are the product and they get rewritten.** `docs/read-the-output-not-the-code` is
the standing argument that Obsrv's warnings improve by being reworded. So this repo has a
documented commitment to changing exactly the string this regex depends on.

**And the failure is silent.** Reword "kept painting" and the test stops matching. Nothing throws;
the warning routes down the other branch; a person reading the output sees a sentence in the wrong
place or not at all, with no error anywhere. **A rewording is the most likely change to this code
and the least likely to be noticed breaking it.**

## It is live in the blast radius of the trio work

`bug-report-edit-invisible` and `bug-report-doubled-warning-prefix` are being fixed by moving
labelling into the sink and stripping pre-composed literals. **That work reshapes warning strings
and their routing.** Whoever does it should know this regex exists before touching the path, not
after a suite goes strange.

Not a reason to fold it into the trio — it is a different root and folding it would hide it — but
a reason to read this card first.

## What the fix has to decide

The obvious move is a structured field: give the warning a `kind` or `cause` and route on that,
the way `audit`/`lint`/`inspect` already label at the boundary (`main.ts:1084`, `:1212`). That
is the same "the right pattern already exists in this file" Rook found for the trio.

Two questions that are not obvious:

- **Does the field reach `warnings[]`?** If it does, it is an added field on the MCP surface and
  therefore breaking by `compatibility.md`'s inverted rule — see `bug-inspect-readout-schema`,
  which is the same trap already shipped. If it stays internal, it is free.
- **Is `/kept painting/` the only one?** Nobody has swept for other prose matches in `src/`. One
  instance is not the class, and this was found by reading fifteen call sites for an unrelated
  reason — which is not a search.

## The general shape, for `CONTRIBUTING` if it survives

**A rule you write for your callers applies to you.** This project told callers not to parse
prose, then parsed its own. The same inversion produced `bug-inspect-readout-schema`: a policy
page led with *adding a field is breaking on MCP* while the server was already rejecting its own
reply for exactly that.

**Both were found by someone reading the code for a different reason.** Neither was found by the
policy.
