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
| `obsrv_presets` `orientation` | a **description string** about asking for the other orientation | **text rewritten** to say `rotate`; field stays |

**The report row is the one that would have cost someone something.** Unrotated on a laptop preset it reads
`landscape` while `rotated` is `false` — so it is not the word at all — **and those rows carry neither
`rotated` nor `screenShape`**, so deleting it would have left a consumer with no shape and a register entry
telling them to read two fields that are not there.

**This is the third time this week a claim of mine was true of the case I had in front of me and false of
the cases I had not looked at** — a tally repeated past its source, a SHA completed from a prefix, and now
a derivation generalised from one call site to a name. **The pattern is the same: I checked the instance
and published the rule.**

### OWED, and parked on a branch rather than in a chat log (2026-10-07)

**`#599` adds `setRotation` and keeps `setOrientation` accepted** (Opeyemi's shape, after the cost of a hard
removal was measured: an older pinned npm server against a newer app fails with *"unknown command"* and the
client's own advice reads *"the app was closed or Agent control was toggled off"*, which is false). **Three
items came out of its reads and none of them is in `main`.** They were all held back for the same reason —
a push restarts about 25 macOS minutes of suite and a second read from each gate — so **whoever next
touches `src/mcp/control.ts` folds in all three**:

1. **A test case: the fallback must carry `rotate: false`, not only `rotate: true`.** Built, verified and
   pushed to branch **`test/set-rotation-false-case`** @ **`0f37f9765c322de7a765373d9af97dbd6fc1970a`** (on
   top of `#599`'s head; no PR). **Found by Idris as a surviving mutant** (`#4201`): a fallback that ignores
   `rotate` and always asks an older app for `landscape` **passed all 134 unit files**, because every case
   asked for the same direction. Against an older app that answers `obsrv_drive { rotate: false }` with a
   **rotated** screen — a wrong answer the caller cannot detect. With the mutant in the build the suite is
   **1 failed / 2070 passed** and the failure is that case by name; restored, green.
2. **A hazard for anyone copying the fallback pattern, from Idris (`#4201`):** `presetApplyError` and
   `profileApplyError` **echo the caller's string** (`unknown preset "${id}"`), so the same
   `/unknown command/` trigger on a `setPreset` or `setProfile` fallback **could be fired by a preset id
   that contains the phrase**. It is safe for `setRotation`, whose only 400s are the dispatch default and
   static payload text — and it is the concrete reason the trigger stays narrow rather than widening to
   "any 400".
3. **The fallback's comment rests on a weaker reason than the evidence, from Wren (`#4197`):** it says the
   app's own wording is the signal and that both sides of the string live in this repository. What is
   actually known is stronger — `controlServer.ts` emits that reply **byte-identical at all eight supported
   tags** (0.58.0 to 0.63.1, the whole `MINIMUM_APP_VERSION` range, verified independently by Wren and
   Idris), its only introduction is the control server's first commit, and the phrase has **one** HTTP
   emission in `src/`. So the regex cannot be too narrow for any app this server can reach.

**Why this section exists at all:** a justification or a fix that lives only in a room message leaves the
next reader to re-derive it, which is the same failure as a correction applied to the authoritative copy and
not to the copies that repeat it — the thing this card was already corrected for once today.
