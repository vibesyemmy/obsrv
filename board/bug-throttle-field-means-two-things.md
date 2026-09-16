---
title: "After a refused throttle, `throttle` is the request headless and the state live"
column: doing
owner: "Henry"
waiting: ""
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
