---
title: "The stderr/log-only category c5 set aside was undercounted, and UI-only was never counted at all"
column: backlog
kind: chore
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
