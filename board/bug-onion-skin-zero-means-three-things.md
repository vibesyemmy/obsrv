---
title: "`onionSkin: 0` means off, unsupported, or too-old, and says which for none"
column: next
kind: bug
order: 46
---

FOUND BY ROOK in run 19, 2026-09-16, with a control. Fix path from Henry. **Unowned.**

**Surface observed**, added 2026-09-16 by Henry on Rook's own catch: the `obsrv` MCP tools in this
repo run the package pinned in `.mcp.json`, `getobsrv@0.60.0` (tag `v0.60.0`, `31b77e8`), not `main`
or a local build. **So this was observed on the 0.60.0 release.** **Expected to hold on `main`, by
diff and not by observation:** between `v0.60.0` and `main` at `3552349`, no changed line in
`src/mcp/server.ts`, `src/main/ipc.ts`, `src/shared/control.ts` or `src/shared/types.ts` matches
`onionSkin` or `onion`. The diff over those files is not empty, the pattern matches `main`'s source,
and the same method finds #49's routing change, so the result is not a blind search. It is still a
reading, not an observation: behaviour can change through lines that do not use these words.
**Re-observe on a local build before fixing.**

## The defect

`obsrv_drive` with `onionSkin: 0.5` at `ultrawide-34`:

    onionSkin: 0        (no warnings, no note)

The behaviour is correct and documented — the app cannot render a 2x reference for that viewport
at 1x. **The reply does not carry it.** An agent that sets a value and reads it back to confirm
its own command took effect cannot tell *you turned it off* from *I could not do it*.

**Control:** the same command at `laptop-768` returns `onionSkin: 0.5`. So the readback works
and the `0` is a real refusal rather than a dead field. Without that control the finding would
not be worth filing.

## Three facts, one value

The field's own description (`src/mcp/server.ts:713`) names **two** meanings of `0`: off, and an
app older than the field. **The third — this viewport cannot have one — is the one an agent
actually hits, and it is not in the list.**

## The fix is free, which is the argument for doing it now

`driveOutputShape` already carries `warnings: z.array(z.string()).optional()`
(`src/mcp/server.ts:774`). A sentence — *"onion skin needs a 2x reference, which this viewport
cannot render at 1x; left off"* — costs no schema change and is not breaking under
`compatibility.md`. Henry established both line references.

Worth checking while there: whether any other set-and-read-back field on `drive` has the same
shape — `throttle`, `textScale` and `vision` are all settable and all read back.
