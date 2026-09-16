---
title: "The product routes a warning by matching its own prose"
column: doing
kind: bug
owner: "Rook"
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

## The trio was checked against this and does not break it

**Checked by Rook at the lines, and recorded here so the next reader does not re-derive it.** The
trio strips the `warning: ` literal only — it rewords nothing. The messages `:363` matches on come
from `capture.ts:257` and `:272` and are **already bare**, and the one `capture.ts` literal the
trio strips (`:286`, the uncovered-frame warning) does not contain "kept painting". **The regex
keeps matching after that change.**

That is a false alarm removed rather than a hazard downgraded, and the distinction matters: a card
that cries wolf about a specific change stops being read about the general one.

## The hazard that remains, which is not about the trio

**Any future rewording of the sentence at `capture.ts:257` or `:272` silently breaks this.** That
is not hypothetical: `read-the-output-not-the-code` commits this project to rewording warnings
whenever they get clearer, and "kept painting" is ordinary prose nobody would think twice about
improving.

The trio happens to be safe. **The next change to those sentences is the one to worry about**, and
it will not announce itself — there is no test, no type, and no comment at `capture.ts` saying a
regex forty lines away depends on the wording.

## What the fix has to decide

The obvious move is a structured field: give the warning a `kind` or `cause` and route on that,
the way `audit`/`lint`/`inspect` already label at the boundary (`main.ts:1084`, `:1212`). That
is the same "the right pattern already exists in this file" Rook found for the trio.

Two questions that are not obvious:

- **Does the field reach `warnings[]`?** If it does, it is an added field on the MCP surface and
  therefore breaking by `compatibility.md`'s inverted rule — see `bug-inspect-readout-schema`,
  which is the same trap already shipped. If it stays internal, it is free.
  **ANSWERED 2026-09-16 by Rook, and it stays internal.** The reason is a second argument on the
  `onWarn` *callback*, consumed at the routing site and discarded. `warn(message)` still takes
  one string, `warnings[]` still holds strings, no output schema gains a field, nothing under
  `additionalProperties: false` moves, and no register entry is owed. Henry raised it; it is the
  kind of thing that looks safe and is not, so it is written down rather than left to a reviewer.
- **Is `/kept painting/` the only one?** **SWEPT 2026-09-16 by Rook: yes — one case, not a
  class.** So a fix here closes the whole of it, and nothing about this card's scope rests on
  there being siblings. (The *"fixing this instance ships the class"* reasoning belongs to
  `bug-report-doubled-warning-prefix`, where the class was real and the sweep found three more
  sites. It was never established here, and is not.)

## The sweep, and the denominator it took two attempts to earn

`src/` only — 87 files, 23,671 lines. `tests/` deliberately excluded: a spec matching prose is
the contract checker, not a caller.

| shape | hits | control |
| --- | --- | --- |
| `.test` / `.match` / `.search` | 16 | sees `main.ts:363` |
| `includes` / `startsWith` / `endsWith` / `indexOf` | 28 | sees `warnings.ts:33` |
| `===` / `!==` against a string literal | 380 | none available |
| `switch` / `case` on a string literal | 60 | none available |

The last two had no known instance to validate them and 440 hits is not readable by hand, so
they were narrowed on the property that separates prose from an identifier: **a sentence contains
a space; an enum value, a key or an id does not.** That filter has its own control — a planted
`msg === 'page kept painting for a while'` is found. Three hits, all read: two are `e.key !== ' '`
(the space *bar*, `preload/sync.ts:344`, `:426`) and one is `walkCoverage.ts:245` comparing a
local set four lines above. **None is the defect.**

The other prose-shaped matches in `src/` are not this bug, and the distinction is the point:
`CHROMIUM_CHATTER` (`mcp/lib.ts:480`, `:524`) matches **Chromium's and Electron's** output, a
foreign format this project neither controls nor promises to reword. A caller matching *our*
prose is forbidden because we promise to change it. Nobody promised anything about `objc[12850]:`.
`main.ts:709` is a `{preset}` filename placeholder; `warnings.ts:33` is whole-string identity for
deduplication; `mcp/lib.ts:685` scans for a brace.

**The first attempt at this sweep reported a zero from an instrument that could not have found
anything**, and it is recorded here because the card is about exactly this habit. The pass was
`grep -E "/[^/\n]{4,}/[gimsuy]*\.test\("` — and in POSIX ERE a bracket expression has no escapes,
so `[^/\n]` excludes `/`, `\` and **the letter `n`**. "kept painting" contains an `n`. It ran
*after* the case was already found by a different pass, so the zero read as corroboration. Henry
asking what the zero was a zero *out of* is what exposed it. **An instrument that has not been
shown to find something cannot report a zero.**

## What is pinned before any fix

`tests/unit/cliCapture.test.ts` carries a characterization test recording which reason carries
which sentence and how the prose match routes each — `animating` and `timeout` suppressed,
`blank` and `uncovered` kept — with both verdicts present so the predicate is discriminating
rather than saturated.

**Its control is the demonstration this card previously only argued.** Rewording `capture.ts`'s
animating sentence to *"page painted continuously for"* — the kind of edit
`read-the-output-not-the-code` commits this project to making — turned the test red
(`animating:suppressed → animating:kept`) **with `tsc` clean on that tree.** A rewording is not a
type error, nothing throws, and the warning silently takes the other branch.

**What is still not pinned, and it is why the defect survived:** the routing decision itself has
no test anywhere. It is an inline arrow inside `render()` in a 1600-line file, unexported, and
reachable only by driving a real Electron target. The predicate in the characterization test is a
deliberate copy, and says so at the line.

## The general shape, for `CONTRIBUTING` if it survives

**A rule you write for your callers applies to you.** This project told callers not to parse
prose, then parsed its own. The same inversion produced `bug-inspect-readout-schema`: a policy
page led with *adding a field is breaking on MCP* while the server was already rejecting its own
reply for exactly that.

**Both were found by someone reading the code for a different reason.** Neither was found by the
policy.
