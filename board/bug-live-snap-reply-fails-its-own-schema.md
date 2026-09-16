---
title: "Every live `obsrv_snap` reply fails its own output schema, and has since 0.26.0"
column: doing
owner: "Henry"
waiting: ""
kind: bug
order: 51
---

FOUND BY HENRY 2026-09-16, preflighting Rook's step 2 (`listTools()` in the MCP specs' `beforeAll`)
on a local tree of `main` + #65 + #68. Room #154.

**Surface observed:** that tree's MCP server, built locally, against a harness app from the same
tree, through the SDK's `Client`.

## The defect

With validation on, 4 tests in `mcp-live.spec.ts` fail, all of them live `obsrv_snap` (`:61`,
`:236`, `:315`, `:606`), with `McpError -32602 … data must NOT have additional properties` ×2.
Before `listTools`, the live reply carries two keys `snapOutputShape` doesn't declare: **`onionSkin`**
(0) and **`loading`** (false).

**Shipped.** The live snap reply has sent `onionSkin` since `521fa15` (in **v0.26.0**) and `loading`
since `1d9d094` (in **v0.28.0**). `snapOutputShape` lacks both at every tag through **v0.60.0**. So
any client that validates the published schema rejects every live snap. **Not established:** whether
Claude Code's own client validates. Rook's run 19 used live snap on 0.60.0.

## Why nothing caught it

The same as `bug-drive-reply-fails-its-own-schema`: `mcp-live.spec.ts` never listed the tools, so no
live reply there was validated.
