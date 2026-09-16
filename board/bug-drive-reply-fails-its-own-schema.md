---
title: "Every `obsrv_drive` reply on `main` fails its own output schema"
column: doing
owner: "Henry"
waiting: ""
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
