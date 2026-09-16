# Compatibility policy

What may change in a release, what may not, and how you are told. Obsrv is
pre-1.0 and this policy is about being **legible**, not about being stable —
things will move, and the promise is that you can find out which.

[`breaking-changes.md`](breaking-changes.md) is the register: what actually
moved, newest first. This page is the rule the register is kept by.

## The constraint that decides most of this

**On the MCP surface, adding a field is a breaking change.**

Every tool's output schema is `additionalProperties: false`. A client that
listed the tools *before* an upgrade is holding the old shape, and will reject
a reply carrying a key it has never heard of — a reply that is entirely
correct. The same is true of a new value in an enum.

This inverts the rule most projects run on, where additive is safe. It is why
three separate designs were decided this week the way they were, and it was
nowhere written down until now.

**And since 2026-09-16 something fails when it is not followed** (`board/c2.md`).
`docs/public-shape.json` records every key path every tool's published output
schema declares; `tests/unit/publicShape.test.ts` goes red when the published
shape moves away from it, naming each path that appeared or vanished; and a CI
job goes red when that snapshot moves without `breaking-changes.md` being
touched in the same change. Refresh the snapshot with
`node scripts/public-shape.js > docs/public-shape.json`.

**What that check does not cover, so its green is not over-read:** a field whose
*meaning* changes while its shape stays — the case this page cares about most,
and the one `url` was in 0.59.0 — is invisible to a shape diff by construction.
So is the CLI's JSON output, which is a second surface with no snapshot yet.
**Those still depend on the person making the change noticing**, which is what
this page is for.

**Checked on the wire, 2026-09-15, because everything below rests on it.** The
schemas are `zod` shapes that the MCP SDK converts, so `additionalProperties`
appears nowhere in `src/` and cannot be grepped — this page asserted the
constraint for a day before anyone asked the built server over stdio whether it
was true. It is. See `docs/research/2026-09-15-c2-retroactive.md`.

**What it looks like when it bites:** a validation error on a capture or a
measurement that worked yesterday, naming a field or a value rather than a
page. It reads as a bug in Obsrv. It is a stale schema.

**What fixes it:** a new session. In Claude Code, start a new conversation or
reconnect the MCP server.

## The surfaces, and what each one promises

Obsrv has four contracts, and they are not equally strict.

**1. MCP tool replies** — the strictest, for the reason above. Adding a field
or an enum value is breaking. Removing or renaming one is breaking. Changing
what a field *means* while keeping its name is breaking and is the worst of
them, because nothing fails: the first sign is an answer that reads wrong.

**2. The CLI's JSON on stdout** — `obsrv snap` and friends print a JSON object,
and its key set is a contract. The suite asserts it exactly
(`Object.keys(json).sort()` against a literal list), which is how a change to
it gets caught rather than shipped. Additive changes here are *not* breaking
for a caller reading named fields, but they are breaking for one comparing key
sets — and this project's own tests do that, so assume someone else's do too.

**3. The control server** — what an agent drives the live app with. New
commands are additive and safe. Changing what an existing command does, or
what its reply contains, is breaking. See [`agent-control.md`](agent-control.md).

**4. Exit codes and stderr** — an exit code that changes meaning is breaking.
Human-readable text on stderr is not a contract and may be reworded at any
time; if you are parsing it, parse the JSON instead.

## What may change in a minor release

Before 1.0, a minor may:

- add fields, enum values, tools, commands and flags **(breaking on MCP, see
  above — announced and given a restart note)**
- change the *wording* of any warning or note. The sentences are the product
  and they get better; they are not a parsing target. Match on structured
  fields, never on prose.
- change a threshold, a default, or a measured constant, where the number is a
  judgement rather than a standard. `docs/thresholds.md` says where each one
  comes from and what moving it costs.
- remove a field that was never documented and never emitted.

A patch may do none of these. A patch fixes a defect without changing any
contract — if it has to change one, it is a minor.

## What will not change without being named

