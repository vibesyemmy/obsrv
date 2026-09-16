---
title: "`obsrv_inspect` returns a field its own schema forbids, and a retry hides it"
column: doing
kind: bug
owner: "Henry"
order: 35
---

FILED 2026-09-15 by Henry. Diagnosed to the line; the fix is a decision, not a typo.

## HANDED OVER AGAIN 2026-09-16, Rook → Henry, while Rook is out until 13:00

Rook ran out of tokens minutes after the decision reached him (room #132). Opeyemi asked, through
Wren, that tasks go to Henry for the hour. **Unstarted when it moved**, so nothing is lost. The
decision stands as #132 gave it: add `colorPainted` to `obsrv_inspect`'s output schema, name it in
`docs/breaking-changes.md`, restart note. If it is still in flight at 13:00 it stays with Henry.

## HANDED OVER 2026-09-16, Kenya → Rook, while Kenya is out until 13:30

On Opeyemi's word (room #85, confirmed to Wren in its session; fired by Wren at 11:06 WAT after
Opeyemi said Kenya is out). **If this is unfinished at 13:30 it returns to Kenya with a note of
what changed.** Queued behind run 19, which only works while Opeyemi is at the desk.

**Kenya did not post "out", so the split below is reconstructed by Wren** from Kenya's DMs and
room #84/#99 — a reader should weigh it as a handover summary, not as Kenya's own words.

**Established:**
- **The decision is made: add the field.** Opeyemi, to Wren, 2026-09-16: add `colorPainted` to
  `obsrv_inspect`'s output schema, name it in `docs/breaking-changes.md`, ship the restart note.
  The second option below (stop emitting it on MCP) is **not** being taken.
- The rejection is **client-side**: the SDK client validates the reply against the JSON Schema and
  rejects it (`client/index.js:502`). **The server checks too, and its check passes**: SDK 1.30.0
  `server/mcp.js:204` runs `safeParseAsync` on the structured content, and a plain `z.object`
  strips unknown keys rather than failing. So nothing server-side ever errors. *Corrected
  2026-09-16 by Wren on Henry's catch, verified against the installed SDK. The first version of
  this handover said the server does not check, copied from the sweep section below, which says
  the same and is superseded on that point.* It also makes `.strict()` on the server-side schema
  a fix option: the server would then catch an undeclared key itself.
- It is **one field**: the sweep found `readout.colorPainted` and nothing else on the paths it
  exercised; `lint` is clean (section below).
- `mcp.spec:137` has been flaky on this bug **82 times** across CI attempts since 09-13
  (`bug-ci-main-red-37pct`, remeasured 2026-09-16).

**Hypothesis, not yet observed:**
- That adding the key makes `mcp.spec:137` green. Predicted from the mechanism; nobody has run it.
- That `inspect`'s CLI stdout contract is unaffected. The card says to confirm rather than assume.

