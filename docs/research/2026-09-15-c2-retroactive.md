# Applying the compatibility policy to 0.56.0–0.60.0

Done 2026-09-15 by Rook for `c2-retroactive`. Four of the five releases had no
register entry; 0.59.0 had one.

**Result: no register entries were added, and the policy has a hole that
matters more than the entries would have.** The hole is that the policy and the
two documents it depends on all postdate every release in scope.

## The rules were written down before any diff was read

`scratchpad/c2-rules.md`, derived from `compatibility.md` alone: M1–M4 on the
MCP surface, C1 on the CLI's stdout keys, S2/S3 on the control server, E1 on
exit codes, T1 on documented thresholds — plus four ambiguities recorded in
advance so they could not be resolved by convenience later. Pre-registering
them is the only reason the "clean" results below are worth anything.

## What was verified, and how

| Surface | Method | Result |
| --- | --- | --- |
| CLI stdout key set | `cli.spec.ts`'s exact `Object.keys(json).sort()` assertion, read per tag | **unchanged** across all five: 9 keys, `url` arriving in 0.61.0 which is documented |
| MCP output shapes, top level | property names per shape per tag, from `src/mcp/server.ts` | **unchanged** across all five |
| Control server commands | `CONTROL_COMMANDS` per tag | **unchanged**: 30 commands, none added or removed |
| Exit codes | the CLI's `ArgError ? 2 : 1`, and `bin/obsrv.js`'s exits | **unchanged** |
| `additionalProperties: false` | asked the built MCP server over stdio | **true** — the policy's founding constraint holds on the wire |

The last row matters because everything else rests on it, and it cannot be
grepped: the schemas are zod shapes converted by the SDK, so the string appears
nowhere in `src/`.

## Two of my four instruments were vacuous, and a control caught both

Neither would have been noticed from its output.

**The shape parser.** The first version counted braces by hand. Run against a
known change — `presetId` and `profileId` removed from `snapOutputShape`, which
the register already documents for 0.61.0 — it missed additions and invented
removals. Rewritten to match the file's own formatting, it finds that removal,
and an independent `awk` count of the same block agrees on 30 fields.

**The nested-field check did not work and is reported as nothing, not as
clean.** It returned *92 distinct property names at every tag including HEAD*,
where a known removal exists. Saturated and insensitive. So **whether a field
was added deeper than the top level of a shape is unchecked** — and under this
policy that would be breaking. It is the largest gap in this pass.

My first control was also wrong, before either of those: I expected 0.61.0's
documented `url` addition to show in the MCP shapes. It is on the **CLI stdout**
surface. Same field name, different contract — which is the confusion the
policy's four-surface section exists to prevent, arriving in the person applying
it.

## What the silent releases actually shipped

Read from commit subjects and then the commits themselves:

- **0.56.0** (5 files): one coverage-note rewording.
- **0.57.0** (9 files): sentences that name their own subject, plus a page's
  HTTP status reaching the answer. Its own commit message settles the case that
  looked strongest going in: *"`url` still means the address that was asked for
  … the MCP output schemas are additionalProperties: false, so where the
  figures came from is said in a note rather than by changing a field."* The
  author was already applying the constraint the policy later wrote down, and
  chose notes precisely to avoid a break.
- **0.58.0** (10 files, the largest in range): the shadow-share floor gains a
  companion **count**, ORed with the share. A threshold change, not a schema
  change — permitted in a minor where the number is a judgement, and the commit
  argues the judgement at length with per-site measurements.
- **0.60.0** (1 file): a toggle during the opening window is held rather than
  dropped.

Under the policy as written, none of these requires a register entry. Wording
is explicitly not a contract; a new note is not a field; a threshold is
permitted in a minor.

## The hole: the policy is younger than everything it is being applied to

```
docs/thresholds.md        created 2026-09-14   absent at v0.58.0 and v0.60.0
docs/breaking-changes.md  created 2026-09-14   absent at v0.56.0 and v0.60.0
docs/compatibility.md     created 2026-09-15   absent at all five
```

Two rules become undecidable rather than satisfied:

- **T1** — "a documented threshold moving without `thresholds.md` moving with
  it" — cannot be violated by 0.58.0, because there was no `thresholds.md` to
  move and no threshold was *documented* in the sense the rule means. The rule
  does not say whether that makes the release compliant or unjudgeable.
- **The announcement requirement** — "an entry in the register, and the release
  notes say it too" — is unmeetable retroactively for the same reason. An entry
  added today is not an announcement to anyone who upgraded in that window.

This is not a technicality about dates. The policy's force comes from telling a
user *at the moment they upgrade*; applied backwards it can only produce a
record, and the register's own purpose — "where it stays findable six months
later" — is the half that still works. Worth saying in the policy rather than
leaving the next person to rediscover it.

## The four ambiguities, after the exercise

Recorded before reading; none was resolved by it, and two now have evidence.

- **A1, whether a CLI stdout key addition earns an entry.** 0.61.0 answered it
  in practice — it has one — so the register is ahead of the policy text here.
- **A2, whether a new MCP tool is breaking.** Untouched by this window and
  still undecided by the text. A new tool does not appear in an old client's
  replies, so the reasoning that makes an added *field* breaking does not
  obviously carry.
- **A3, a changed default that changes values rather than shape.** 0.58.0 is
  exactly this case and the policy permits it; that it was permitted without an
  entry is a decision the text makes, not an oversight.
- **A4, a new enum value on the CLI rather than MCP.** Still unaddressed.

## What a later pass should do

- Close the nested-field gap properly, ideally by asking each release's built
  MCP server for its schemas rather than parsing source. That requires building
  old tags, which this pass judged too failure-prone to trust — a build failure
  would look like an absent schema.
- Decide A2 and A4 in the policy text.
- Say in `compatibility.md` what retroactive application means, since this card
  is the first time it was tried and will not be the last.
