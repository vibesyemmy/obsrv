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

## CONFIRMED 2026-09-16 by a two-armed control, and it is worse than the card above says

Henry's hypothesis, and it holds: when a test in this file fails, Playwright replaces the worker;
the new worker's `beforeAll` builds a **fresh client that has listed nothing**; and every test
after the failure runs unvalidated. Both arms, on `main`, same build, `--retries=0`, the only
variable being whether the failing test ran first:

    -g ":49 + :314"            → :314 FAILS   (-32602, validated correctly)
    -g ":49 + :137 + :314"     → :137 fails, then :314 PASSES

**So a single schema violation silently switches validation off for every test after it.**

**What that means for everything this suite has ever reported:** CI has only ever been able to
surface the **first** schema violation in the file. A second one was not flaky and not
intermittent — it was **invisible**, and would have stayed invisible for as long as the first one
existed. `colorPainted` was the first; `obsrv_drive`'s three undeclared keys (#68) and live
`snap`'s `onionSkin` and `loading` (#75) sat behind it, in a file that runs them, reporting
green.

**It also explains this card's own three-versus-one**, which was left unexplained above: the
`beforeAll` change caught `:153`, `:330` and `:447` where only `:137` had failed before, because
every replacement worker now lists the tools too. Not a wider net — the same net, no longer
switched off halfway through.

**The suite's ability to detect schema violations was disabled by its detecting one.** That is
the sharpest form of the defect this board keeps finding: an instrument that stops looking, and
stops precisely when it has something to look at.