**Not handed over:** `bug-sync138-no-url-changed` (held for Kenya, its framing) and
`bug-target-canvas-no-frames` (blocked; moving a blocked card's owner makes it look advanced).

## It is not a flake, and it has been mislabelled as one all day

`tests/e2e/mcp.spec.ts:137` has failed its **first attempt in seven of seven observed runs** and
passed on retry every time. It was counted four separate times today as a flake absorbed by
`--retries=1`, and filed on `bug-flakes-gate-the-gate` as *a consistent failure being concealed
by a retry*. That was right about the concealment and wrong about the cause. **Nobody read the
error, including the person who counted it four times.**

The error:

    McpError: MCP error -32602: Structured content does not match the tool's output schema:
      data/readout must NOT have additional properties,
      data/readout must be null,
      data/readout must match a schema in anyOf

## The cause, to the line

`InspectReadout` carries **`colorPainted`** — `src/shared/inspectReadout.ts:78`, emitted at
`:176`. The MCP output schema for `readout` (`src/mcp/server.ts:1884`, `readoutShape`) does not
list it: zero occurrences across the whole shape.

The shape is `additionalProperties: false`, so the server validates its own correct reply and
rejects it.

It arrived in `f8d734f` — *"Print the colour the screen shows, and let opacity reach the
verdict"* — the contrast fix. That change added a field to the readout and did not add it to the
schema.

## Why this matters more than one red test

**This is the exact defect `docs/compatibility.md` leads with**, happening to Obsrv's own
server rather than to a stale client:

> On the MCP surface, adding a field is a breaking change.

The policy was written on 2026-09-15 and says the constraint *"is why three separate designs
were decided this week the way they were"*. It did not catch the instance already shipped. So
the document describing the trap and the code falling into it have coexisted for a day.

**And the user-visible consequence is not a red test.** An agent calling `obsrv_inspect` gets a
protocol error instead of a readout. The e2e suite sees it as a flake because the retry gets a
different code path or a re-established session; a caller in the field gets `-32602` and no
measurement.

## What the fix has to decide, which is why this is not a one-line patch

Adding `colorPainted` to `readoutShape` is the obvious move and is **itself a breaking change on
the MCP surface** by the policy's own rule — a client holding the old schema will reject a reply
carrying the new key. So the fix is a release decision, not a typo fix:

- add the field to the schema, name it in `breaking-changes.md`, and ship the restart note; or
- stop emitting `colorPainted` on the MCP surface and keep it to the CLI, which is a different
  product decision about who the painted colour is for.

`inspect`'s CLI stdout is a separate contract and is not affected by this — worth confirming
rather than assuming, since the two surfaces share `inspectReadout`.

## What to check before fixing, because one instance is not the class

**`colorPainted` was found by reading one error.** Nothing has compared the full set of fields
every MCP tool emits against what each tool's schema allows. `lint` shares `inspectReadout`
(`src/shared/lint.ts`), so it is the first place to look. A diff of produced keys against schema
keys, per tool, is a script somebody can write once — and it is the check that would have caught
this the day `f8d734f` landed.

## The reading lesson, recorded because it cost a day

Four times this test's ✘/✓ marks were counted and its error never opened. The counting answered
*is this a real failure or a retry rescue* and was correct; it cannot answer *why*, and nothing
prompted the next question. **A test that fails identically every run is not flaky — it is
reproducible, which is the easiest kind of bug to fix and the easiest to mistake for noise when
a retry keeps rescuing it.**

---

## SWEPT 2026-09-15 by Kenya, on assignment. **One instance on the paths exercised — and the card's mechanism is wrong in a way that makes this worse, not better.**

**THE SERVER DOES NOT REJECT ITS OWN REPLY. THE CLIENT DOES.** This card says *"the shape is `additionalProperties: false`, so the server validates its own correct reply and rejects it."* Measured: a raw JSON-RPC client that does no validation **receives the reply with `colorPainted` in it**. The check lives at `node_modules/@modelcontextprotocol/sdk/dist/cjs/client/index.js:502` — `McpError(InvalidParams, "Structured content does not match the tool's output schema")` — and `server/mcp.js` has no such check at all. *(Superseded on this point, 2026-09-16: SDK 1.30.0 `server/mcp.js:204` does run `safeParseAsync` on structured content; a plain `z.object` strips the unknown key, so the check passes rather than being absent. The conclusion beside it, that nothing server-side ever errors, stands. — Wren, on Henry's catch.)*

**So the defect is invisible from the server's side and breaks every client that validates.** `mcp.spec:137` fails because the SDK client validates; an agent in the field gets `-32602` for the same reason. Nothing server-side will ever notice, which is why it survived a day of being counted.

## The sweep, and what it can and cannot say

`scripts/schema-emit-sweep.js` (`npm run schema:sweep`) drives the real MCP server over stdio as a client does, calls every tool, and diffs **every key path the reply carries** against **every key path the tool's own `outputSchema` declares**:

    obsrv_snap       ok
    obsrv_diff       ok
    obsrv_audit      ok
    obsrv_lint       ok
    obsrv_report     ok
    obsrv_drive      skipped — launches and drives the visible app
    obsrv_inspect    EMITS UNDECLARED KEYS    readout.colorPainted
    obsrv_presets    ok

**`lint` is clean**, which the card expected to be the first place to look because it shares `inspectReadout`. On the path exercised, it does not emit the field.

**WHAT THIS CANNOT SEE, and it is the whole limit of the result:** a field emitted only on a code path these calls do not take. `colorPainted` is itself conditional. **A clean line means "no violation on the paths these calls exercise" — never "the schemas and the emitters agree."** The sweep is a floor, exactly as the flake tally was.

**What would raise the floor:** calling each tool across the fixtures that exercise its branches rather than one fixture each, and running it in CI so a new field is caught the day it lands rather than by whoever next reads an error. Neither is done here.

## What is still a decision rather than a finding

Unchanged by the sweep: adding `colorPainted` to `readoutShape` is **itself breaking** on the MCP surface by `compatibility.md`'s inverted rule, so the fix is *add it and name it in the register*, or *stop emitting it on the MCP surface and keep it to the CLI*. That is a product question about who the painted colour is for, and the sweep's answer — **one field, not twenty** — is what the decision needed.

