---
title: "Two source files contain literal control bytes, so every `grep` of them returns nothing"
column: done
owner: "Henry"
kind: bug
order: 51
---

FOUND BY ROOK 2026-09-16, while reading #85 cold — `grep` answered *"Binary file … matches"* for a
file whose contents `Read` showed plainly. Predates that PR; not Kenya's.

## The defect

This repo's `grep` is a shell function wrapping **`ugrep` with `-I`** (ignore binary files). A file
containing any control byte is classified as binary and **skipped entirely** — so a search of it
returns nothing, exits 1, and looks exactly like *the pattern is not there*.

Two files carry literal control bytes. A full scan of `tests/`, `src/` and `scripts/` found these
and no others:

    src/shared/ipcPayloads.ts:54        U+0000, U+001F, U+007F
    tests/unit/ipcPayloads.test.ts:686  U+0000

**Both are deliberate and both behave correctly** — read before being called anything:

- `ipcPayloads.ts:54` is a regex character class, `raw.replace(/[…]+/g, ' ')`, whose range is
  written with the literal bytes instead of `\x00-\x1f\x7f`.
- `ipcPayloads.test.ts:686` is test data: a forged log line carrying a NUL, asserting it is
  stripped. The NUL is the point of the test.

**Nothing is wrong with what they do. The cost is that neither file can be searched.**

## Why it is worth fixing rather than knowing about

`ipcPayloads.ts` is the IPC parser — the file a reader reaches for when asking *"is this field
copied across the wire?"*. **That question was asked today and answered by `Read` only because
`grep` had already returned an unexplained nothing.** A zero from a search of either file is
indistinguishable from an absence, and the reader gets no warning at all.

It is the same defect that cost an hour earlier today: a characterization test joined a pair on a
NUL separator, and every `grep` of that test file came back empty while `Read` showed the text.
That one was mine and is fixed. **These two predate it and are still live.**

## The fix, which changes no behaviour

Write the bytes as escapes: `\x00-\x1f\x7f` in the regex class, `\0` (or `\x00`) in the test
string. JavaScript reads both identically, so the parser and the assertion are unchanged.

## The control, and the card is not done without it

**The same `grep` that returns nothing today must find a known token in each file afterwards.**
Concretely, before the change:

    grep -c "parseLogMessage" src/shared/ipcPayloads.ts        → 0, exit 1
    grep -c "parseInspectReport" tests/unit/ipcPayloads.test.ts → 0, exit 1

and after it, both must return a non-zero count. **Without that pair the fix cannot be
distinguished from a cosmetic edit** — which is precisely the failure mode this card is about.

Also worth adding while there: a scan for control bytes outside string literals is cheap and
would have caught all three instances. Whether it belongs in `board:check`, in the lint, or
nowhere is a judgement, not a given.

## Not to be pushed while CI is the bottleneck

It touches `src/`, so it takes the full macOS suite. Henry has asked that it wait for the runner
queue to drain (room #167) and intends to take it.

## RESOLVED 2026-09-16 by Henry — escapes, the card's control, and a scan that keeps it so

**The fix, with no change in behaviour:** `src/shared/ipcPayloads.ts:54` now reads
`/[\x00-\x1f\x7f]+/g`, and `tests/unit/ipcPayloads.test.ts:686` ends its forged line with `\x00`.
All 187 `ipcPayloads` unit tests pass unchanged.

**The card's control, run as written:**

| | before | after |
| --- | --- | --- |
| `grep -c "parseLogMessage" src/shared/ipcPayloads.ts` | nothing, exit 1 | **1**, exit 0 |
| `grep -c "parseInspectReport" tests/unit/ipcPayloads.test.ts` | nothing, exit 1 | **14**, exit 0 |

**The scan, and where it lives:** a unit test, `tests/unit/no-control-bytes.test.ts`. That's the
engineering call on the card's open question. It isn't in `board:check`, which is about cards, and
it isn't a new lint. It runs in the unit job CI already has. It walks the text files under `src/`,
`tests/` and `scripts/` for bytes in `\x00-\x08\x0b\x0c\x0e-\x1f\x7f`, and fails naming file and
line. **Its own control:** on `main`'s two files it failed and listed exactly
`src/shared/ipcPayloads.ts:54` and `tests/unit/ipcPayloads.test.ts:686`. It also asserts that the
walk reached more than 100 files, including those two, so a walk that found nothing can't pass.
