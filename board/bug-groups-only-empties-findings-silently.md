---
title: "`groupsOnly` empties `findings` and `truncated` says nothing was cut"
column: done
owner: "Henry"
kind: bug
order: 47
---

FOUND BY ROOK in run 19, 2026-09-16, with a control. The smallest of run 19's five
and the card says so: a careful reader has `summary`. Not live-specific — headless does the same.

**Surface observed**, added 2026-09-16 by Henry on Rook's own catch: the `obsrv` MCP tools in this
repo run the package pinned in `.mcp.json`, `getobsrv@0.60.0` (tag `v0.60.0`, `31b77e8`), not `main`
or a local build. **So this was observed on the 0.60.0 release.** **Expected to hold on `main`, by
diff and not by observation:** between `v0.60.0` and `main` at `3552349`, no changed line in
`src/mcp/server.ts`, `src/shared/lint.ts`, `src/shared/audit.ts` or `src/main/ipc.ts` matches
`groupsOnly` or `truncated`. The diff over those files is not empty, the pattern matches `main`'s
source, and the same method finds #49's routing change, so the result is not a blind search. It is
still a reading, not an observation: behaviour can change through lines that do not use these words.
**Re-observe on a local build before fixing.**

## RESOLVED 2026-09-16 by Henry — one note, on both tools, both surfaces

**Re-observed on main first**, through the CLI's JSON that the MCP relays, each against its own
control without the flag:

| command | flag | `findings` | `truncated.findings` | `groups` | `summary` |
| --- | --- | --- | --- | --- | --- |
| `audit` | none | 1 | 0 | 1 | targets under: 1 |
| `audit` | `--groups-only` | **0** | **0** | 1 | targets under: 1 |
| `lint` | none | 6 | 0 | 6 | six rules counted |
| `lint` | `--groups-only` | **0** | **0** | 6 | six rules counted |

**The class is two, not one:** `lint` has the same silence as `audit`. The card was filed on audit.

**Zeroing `truncated.findings` was deliberate**, and its comment says why (`noListCut`: no list was
printed, so nothing was cut from one). The CLI's stderr always said *"the list left out"*. What was
missing was a sentence in the reply an agent reads, and that reply already declares `notes`, which
is where the register puts sentences about the call rather than the page. So nothing was changed
about the counter.

**The fix:** `GROUPS_ONLY_NOTE` in `src/mcp/server.ts`, pushed into `notes` at all four sites
(`audit` and `lint`, live and headless) whenever `groupsOnly` is set. *"`groupsOnly` left the
per-finding list out: `findings` is empty and `truncated.findings` is 0 because no list was printed,
not because nothing was found. Every finding is counted in `summary` and grouped in `groups`."* It is
an entry in an already-declared array, so no schema changes.

**Test:** `mcp.spec.ts`, *groupsOnly says the list was left out by request…*, on both tools. With
the flag: an empty list, a fixture that has groups, and the note exactly once. Without it: findings
listed, no note. **Passed with the fix (and its audit/lint neighbours, 5/5). Failed on `main`'s
server** at the note assertion, where audit's `notes` held only the headless-reason sentence.
**Stated plainly:** that control stopped at `audit`, the first tool in the loop, so `lint`'s absence
was shown by reading, not by watching it fail.

**Not observed live:** the live sites share the constant and the push, but no live `groupsOnly` call
was made for this change.

## The defect

A live `obsrv_audit` with `groupsOnly: true`:

    findings: []
    truncated: { findings: 0, targets: 0, text: 0 }
    summary.targets: { count: 3, under: 2, … }
    groups: [ { kind: "small-target", count: 2, … } ]

**`findings` and `truncated.findings` are the two fields that answer "were there findings", and
both say no.** Nothing echoes the request flag; `notes` and `warnings` are empty. Only
`summary.under` and `groups` disagree, in the same object.

**Control:** the same audit without `groupsOnly` returns two findings. So the empty list was
caused by the flag and not by the page — which is the distinction the reply does not draw.

## Why it is filed despite being minor

The list was omitted *by request*, so no information was lost to a caller who remembers its own
argument. It is filed because **`truncated.findings: 0` actively asserts the opposite** of what
happened: entries were left out of the list. Either that counter should reflect it, or a note
should say the list was omitted by request. The second is cheaper and `notes` already exists.