- the meaning of a field, silently
- the shape of a reply, silently
- an exit code's meaning
- a documented threshold moving without `thresholds.md` moving with it

"Named" means: an entry in [`breaking-changes.md`](breaking-changes.md) that
says what breaks, what to do instead, and why it was worth doing — and the same
in the release notes. Not a line in a changelog.

## How a breaking change is announced

1. **An entry in the register**, with three parts: *what breaks*, *what to do*,
   *why it ships anyway*. The third is not decoration — a break with no stated
   benefit is one nobody weighed.
2. **The release notes say it too**, because that is where people are when they
   upgrade. The register is where it stays findable six months later.
3. **A restart note when the MCP schema changed at all** — added field, added
   enum value, anything. That is most releases, and it is stated per release
   rather than assumed.

There is no deprecation window and no runtime warning for a renamed field.
Pre-1.0, the rename *is* the change. The cheap check after upgrading:

```bash
obsrv audit https://example.com --preset laptop-768 > after.json
```

and diff the keys against a reply you kept.

## How to write a caller that survives this

- **Read named fields; never compare key sets.** `reply.preset ?? reply.presetId`
  covers a rename across one release.
- **Never match on warning or note text.** Those sentences are rewritten
  whenever they get clearer, which is often, and doing so is how the product
  improves.
- **Treat an unknown enum value as unknown, not as an error.** A settle reason
  you have not seen is a state Obsrv learned to name.
- **Restart the session after upgrading.** Always, not only when the notes say
  so.

## Three things this policy did not say, decided here

Each of these was found by applying the policy rather than by reading it, which
is the only way this kind of gap is found. The reasoning is exposed so it can be
overruled rather than inherited.

### Applying this backwards produces a record, not an announcement

**Every document in this policy is younger than every release before 0.61.0.**
Measured, not recalled: `compatibility.md`, `breaking-changes.md` and
`thresholds.md` are all absent from the tree at `v0.56.0` through `v0.60.0`.

Two clauses therefore cannot be satisfied backwards, and pretending otherwise
would make the register dishonest:

- **"the release notes say it too"** cannot be met at all. The notes shipped.
- **A documented threshold moving without `thresholds.md` moving with it** cannot
  be violated by a release that predates the file. 0.58.0 moved a threshold and
  did not breach this rule, because there was nothing to move.

So: **a retroactive pass produces a RECORD — an entry in the register saying
what was found — and never an ANNOUNCEMENT.** A record may state that a release
was checked and nothing was found, and it should, because *checked and clean*
and *never checked* are different facts that an absent entry does not
distinguish. What a record may not do is imply that anyone was told at the time.

### A new MCP tool is not breaking; a new field still is

The two look alike and are not, and the difference is the mechanism rather than
the size. A field is breaking because an old client validates a reply against a
schema it already holds, and `additionalProperties: false` rejects the key. **A
new tool never appears in a reply to a call the old client makes** — it does not
know the tool exists, so it never calls it, and nothing it does validate has
changed.

The cost is the opposite one: the tool is *invisible* until the client lists the
tools again. That is a restart note, not a breaking change, and it belongs in
the release notes for that reason rather than in the register.

### A new enum value is breaking on MCP and not on the CLI

Same value, two contracts, opposite answers — which is the clearest illustration
on this page that the four surfaces are not one surface.

On **MCP** it is breaking: the enum is in the schema the client is holding, and
a value outside it fails validation.

On the **CLI's stdout** it is not. That contract is the key *set*, and a new
value does not change the keys. A caller switching exhaustively on values can
still be surprised, which is why this page already says to treat an unknown enum
value as unknown rather than as an error — but that is advice to callers, not a
break to announce.

## After 1.0

This policy is for the pre-1.0 period and says so. At 1.0 the register does not
go away, but the rule changes: a breaking change would then need a major, and
the MCP schema problem needs solving rather than announcing — most likely by
the schemas ceasing to be `additionalProperties: false`, which is a decision
nobody has made yet and which belongs on the board rather than in this
sentence.
