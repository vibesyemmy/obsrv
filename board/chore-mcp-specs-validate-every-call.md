---
title: "The MCP specs only validate replies after `tools/list` runs — so a retry turns validation off"
column: doing
kind: chore
owner: "Rook"
waiting: ""
order: 48
---

FOUND BY ROOK 2026-09-16, while investigating `bug-inspect-readout-schema`. The mechanism for the
82 "flaky" `mcp.spec:137` tries on `bug-flakes-gate-the-gate`.

## The defect

The SDK client validates a tool reply against its output schema **only if it has cached that
tool's schema**, and it caches on `listTools()`:

    // client/index.js:489
    const validator = this.getToolOutputValidator(params.name)
    if (validator) { …validate structuredContent… }

`mcp.spec.ts` calls `listTools()` in **test `:49`**, not in `beforeAll`. So validation is on for
every call *after* that test and off for anything that runs without it.

**Which makes the retry the problem.** Playwright re-runs only the failed test on a retry, with a
fresh `beforeAll` client. Test `:49` does not re-run. **No schema is cached, nothing validates,
and the test passes.**

    first attempt   whole file runs → :49 caches the schema → reply validated → RED
    retry           only the failed test runs → no :49 → no validator → GREEN

**So `--retries=1` was not absorbing a flake. It was removing the check.** `mcp.spec:137` failed
its first attempt and passed on retry 82 times since 09-13, and every one of those greens was a
run with validation switched off. The card that counted them called it noise; it was a
deterministic rejection plus an instrument that stopped looking.

**Confirmed both ways on one build** (`out/mcp/server.js` stamped 13:32, built in the same task,
so not a stale-build artefact):

    npx playwright test tests/e2e/mcp.spec.ts --retries=0            → :137 RED, -32602
    npx playwright test … -g "name why they ran headless"            → 6/6 GREEN

The filtered runs excluded `:49` for the same reason a retry does. **I built that blind
instrument myself by narrowing the command**, which is worth recording: the failure mode is not
exotic, it is one flag away in ordinary use.

## What this card does

Call `listTools()` once in `beforeAll` of **`tests/e2e/mcp.spec.ts`** and
**`tests/e2e/mcp-live.spec.ts`**, so every call in either file is validated regardless of which
tests run, in what order, or on which attempt.

## The control, which is the whole point and must come first

**On current `main` this change must go RED**, catching at least `obsrv_inspect`'s `colorPainted`
and `obsrv_drive`'s three undeclared keys. A green on main would mean the change did nothing.

It goes green only once **#65** (`colorPainted` declared) and Henry's `driveOutputShape` PR have
both landed. **This must not be opened for merge before both**, or it lands red.

**And the second control, because this card is about an instrument that stopped looking:** force
a failure and confirm the **retry** is validated too. If a retry still passes where the first
attempt failed, the fix has not reached the case it was written for.

## What it does not do

It does not make the sweep see `obsrv_drive` — `scripts/schema-emit-sweep.js:115` skips it by
design, and that is its own gap with a known instance. Separate card.
