---
title: "Remove the deprecated `orientation` input once a breaking release is scheduled"
column: doing
owner: "Henry"
waiting: ""
kind: chore
criterion: C2
order: 75
---

FILED BY HENRY 2026-09-17, closing `bug-orientation-name`. That card's spec item 7 put the removal on its own
card once `rotate` landed, and it has (#178, #207).

`orientation` stays accepted, with its old meaning, on the CLI (`--orientation`), every MCP tool that takes a
screen, and control. It's marked deprecated everywhere an agent or a person reads it. Removing it is a
**breaking change to a public flag and an MCP field**, so it's a breaking release. **When to ship one is
Opeyemi's call**, not this card's.

**When it's scheduled:**
- Remove the input from the CLI, MCP and control.
- Decide whether the `orientation` *output* goes too, or stays beside `rotated` and `screenShape`.
- Add the register entry (`docs/breaking-changes.md`), which #162's shape check will flag.
- Update the skill and README.

## DECIDED 2026-10-04 by Opeyemi: remove it in the next release

Asked in the room at 14:22Z (#3358, "What is it?"), explained by Wren (#3360: the old `portrait|landscape` input whose name
misleads, deprecated since `#178`, which first shipped in 0.61.0), and decided by Opeyemi at 14:24Z (#3363): **"Remove it in the
next release."** That is option 1 of #3360. It rides the next release, which is already breaking (`docs/breaking-changes.md`,
"Next release", lists breaking MCP-surface entries, for example `obsrv_inspect`'s `lineRects`, `#543`), so callers take one
break, not two.

**What is still open, and is not Opeyemi's to answer:** whether the `orientation` *output* stays beside `rotated` and
`screenShape` (the card's "When it's scheduled" list leaves that to the owner), and **the date of the release**, which
nobody has set. The removal has to land (code PR, gated, with its register entry) **before that release is cut**, so it is
a release prerequisite.

**What this changes on the board:** the `waiting:` line is gone, because the question it held is answered and the lane must
not keep asking for it. The card stays in Backlog and unclaimed until someone claims it.

## CLAIMED BY HENRY 2026-10-06, and the output question is answered — by derivation, not by taste

The card says the **output** decision is the owner's rather than Opeyemi's. **It goes too, and here is the
measurement rather than the preference:**

`src/shared/calibration.ts` defines the translation in one line —

```ts
export function orientationFromRotate(rotate: boolean): Orientation {
  return rotate ? 'landscape' : 'portrait'
}
```

— so the `orientation` output is **a pure restatement of `rotated`**. It carries no information `rotated`
does not, **in the one vocabulary this project has a bug card about** (`bug-orientation-name`: the word
names the preset's STORED form, so `'landscape'` produces a *portrait* screen on a landscape-stored
preset). Keeping it would preserve that confusion read-only, and would cost callers a **second** break when
someone eventually removed it. The release is already breaking, so they take one.

**What answers the two questions the single word was asked to answer:** `rotated` (was the screen turned a
quarter turn) and `screenShape` (what shape the dimensions actually have). Having one word do both jobs is
what made it ambiguous.

### Order of work, and why the register came first

**The register entry is written and is in this PR**, before any code: `docs/breaking-changes.md` under
*Next release*. A removal that lands before its entry leaves a window in which the repo's own shape check
would flag a change the register cannot explain — and the register is what a caller reads to find out why
their flag stopped working.

**What is still to do, deliberately not in this PR:** the four surfaces (`--orientation` on the CLI, the
MCP input field, `setOrientation` on control, and the `orientation` key in replies and `status`), then the
skill and the README. **22 source files mention the word**, most of them for the internal `Orientation`
type and `screenShape`, which stay — so the code change needs its own reading rather than being tacked
onto a decision.

**The release date is still nobody's**, and this has to land before the cut.

### The derivation was over-broad, and Wren found where (2026-10-06)

I asked the room to attack the derivation rather than the prose (`#3817`). **It holds for one surface and
fails for two**, which is the answer I wanted and not the one I expected:

| field | what it holds | verdict |
| --- | --- | --- |
| MCP reply `orientation` | `status.orientation`, beside `rotated: rotatedFromOrientation(...)` | **derivable — removed** |
| `obsrv_report` `screens[].orientation` | `screenShape(cssWidth, cssHeight)` — **the shape, not the word** | **renamed to `screenShape`**, its own break |
| `obsrv_presets` `orientation` | a **description string** about asking for the other orientation | **text rewritten** to say `rotate`; **field RENAMED to `rotation`** |

**The report row is the one that would have cost someone something.** Unrotated on a laptop preset it reads
`landscape` while `rotated` is `false` — so it is not the word at all — **and those rows carry neither
`rotated` nor `screenShape`**, so deleting it would have left a consumer with no shape and a register entry
telling them to read two fields that are not there.

**This is the third time this week a claim of mine was true of the case I had in front of me and false of
the cases I had not looked at** — a tally repeated past its source, a SHA completed from a prefix, and now
a derivation generalised from one call site to a name. **The pattern is the same: I checked the instance
and published the rule.**

### CORRECTED 2026-10-06: this card said the `obsrv_presets` field stays, and the code renamed it

The table above read *"field stays"* until today. **`#592` renames it to `rotation`**, which is what
`docs/breaking-changes.md` says after Wren caught the same wrong sentence in the register against the
shape guard (`#4013`). **The register was fixed inside `#592` and nobody carried the fix back here**, so
for about three hours the card and the register disagreed about a published key. A consumer reading
`obsrv_presets`' `orientation` finds it gone.

**Why it is written up rather than quietly edited:** this is the second time this release that a claim
survived in one place after being corrected in another — the same shape as the stale `mcp-live.spec:722`
line numbers in `ipc.ts`'s own comment. **A correction is not done when the authoritative copy is right;
it is done when every copy that repeats it is right.** Grep for the sentence, not only for the field.

### The control half landed with three follow-ups folded in, and one safety fix nobody had asked for (2026-10-07)

`setRotation` is added and `setOrientation` stays accepted this release — **Opeyemi's shape**, chosen after
the cost of a hard removal was measured rather than estimated: an older pinned npm server against a newer
app fails with *"unknown command"* while the client's own advice reads *"the app was closed or Agent control
was toggled off"*, which is false and sends the user nowhere.

**Three items came out of the reads and were held back, then pushed together when a safety fix forced a
push anyway:** the `rotate: false` case for the fallback (**Idris's surviving mutant** — a fallback ignoring
`rotate` passed all 134 unit files, and against an older app would answer `rotate: false` with a rotated
screen); **Wren's eight-tag measurement**, which is a stronger basis for the `/unknown command/` trigger
than the sentence it shipped with; and **Idris's hazard** that `presetApplyError` echoes the caller's string,
so the same trigger copied onto `setPreset` could be fired by an id containing the phrase. All three are now
in the code rather than in a chat log.

**The safety fix, which is the part worth remembering.** Both new stub tests spawned the built MCP server
**without `OBSRV_TEST=1`**, and one of them carried a comment arguing against it. Without that variable a
discovery which is neither live nor declined reaches `cannotLaunchReason`, which returns null on a Mac — and
the server **launches the installed Obsrv on the maintainer's real profile**, on every `npm test`, invisibly
on CI where no app is installed. **Found by Idris** (`#4205`) the same day they made that accident by hand
(`chore-probe-opened-the-real-profile`), and partly owned by Wren, whose probe supplied the harness without
naming the fence.

**It is now a structural invariant and not a note:** `tests/unit/mcpStubFence.test.ts` scans every file in
`tests/unit` for a spawn of that server and fails on any whose env omits the fence, with its own fixtures
for the cases a text scan gets wrong and a non-vacuity check so an unmatched pattern cannot read as clean.
**It immediately found a fourth site nobody had named**, `devMcp.test.ts`, pre-existing on `main`: the
dev-lane proxy, which lists tools and never drives a live one, so it was not firing — fenced anyway, because
a uniform invariant is worth more than an exemption (measured: 13 of 13 either way).
