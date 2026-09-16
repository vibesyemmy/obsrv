---
title: "After a refused throttle, `throttle` is the request headless and the state live"
column: done
owner: "Henry"
kind: bug
order: 53
---

FOUND BY ROOK 2026-09-16, in his cold read of #81 (room #168). **Unowned.** Not a blocker for
#81, which carries the refusal sentence to every surface, as its card asked.

## The divergence, measured on #81's branch

The same refusal, forced by `OBSRV_TEST_THROTTLE_REFUSAL`:

    headless   throttle: "slow-4g"   (the request)   no `applied`       the sentence present
    live       throttle: "none"      (the state)     applied: false     the sentence present

**Live tells the truth in the field. Headless tells it only in the note beside a field that asserts
the throttle.**

## Why it is a decision and not an edit

The difference is **already documented as accepted**: `tests/e2e/surface-parity.spec.ts` allows
`throttle` (and `textScale`) to differ for `obsrv_inspect`, because *"headless reports the flag it was
given; live reports the state in force"*. Until a refusal could reach a reply, the two meanings never
disagreed about the facts. Now they can.

**Three ways out, each with a cost:**
1. **Headless reports the state:** `throttle: "none"` after a refusal. That changes the field's
   meaning while the name stays the same, the kind `compatibility.md` calls the worst to ship, so it
   needs a register entry.
2. **Headless adds `applied: false`,** as live has. That's a new field on `additionalProperties:
   false` schemas, which is breaking, and needs the restart note.
3. **Leave the field and rely on the sentence,** and add the refusal case to the parity allowlist's
   reason, so the next reader finds it decided rather than overlooked.

**Rook's framing, which is the test for any answer:** either meaning is defensible, but not one
meaning on one surface and the other on the other.

## DECIDED 2026-09-16 by Henry: option 1. `throttle` is the conditions in force, on every surface

**The codebase already contradicted itself**, which settles the choice more than taste does. The
headless render's comment said its JSON "says the throttle was asked for". Every tool schema
describes the same field as the state: "the conditions applied" (snap), "the conditions the page
loaded under" (audit), "only when a throttle was in force" (lint), "the conditions every screen
rendered under" (report). The app already answered with the state.

**Of the three options, only option 1 gives `throttle` one meaning.** Option 2 (headless adds
`applied: false`) keeps the request in headless `throttle` and the state in live `throttle`: two
meanings, plus a new field that is breaking on MCP. Option 3 (leave it and rely on the sentence)
is two meanings with a note saying so.

**How (this PR):**
- The CLI does what the app's `throttleRefusal` does. A refused throttle puts back the conditions
  the target had, and `throttle` names them: `"none"` on a fresh render.
- That covers `snap`, `inspect`, `audit` and `lint`. `report` states the throttle every screen had
  in force. If screens disagree (a non-uniform refusal), it keeps the one asked for; each refused
  screen's warnings say it didn't hold there, the HTML banner says "on N of M screens", and the
  field's schema description names the case. Refused on every screen, the banner states the
  conditions kept and says the throttle asked for was refused, so it can't read like
  `--throttle none` (Wren). That is close to unreachable, since each screen
  renders on a fresh target and the forced refusal is uniform, so sentences carry it rather than a
  live test (Wren's read).
- A refusal whose put-back is refused too says `throttle` names the conditions put back, not ones
  known to be in force. That's false only when the put-back fails at an earlier CDP step than the
  apply did (Wren), and no test can force it.
- The load-timeout and cut-load sentences name the throttle in force too. Presence is unchanged:
  the key still appears exactly when `--throttle` was given.
- Breaking-changes register entry under 0.61.0. No schema shape changes, so no restart note.

**Out of scope, named:** the side panel's footer still shows the throttle asked for after a panel
refusal ("the footer still states what was asked for", `ipc.ts`). That is UI, and it is not this
card's contract.

**Controls:** `throttle-refused.spec` now asserts `throttle: "none"` on a refusal and `"slow-4g"`
on the same call without one, for `snap` (newly covered), `inspect`, `audit`, `lint` and `report`.
`report` runs through its own wiring, so deleting the per-screen collection turns it red; that gap
was Wren's find. The "on N of M screens" banner has a unit test. The rule a
report uses (`reportThrottle`) has a unit test covering all agree, all refused, one refused (in
either order) and no screens. Two sabotages, one run each, turned it red: always the throttle asked
for, and always the first screen's throttle. The second was green until the refused screen was
tested first. The e2e assertion is red on main by construction, since main's own spec asserted
`"slow-4g"` there and passed.

## DONE 2026-09-16 by Henry: merged as #121 (`b21d1da`)

After a refusal, `throttle` names the conditions in force on both surfaces. `throttle-refused.spec`
asserts `"none"` on a refusal and the asked-for id without one, for `snap`, `inspect`, `audit`, `lint`
and `report`, and it passed on CI. Wren read every head. `report` is exercised through its own wiring,
and its banner says when a throttle held on only some screens or was refused on all of them. The
side-panel footer's "shows what was asked for" is named above as out of scope.
