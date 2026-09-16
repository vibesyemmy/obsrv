---
title: "`onionSkin: 0` means off, unsupported, or too-old, and says which for none"
column: done
owner: "Henry"
kind: bug
order: 46
---

FOUND BY ROOK in run 19, 2026-09-16, with a control. Fix path from Henry.

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

## RESOLVED 2026-09-16 by Henry — main refuses before the renderer is asked, and says why

**Re-observed on a local build of `main` (`120a94c`) first**, through the control server, with
`status` and main's reference sampled every 50 ms. **It was wider than this card:**

| on `main` | reply | what followed |
| --- | --- | --- |
| `setOnionSkin 0.5`, from off, on `laptop-768` | `applied: true, onionSkin: 0` (**6 of 6**) | 0 → 0.5, reference made |
| `setOnionSkin 0.5`, from off, on `ultrawide-34` | `applied: true, onionSkin: 0` | 0 → **0.5** → 0, no reference, no warning |

**The reply confirmed before anything happened.** The check was `=== value || === 0`. The `|| 0`
was there so a refusal could confirm, and it accepted the 0 from *before* the patch. So what `drive`
read back depended on how soon after that reply it read `status`. Rook's two readings, 0 on
ultrawide and 0.5 on the laptop, were both true of the moment they were read, and neither reply
had waited for them.

**The fix:** main answers "can this viewport have a reference" before the renderer is asked, with
`onionSkinRefusal` in `src/shared/onionSkin.ts`. It uses the same `referenceFits` and `MAX_VIEWPORT`
that `TabSession.setReference` refuses by, on the viewport once any resize has landed (waited for
without clearing the pending flag a later capture needs). A refused skin isn't sent to the
renderer. A skin still showing is turned off, and the reply is `applied: false` with the sentence in
`warnings`, which `drive` carries into its own `warnings`. Otherwise the confirmation waits for the
exact value. For `ultrawide-34`: *"the onion skin was left off: it blends a 2x render of the page
over the target, and at this 3440x1440 viewport that render would be 6880x2880 device px, past the
4096 px limit; a screen up to 2048 CSS px on each side can have one"*. `drive`'s `warnings` is
already declared, so no schema changes. Both descriptions of `onionSkin` now name the third meaning.

**On the fix, the same probe:** from off on `laptop-768` the reply is `0.5`, 6 of 6. On
`ultrawide-34` it's `applied: false`, `onionSkin: 0`, one warning, and `status` never reads 0.5.

**Tests:** `onion-skin.spec.ts`, *the reply is the skin in force…*, plus the 4K refusal test,
extended with `applied: false`, the warning naming the viewport, and a second of `status` reads that
must all be 0. `mcp-live.spec.ts`, *an onion skin the screen cannot have reads back 0 and says
why…*, with a screen that fits as its control. **Fix:** the whole `onion-skin.spec` file 7/7, the
`drive` test 1/1. **Control (`main`'s `controlServer.ts`, `ipc.ts`, `mcp/server.ts`):** all three
new tests failed, at the reply value, `applied`, and the warning.

**One limit of that `drive` test, found while writing it:** `mcp-live.spec.ts` never calls
`listTools`, so the client validates no reply in that file. Probed with validation on, *every*
`drive` reply on `main` is rejected, for three undeclared keys that have nothing to do with the onion
skin. That's reported in the room, and it's being fixed on its own.

**The other set-and-read-back fields, as this card asked**, by reading: `textScale` confirms on the
exact value and has no refusal path. `vision` replies `ok` and `drive` doesn't read it back.
`throttle` confirms on the exact value, but a refusal from Chromium is only logged (`applyThrottle`
returns it and the IPC handler `log.warn`s it), so `status` would name a throttle that isn't in
effect. Reaching that needs a second debugger client, which wasn't tried.

**Not fixed here, filed:** `bug-onion-skin-dies-on-a-preset-round-trip`. A skin that's on survives a
trip through a screen too big for it as `0.5` with no reference, even back on a screen that fits.
