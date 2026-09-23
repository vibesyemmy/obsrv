---
title: "The stderr/log-only category c5 set aside was undercounted, and UI-only was never counted at all"
column: review
kind: chore
owner: "Henry"
waiting: "Idris: the gate on the PR"
criterion: C5
order: 110
---

FILED BY KENYA 2026-09-21, opening the gap `c5` named on its own closure (`#414`) rather than leaving
it as a parenthetical: *"a sentence reaching only stderr, only the app's UI, or only the log file was
outside [the net], and the inventory says so up front... nobody has swept for the rest."*

## What a first-pass grep found, and why it is not the answer

`c5`'s own ten-set-aside figure ("eight `log.warn`, two `strictOutput.ts` stderr lines") came from a
**TypeScript-compiler sink-tracing pass** (173 sinks → 121 producers, `board/c5.md`'s step 1). What
follows is a plain `grep` — cheaper, and **the wrong instrument for a final count**, the same lesson
this room relearned three times today (`#1556`). It is good enough to say the ten-figure needs a
second look and that UI-only has nothing at all, not good enough to replace either.

**Log/stderr, re-counted:** `grep -n "log\.warn(\|log\.error("` in `src/` finds **11 call sites**, not
ten:
- `src/main/targetSource.ts:508`, `src/main/syncBus.ts:236`, `src/main/ipc.ts:1339`, `:1456`, `:1513`,
  `:1696`, `:2117` — seven fixed template-literal sentences.
- `src/main/index.ts:165` (`if (d.type === 'GPU') log.warn(line)`) and `src/main/ipc.ts:555`
  (`if (refused) log.warn(refused)`) — **two passthroughs**, logging a message built elsewhere, not
  producing their own sentence. Possibly why `c5`'s pass called the fixed set "eight" and these two
  something else; possibly not — I can't reconstruct the sink-tracing pass's own criteria from a grep,
  and I'm naming the gap rather than guessing at it.
- `src/main/index.ts:61` (`log.error('shell renderer gone...')`) and `src/main/ipc.ts:2095`
  (`log.error('agent-control server failed to start', e)`) — **two `log.error` calls not mentioned
  anywhere in the ten-set-aside tally**, under either reading.
- `src/mcp/strictOutput.ts:92` and `:109` — confirmed, these are the two stderr lines already named.

So the log/stderr side is at minimum **11 candidates against a stated 10**, and two of those eleven
(`log.error`) appear to have never been counted in any pass.

**UI-only, swept for the first time:** grepping `src/renderer/src` for user-facing status/error text
that never touches `notes`/`warnings`/`log.*` at all — the category `c5`'s own method section named as
structurally outside its net — turns up at least:
- `src/renderer/src/App.tsx:420` — `'Could not read that file'` (toast on a failed drop/paste).
- `src/renderer/src/components/EmptyState.tsx:30` — `'That address could not be loaded.'`
- `src/renderer/src/components/SettingsPanel.tsx:211` — `` `Not saved: ${e instanceof Error ? e.message : String(e)}` ``.
- `src/renderer/src/components/SettingsPanel.tsx:451` — `'Couldn’t check'` (update-status error).

This is a **first pass, not a sweep** — a keyword grep for `error`/`failed`/`could not` misses anything
phrased differently and cannot tell a user-facing sentence from a dev-only string, the same
undercount/overcount shape `c5`'s own method section warned about for the notes/warnings net.

## Acceptance

- the log/stderr eleven reconciled against `c5`'s ten by the same method `c5` used (sink-tracing, not
  grep) — either the discrepancy is explained (a passthrough doesn't count, say why) or the two
  `log.error` calls are added to the inventory as their own row;
- a real UI-only sweep — ideally sink-traced from what actually renders in `src/renderer`, not a
  keyword grep — producing a count this card's four-item first pass can be checked against;
- each surviving sentence gets one of `c5`'s three outcomes: observed to fire, a fixture that could
  make it fire, or a named reason it can't be observed (e.g. `SettingsPanel.tsx:211`'s save-failure
  path may need a forced IPC rejection, the same shape as other named-reason rows already in
  `docs/note-inventory.md`);
- `docs/note-inventory.md` gets a section for this category with the same rigor as the rest of the
  doc, rather than the two-line mention it has now.

## COUNTED 2026-09-23 by Henry — with the compiler, and the number moved twice on the way

`docs/note-inventory.md` has the section this card asked for. The headline numbers:

- **the log route is 22 call sites**, not ten and not eleven. Kenya's eleven is **confirmed** for
  `warn`+`error` (9 own sentences, 2 passthroughs), so the gap with `c5`'s ten is real and the two
  `log.error` calls are what no pass had;
- **`log.info` was never looked at** — eleven more sites, eight of them own sentences. The category is
  *a sentence reaching only the log file*, and `log.info` is exactly that. **The category had been scoped
  by its instrument rather than by its definition**: both earlier passes grepped `warn|error`;
- **a third route nobody had counted** — `window.obsrv.log(...)` in the renderer reaches the log through
  `ipc.ts:448`'s passthrough. **Seven** producers, all the WebGL context-loss sentences in
  `TargetCanvas.tsx`. Counting the sink found one line; the sentences are seven;
- **UI-only: 174 sentence-shaped literals across 35 renderer files, of which 6 are user-facing status**
  set through a state setter. Four are the four this card named; **two are new**, and a second
  `Not saved:` exists in `DiagonalHint.tsx` that the keyword pass could not reach.

### Why the count is a floor, and the part worth keeping

**It moved twice while I was looking at it, and each earlier filter was silently dropping real
sentences** — 134, then 153, then 174. The first excluded anything containing a colon, to skip CSS. The
second used a template's source text, so `${`…`}` tripped a brace test and **every interpolated template
vanished** — including `SettingsPanel.tsx:211`, which is one of the four items this card names.

**The card's four named items are what caught both.** Without a known answer to check against, each
filter looked finished. **A sweep with no known answer to check against reports its own blind spots as
zero** — which is the same failure, in a different instrument, that this card was filed to correct in a
grep.

### Acceptance, against what was asked

| asked | done |
| --- | --- |
| the eleven reconciled against ten by sink-tracing, not grep | **yes** — compiler pass, 22 sites classified by argument kind; the two `log.error` calls named as their own row |
| a real UI-only sweep, not a keyword grep | **yes** — all literals in all 35 renderer files, classified by syntactic context |
| each surviving sentence gets one of `c5`'s three outcomes | **no** — not attempted here |
| `docs/note-inventory.md` gets a section with the rest of the doc's rigor | **yes** |

**The third bullet is open and I am not claiming it.** Observing 6 UI sentences and 24 log sentences fire
means forcing a failed file read, an unsupported drop, a settings save rejection, a WebGL context loss
and a second-instance launch. That is a fixture programme, not a counting job, and it belongs to whoever
takes it with that scope in front of them.
