# The note sweep: every sentence Obsrv can emit, against two tests

Not a live run. Every defect on 2026-09-12 belonged to one family — a
sentence guessing at something the measurement already held, or a silence
that fits two opposite facts equally well — and runs 13, 14 and 15 each
turned up members of it. A run samples that family; this enumerates it.

Two questions are asked of every row:

1. **Does it guess?** Does the sentence offer causes when the measurement
   already holds the answer to which one it is?
2. **Does its silence fit two facts?** Name the two situations that would
   each produce no note. If they are opposite, the silence is a defect.

## First: the surface count I gave was wrong

I said "three surfaces assemble the same notes independently — 12 × 3".
That is false, and the error flattered the problem in one direction while
hiding it in another. What is actually there:

| Assembly point | Lives in | Who else it serves |
| --- | --- | --- |
| **A — headless** | `src/cli/main.ts`, `cli/audit.ts`, `cli/lint.ts`, `cli/walk.ts` | the MCP headless tools, which **spawn `bin/obsrv.js`** (`CLI_BIN`) rather than assembling anything |
| **B — live measure** | `src/main/ipc.ts` | the app itself, and the MCP live tools via `controlServer`, which forwards `deps.audit()` and adds none of its own |
| **C — live walk** | `src/mcp/walk.ts` | the MCP live path only; mirrors `cli/walk.ts` |
| **D — MCP live wrapper** | `src/mcp/server.ts` | adds `walkCoverageNote` around the live audit (:1370) and lint (:1652) |

There are **four**. I first wrote "two and a half" and said `mcp/server.ts`
adds no notes; it adds walk-coverage notes to both live tools (found by
obsrv-8d). Correcting a wrong count downward twice, in the same document,
is worth leaving visible.

**And the shared functions are a surface of their own.** `auditFindings`
and `lintFindings` in `cli/*` are called by *both* A and B, and they emit
notes internally — `droppedEntriesNote` at `cli/audit.ts:149`,
`layoutScaleNote` at `:165`. A note pushed there reaches the live reply
through `...result` in `ipc.ts`. This is why grepping a surface file for a
note's name proves nothing.

My first pass also read `droppedEntriesNote` and `layoutScaleNote` as having
**zero call sites anywhere**, which would have made them dead code. They are
not: both are called from `cli/audit.ts` and `cli/lint.ts`, and
`layoutScaleNote` from `shared/inspectReadout.ts` too. I had grepped only
`main.ts`, `ipc.ts` and `server.ts` and read the absence as a fact about the
codebase rather than about my grep. That is the same mistake the sweep
exists to find, made about the sweep.

## The matrix

`✓` emitted · `—` correctly absent · `GAP` absent with the facts present.
Verified by reading the call chain, not by grepping surface files.

| Note | A headless | B live | C mcp walk | Guesses? |
| --- | --- | --- | --- | --- |
| `droppedEntriesNote` | ✓ | ✓ *(via `auditFindings`)* | n/a | no |
| `emptyDocumentNote` | ✓ | ✓ but **GUESSES** | n/a | **A no, B yes** |
| `httpStatusNote` | ✓ | **GAP — never collected** | n/a | no |
| `landedElsewhereNote` | ✓ | **GAP — never collected** | n/a | no |
| `layoutScaleNote` | ✓ | ✓ *(via `auditFindings`)* | n/a | no |
| `measureTimeoutNote` | ✓ | ✓ | n/a | no |
| `navigatedAfterLoadNote` | ✓ | **GAP — never collected** | n/a | no |
| `shadowShareNote` | ✓ | ✓ | n/a | no |
| `walkCoverageNote` | ✓ | ✓ *(D, `mcp/server.ts`)* | ✓ | no |
| `walkDialogNote` | ✓ | n/a | ✓ | not read |
| `walkNothingNote` | ✓ | n/a | ✓ | no |
| `walkTimeoutNote` | ✓ | n/a | **GAP** | no |

## What survives the read

### 1. The live path still guesses on an error page

`ipc.ts:1646` and `:1696` call `emptyDocumentNote` with **four** arguments.
The headless calls pass five — the fifth is the HTTP status, and it is what
0.58.0 added so that an empty 404 stops offering "a page rendered by script
that had not run yet, a bot wall, or an empty document". The live path
cannot pass it: `ipc.ts` has zero occurrences of `httpStatus`.

So a live audit of an empty error page still offers three causes, two of
which the response has already disproved — with the answer in a field
nobody collected. This lands on a row I had marked *fixed*, which is the
kind of row a sweep exists to catch and mine did not.

### 2. Three notes are absent because the fact is never measured

`httpStatus`, `navigatedAfterLoad` and `landedElsewhere` appear **zero**
times in `ipc.ts`. The live path does not fail to *say* them; it never
collects them. That is a missing measurement, not a missing `push`, and it
is the root of finding 1 above.

### 3. A live walk that stopped early says nothing

`cli/walk.ts` throws `walkTimeoutNote` when a single scroll goes unanswered
within its budget. `mcp/walk.ts` never imports it, and catches rather than
throws, because a walk must not fail a measurement. Two facts, one silence:
a live walk where every scroll answered, and one where the page stopped
answering and the walk quietly stopped short.

## What did not survive, and why the method was wrong

Two of my three findings were my own grep error, not defects:

- **"The live path drops entries silently"** — false. `droppedEntriesNote`
  is inside `auditFindings`, which `ipc.ts` calls, and the note reaches the
  agent through `...result`.
- **"`layoutScaleNote` in the live path is a judgement"** — there was
  nothing to judge. It is emitted from the same shared function and has
  been shipping for months.

Both were found by looking for a note's *name* inside a surface file. That
is the third instance of the same error in this document, counting the one
I caught myself. The lesson is not "grep more carefully":

> **A call site is not a sentence, and a sweep by grep cannot tell the
> difference. Only printing the output can.**

Which is the rule the last three days keep producing, now applied to the
instrument built to enforce it. The sweep continues as a harness that drives
each surface against the same scenarios and prints what each actually says —
not as a reading of the code.

## Open

`walkDialogNote`: skimmed, not read, by either of us — and the keep-or-delete
question from run 15 finding 3 is still open. Every `n/a` in the table above
needs a stated reason; an unexamined `n/a` is a silence that fits two facts.
