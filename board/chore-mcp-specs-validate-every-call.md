---
title: "The MCP specs only validate replies after `tools/list` runs — so a retry turns validation off"
column: done
kind: chore
owner: "Rook"
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

## What is left, 2026-09-16 — this card is NOT done

Asked by Wren, because the section above reads like a close and names no remaining step. It reads
that way because the *explanation* finished; the *fix* did not. **The `listTools()` call was added to
two specs. Three more build their own client and never list at all**, so every MCP reply they
receive is unvalidated, which is precisely this card's defect:

| spec | `listTools` | `callTool` |
| --- | --- | --- |
| `mcp.spec.ts` | yes | — fixed |
| `mcp-live.spec.ts` | yes | — fixed |
| **`dev-lane.spec.ts`** | **0** | 1 |
| **`mcp-electron.spec.ts`** | **0** | 1 |
| **`surface-parity.spec.ts`** | **0** | 2 |
| `throttle-refused.spec.ts` | 1 | 2 — lists, so check only the ordering |

Each of the three is the same shape: `new Client(…)` → `connect(…)` → `callTool(…)`, with nothing
in between. `mcp-electron.spec.ts:46`, `surface-parity.spec.ts:81`, and `dev-lane.spec.ts`.

**Worth noticing where one of them sits.** `surface-parity.spec.ts` is the spec
`lesson-agreement-two-facts` is about — a card whose whole subject is a check that agreed with
itself while measuring nothing. Its own MCP replies are going unvalidated at the same time.

**Not closing this by fixing them here**, because the fix is four one-line additions across four
specs and each one can turn a green spec red the moment validation starts — which is the point of
it, and wants its own run rather than riding on a tidy-up.

## Closed 2026-09-16: every spec now lists before its first call

`#128` added `listTools()` to `dev-lane`, `mcp-electron` and `surface-parity`. **`throttle-refused`
needed no change** — it already listed before its calls, which is why the row above said "check only
the ordering" rather than counting it as broken.

Verified on `main` rather than assumed, and the verification needed a second look:

| spec | `listTools` | first `callTool` |
| --- | --- | --- |
| `mcp` | 43 | 63 |
| `mcp-live` | 63 | 74 |
| `dev-lane` | 69 | **47** |
| `mcp-electron` | 63 | 78 |
| `surface-parity` | 97 | 112 |
| `throttle-refused` | 133 | 163 |

**`dev-lane` reads wrong and is right.** Its line 47 is the *definition* of the `call` helper, not an
invocation; the helper runs inside tests, which run after the `beforeAll` that lists at 69. A
line-number comparison would have filed a false alarm here — the sort of check that looks like a
measurement and is really a proxy for one.

**And the change was shown to switch validation on, not merely to be present:** an undeclared key was
injected into `obsrv_audit`'s `structuredContent` and `mcp-electron` run both ways on the same build
— with `listTools()` it failed, without it passed.
