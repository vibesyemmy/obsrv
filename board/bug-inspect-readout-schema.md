---
title: "`obsrv_inspect` returns a field its own schema forbids, and a retry hides it"
column: next
kind: bug
order: 35
---

FILED 2026-09-15 by Henry. **Unowned.** Diagnosed to the line; the fix is a decision, not a typo.

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
