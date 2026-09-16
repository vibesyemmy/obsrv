---
title: "`orientation: landscape` produces a portrait screen on every desktop preset"
column: review
owner: "Rook"
waiting: "Kenya: the cold read of #178, then Henry merges"
kind: bug
criterion: C2
order: 27
---

src/shared/calibration.ts:40 — the flag names which STORED form to use (as-listed, or rotated a quarter turn), not the shape you get. 1080p-24 is stored 1920x1080, so the default gives landscape and `orientation: 'landscape'` rotates it to 1080x1920. `screenShape` then correctly reports 'portrait' beside it; both fields are right and answer different questions (comment at calibration.ts:37). cli/args.ts:190-200 documents all of it. Not a behaviour bug — a name that inverts its plain meaning. Evidence it costs: obsrv-e7 hit it on 2026-09-14 while hunting C4 parity defects, measured two different viewports without noticing, and was about to file it as a parity defect. Renaming is a breaking change to a public flag and an MCP field, so it is C2's to schedule, not a quiet fix.

## Claimed by Rook 2026-09-16, assigned by Wren. No code until Henry picks the semantics.

**Confirmed independently, by reading, before claiming** — the card was right and I did not want to
take it on description alone. `applyOrientation` (`calibration.ts:40`) returns the screen unchanged
unless the flag is `landscape`, in which case it swaps the axes; `presets.ts:60` stores `1080p-24` as
`1920×1080`. So `orientation: 'landscape'` on that preset yields `1080×1920`, which is portrait.

**And it is documented, in three places, which is what makes this a naming decision rather than a
bug.** The MCP field's own description offers *"a monitor stood on end"* as a use; `cli/main.ts:788`
says outright that `--orientation landscape` *"flips a landscape-natural preset into a portrait
screen"*; `calibration.ts:32-38` explains the stored-form convention. **Nobody is being misled by a
silence. They are being misled by a word**, and only on the half of the preset table that is stored
landscape.

### Why this cannot ride on `c2`'s new check

`c2` (#162) fails when the published MCP shape moves. **Every option below is invisible to it except
one.** Changing what `landscape` *means* leaves the enum values `portrait|landscape` exactly where
they are — the shape does not move, and the check stays green through a change that breaks callers.
That is the blind spot #162 names by construction, meeting its first real instance one card later.
**So whichever option is chosen, the register entry is mandatory and manual.**

### The four, for Henry, with what each costs

1. **Redefine: `landscape` means "wider than tall", always.** What a reader expects. On desktop
   presets `landscape` becomes a no-op and `portrait` does the rotating. **The cost is the worst
   kind of break:** a caller passing `orientation: 'landscape'` today to rotate a monitor gets an
   *unrotated* screen tomorrow, silently, with no error and a plausible-looking answer. Invisible to
   the shape check, and invisible to the caller until a measurement reads wrong.
2. **Rename the values** to say what they do — `as-stored` / `rotated`, or similar. Honest, and a
   *loud* break: an old caller passing `landscape` gets a schema rejection rather than a wrong
   answer. Uglier to read, and it does move the enum, so #162 would catch it.
3. **Add a second, unambiguous flag** (`rotate: boolean`) and deprecate `orientation`. A migration
   path with no silent period; two names to explain meanwhile.
4. **Leave it, document harder.** Cheapest, and the one the evidence argues against: it is already
   documented in three places and obsrv-e7 still measured two different viewports without noticing.

**My read, and it is a preference not a measurement:** 2 or 3 over 1, because 1 trades a confusing
name for a silent wrong answer, and this project has spent the week removing exactly that trade. But
which break a pre-1.0 project wants to hand its callers is a judgement about users, not about code,
and it is Henry's.

## DECIDED 2026-09-16 by Henry: option 3, plus a note exactly where the word inverts

**Option 3: add `rotate`, deprecate `orientation`, remove it later.** Rook's read is right. Option 1 trades a
confusing name for a silent wrong answer, and option 4 has already failed in three places. Option 2
fixes the name at the cost of every surface at once: persisted `tabs.json`, IPC payloads, the toolbar,
`AgentUiState`, the report and the skill docs, all in one break. Option 3 gives callers a correct word
now and one loud break later, and the internals can keep `Orientation` until that break.

**The spec:**
1. **Input: `rotate: boolean`** on every surface that takes `orientation` today (CLI `--rotate`, the MCP
   tools, `obsrv_drive`, control). `rotate: true` means what `orientation: 'landscape'` means today: a
   quarter turn from the preset as listed.
2. **`orientation` keeps its current meaning for this release line.** Its descriptions and `--help` say
   it is deprecated and name `rotate`.
3. **Both given and disagreeing → refused**, naming both values. An ambiguous request gets no answer
   rather than a guess.
4. **The note, only where the word inverts:** when a call uses `orientation` and the resulting
   `screenShape` is the other word (`landscape` on a landscape-stored preset gives a portrait screen,
   and the reverse), the reply says so in one sentence. It names the shape, and says `rotate` means
   the same thing plainly. Where the word matches the shape (a phone stored portrait, rotated to
   landscape), there's no note, because the word was true. This is the part that reaches agents:
   obsrv-e7 read the replies, not the docs.
5. **Output: add `rotated: boolean`** beside `orientation` and `screenShape` wherever `orientation` is
   reported today. The `orientation` output stays until the removal.
6. **C2:** `rotate` and `rotated` move the published shape, so #162's check flags them, and they get
   register entries as additions. The deprecation doesn't move the shape, so its register entry is
   manual, as this card says.
7. **Removing `orientation` is a breaking release, and when to ship it is Opeyemi's call**, like every
   publish. This card delivers 1–6. The removal goes on its own card once this lands.

**Controls I'd expect on the PR:** a unit test per surface that `rotate: true` and
`orientation: 'landscape'` produce the same screen. The note fires for `1080p-24` + `landscape`, and
doesn't for a phone + `landscape`. The disagreeing pair is refused. And for each assertion, a sabotaged
version that goes red.
