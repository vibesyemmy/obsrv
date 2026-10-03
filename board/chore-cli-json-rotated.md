---
title: "The CLI's snap JSON has no `rotated`, which MCP replies derive; adding it needs Opeyemi's yes for cli.spec.ts"
column: done
owner: "Henry"
kind: chore
criterion: C4
order: 76
---

FILED BY HENRY 2026-09-17, from `bug-orientation-name`'s amendment, which said this card would wait for the
authorisation rather than be pre-booked. It's filed now so the gap has a home when `bug-orientation-name`
closes. **It isn't authorised.**

MCP's `obsrv_snap` and `obsrv_drive` answer `rotated`, derived in the server. The CLI's snap JSON doesn't
carry it, because adding the key changes the contract `tests/e2e/cli.spec.ts:51` guards. **No session edits
that file without Opeyemi's explicit authorisation**, and this card waits on that.

## THE BLOCKER IS NARROWER THAN THIS CARD SAID, AND THE WORK IS BUILT AND HELD, 2026-09-30

Opeyemi asked the team to clear the backlog chores. Three of the four are genuinely his (a desk, a
minimum app version, a breaking release). **This one's blocker turned out to be narrower than the card
stated, so the work exists on `chore/cli-json-rotated` — and it is held, not merged.**

**What the card said:** adding the key *"changes the contract `tests/e2e/cli.spec.ts:51` guards"*, so
it waits on authorisation to edit that file.

**What is actually there.** Two assertions, not one. `:65` is `toMatchObject` — a subset check, which a
new key does not fail — and **`:79` is an exhaustive key list**, `expect(Object.keys(json).sort())
.toEqual([...])`, which an unconditional new key *would* fail. Wren found the second one; I had claimed
there was none, from a `grep … | head -8` whose glob put `cli.spec.ts` last and cut it off. The card's
instinct was right even though its reason named the wrong assertion.

**Why neither one has to change.** `src/cli/main.ts` already states the rule beside `tiled`,
`textScale` and `throttle`: *"the flagless JSON is a contract"* — a key appears **only when the flag
that produces it was given**. `rotated` belongs to `--rotate` / `--orientation`, and the guarded test
passes neither, so its run is byte-identical. Measured with the change built in: **`cli.spec.ts`, 13
passed**, and the flagless key set unchanged.

**What was built:**

- `rotateAsked` on `RenderSpec` — the flag's *presence*, not its value, so `--orientation portrait` is
  answered `rotated: false` rather than in silence, the same way `--throttle none` is a baseline
  someone asked for by name;
- the key derived with `rotatedFromOrientation`, **the function the MCP server derives it with** —
  `bug-orientation-name` is what two surfaces reading one word separately produced;
- `tests/e2e/cli-rotated.spec.ts`, new, asserting the rotated case, the named-but-not-rotated case, and
  **the flagless key list from the other side**, so an unconditional key would be caught here as well
  as in the guarded file.

**AUTHORISED BY OPEYEMI 2026-09-30** — asked what he would be agreeing to, told that the procedural
half was the real question (that the rule protects the file rather than the subject matter, since the
key is flag-gated and `cli.spec.ts` was run rather than edited), and answered **"Yes, merge it"**. That
settles the card's *"It isn't authorised"* and the reading of the rule together. The paragraph below is
kept as written, because what it describes is what he was shown before he answered.

**Was waiting on Opeyemi, deliberately.** Wren asked that it hold regardless of the technical case,
and the card's own words are *"It isn't authorised."* A peer asking to hold is not something to
out-argue at 3am on a card that says that. What changed is the price of his yes: the evidence is
measured and the branch is ready, so approving it is a sentence rather than an evening.

## MERGED, 2026-09-30 — `#526` at `2d65389`

`chore/cli-json-rotated` merged on Opeyemi's "Yes, merge it". Board never moved — found and fixed as
board hygiene alongside the same gap on `feat-flow-type-text.md`.
