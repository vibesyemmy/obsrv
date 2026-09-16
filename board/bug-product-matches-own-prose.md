---
title: "The product routes a warning by matching its own prose"
column: done
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

**The sentences are the product and they get rewritten.** `CONTRIBUTING.md`'s *Writing it down*
opens *"Obsrv's output is sentences, and the sentences are the product"*, and `compatibility.md`
promises callers the wording of any warning may change in a minor. So this repo has a documented
commitment to changing exactly the string this regex depends on.

> **Citation corrected 2026-09-16.** This card, and six others on the board, cited
> `docs/read-the-output-not-the-code` for that principle. **No such file exists, on `main` or
> anywhere in the tree** — it is a path seven cards have been pointing at for days. The principle
> is real and lives in `CONTRIBUTING.md` under *Writing it down*; only the citation was a ghost.
> Found by checking every file path this card names against `origin/main` — a check run because
> Henry caught this same card asserting that a test file *carries* something the tree does not
> contain. The other six are not this card's to edit and are filed separately.

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

## Measured, and where the instrument is

**Nothing in the tree this card lands in carries the test below.** It is on Rook's
`fix/prose-match-routing`, unpushed at the time of writing, and lands with the work pull request.
Named rather than implied, because a card that says a file *carries* something the tree does not
contain is this card's own defect in a different costume — Henry caught it on the first draft of
this section.

The measurement itself stands wherever the instrument ends up, and is the reason this card is a
bug rather than a tidy-up:

A characterization test drives `captureQuiescent` through every reason it can warn for and
records which sentence each carries and how the prose match routes it — `animating` and `timeout`
suppressed, `blank` and `uncovered` kept. Both verdicts appear, so the predicate is discriminating
rather than saturated; four `kept` rows would pass while testing nothing.

**Its control is the demonstration this card previously only argued.** Rewording `capture.ts`'s
animating sentence to *"page painted continuously for"* — the kind of edit
`read-the-output-not-the-code` commits this project to making — turned the test red
(`animating:suppressed → animating:kept`) **with `tsc` clean on that tree.** A rewording is not a
type error, nothing throws, and the warning silently takes the other branch. The edit was then
reversed rather than the file reverted, and `src/` was confirmed unchanged.

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

## CLOSED by Rook, 2026-09-16 — #49 (`95f450f`), plus the follow-up below

`main.ts` routes on `explainedByCutLoad(reason)`. `onWarn` carries `(message, reason)`; all five
`capture.ts` call sites pass the `unsettledReason` they already set on the line above. The regex
is gone. Nothing reaches `warnings[]` — the reason is a callback argument consumed at the routing
site and discarded — so no output schema gained a field and no register entry was owed.

**Behaviour-identical, asserted rather than claimed.** The characterization test drives all four
reasons through `captureQuiescent` and checks `explainedByCutLoad` against the verdict the prose
match gave each of them, recorded as data rather than as a live copy of the old regex.

**The control is what closes it.** Rewording `capture.ts`'s animating sentence to *"page painted
continuously for"* moved `animating` from suppressed to kept before the fix, with `tsc` clean and
nothing thrown. After it: the routing tests pass, a real cut-load snap still suppresses the
capture warning, and the only red is `cliCapture.test.ts:110`'s `toMatch(/painting steadily/)` —
a test that deliberately pins a sentence, **going red loudly where the product used to go wrong
quietly.**

## The follow-up, and why the first version was worse

Henry's review point, taken: **the `never` default no longer throws.** The exhaustiveness is
entirely the `const unrouted: never = reason` assignment's doing at compile time — **measured**,
by adding `'stalled'` to the union and watching `tsc` fail at that line, then reversing it. The
`throw` added nothing to that and made a *warning router* capable of taking down a capture.

And the fallback is now `return false` — **keep the sentence.** A router that cannot classify a
warning should let it through, not suppress it and not crash. This card is about a warning going
missing quietly; the first fix could have made one go missing loudly, which is better but still
the wrong answer.

## What the sweep settled, for the next reader

One instance in `src/`, not a class — four shapes over 87 files and 23,671 lines, two validated
by controls that fired and two narrowed on a filter with its own control. `tests/` excluded on
purpose: a spec matching prose is the contract checker, not a caller.
