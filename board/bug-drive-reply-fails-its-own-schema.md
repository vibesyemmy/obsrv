---
title: "Every `obsrv_drive` reply on `main` fails its own output schema"
column: done
owner: "Henry"
kind: bug
order: 50
---

FOUND BY HENRY 2026-09-16, while checking whether `bug-onion-skin-zero-means-three-things`'s `drive`
test is schema-validated. It isn't, and neither is any other test in its file. Room #148.

**Surface observed:** `main`'s MCP server, built locally from `120a94c`, against a live app built
from the same tree, through the SDK's `Client`.

## The defect

`driveOutputShape` is `additionalProperties: false`. `drive` spreads the app's `status` into its
reply, and `status` now carries three keys the shape doesn't declare:

| key | value seen | arrived in |
| --- | --- | --- |
| `deviceScaleFactor` | 1 | `5214d59` |
| `visionType` | `"none"` | `257e2db` |
| `visionSeverity` | 1 | `257e2db` |

**With the client's validator cached** (`listTools` first), `drive { onionSkin: 0 }` and
`drive { preset: '4k-27', onionSkin: 0.5 }` both fail:
`McpError -32602 … data must NOT have additional properties` ×3. **Positive control:** live
`obsrv_inspect` in the same client is rejected for `colorPainted` (`bug-inspect-readout-schema`), so
validation was on. **Before `listTools`**, the same call returns, carrying exactly those three keys.

**Unreleased.** Neither key is in `src/shared/control.ts` at `v0.58.0`, `v0.59.0` or `v0.60.0`,
which is why the pinned 0.60.0 tools never showed it. **0.61.0 would ship `drive` broken for every
validating client.**

## Why nothing caught it

`tests/e2e/mcp-live.spec.ts` never calls `listTools`, so no live MCP reply in that file has ever
been validated. It's the mechanism Rook found for `mcp.spec:137` (room #146), applied to a whole
file.

## The fix

Declare the three in `driveOutputShape`, as the register already does for `deviceScaleFactor` on
the other tools, and name them under 0.61.0. Then make the live file validate: `listTools()` in
`beforeAll`, which is proposed in room #148 as its own step.

## RESOLVED 2026-09-16 by Henry — the three keys are declared

**The fix:** `visionType` (a string, `'none'` when off), `visionSeverity` (a number) and
`deviceScaleFactor` (an optional number) are declared in `driveOutputShape`, each with a description
that says what an older app reports. `drive` is the only tool that spreads `...status` into its
reply, and on `main` every other key `parseControlStatus` returns was already declared, so these
three are the whole set. The register names the addition under 0.61.0.

**Where the keys came from, as Wren asked it to be recorded:** `deviceScaleFactor` from Wren's C4
commit `5214d59`, which declared it for `snap` and `inspect`, and `visionType`/`visionSeverity`
from `257e2db`. Wren's parity gate covered the tools that have two surfaces, and `drive` has only
one. `schema:sweep` skips `drive` by design (Rook's read of #65). `mcp-live.spec.ts` never listed
the tools. So nothing could see it.

**Test:** `mcp-live.spec.ts`, *an obsrv_drive reply passes its own output schema…*, with its own
`Client`, so the file's shared client is untouched until `listTools()` moves into `beforeAll` (Rook,
step 2). It lists the tools, asserts that the SDK holds a validator for `obsrv_drive`, so the
check can't be vacuous, calls `drive`, and asserts that the three keys are in what was checked.
**Fix:** 4/4 with three `drive` neighbours. **Control, `main`'s `mcp/server.ts`:** failed with
`McpError -32602 … data must NOT have additional properties`.
