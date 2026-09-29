---
title: "a caller told the vision mode changed could be holding a picture in the previous mode, and nothing in the reply said so"
column: done
kind: bug
owner: "Henry"
criterion: B5
order: 84
---

SPLIT OUT of `bug-vision-47-normal-not-red` on 2026-09-29, on Idris's read of `#515`. That card named
**two** symptoms behind one title, and this is the one that is fixed:

| reading of the Normal render | symptom | where it lives now |
| --- | --- | --- |
| `[255,255,0]` | the deficiency shader **still applied** while the control already reads Normal | **this card, done** |
| `[255,255,255]` | a washed-out / white render | `bug-vision-47-normal-not-red`, still `blocks` |

**Why they are two cards and not one.** This card family's own precedent:
`bug-canvas-blank-without-notice` and `bug-target-canvas-no-frames` were split because *"a card that
covers both would be answered by fixing either"*. That is exactly what nearly happened here — I put
`#515` up to move the shared card to `disclose` on the strength of this half being fixed, and the card's
own text still said of the other half *"it remains an undisclosed silence."*

## What the defect was

`setVision` was `apply(...)` followed immediately by `{ ok: true }` — fire and answer, with no wait and
**no `applied` field at all**. So a caller who asked for `normal` was told `ok` whether or not the
deficiency shader had gone.

**Class 1** by `docs/release-gate.md`: the silence fits *"the filter is off"* and *"the filter is still
on"* equally, and the caller cannot tell which. The only tell the bug ever had was a **test's print in a
CI log** (`middle pixel rgb: [r,g,b]` in `tests/e2e/vision.spec.ts`), which the gate names as not a
disclosure at all — *"An artifact is not a reply … The disclosure has to arrive on the surface the
answer is read from."*

**It was never sighted.** Both recorded sightings on the parent card read `[255,255,255]`, and the
channel readout ruled this branch out for each. This half was a named candidate that the instrument
excluded — and it was still class 1 while the reply could not say which of the two had happened.

## The fix, in as `92026ab` (`#514`, second parent `a63a815`)

`setVision` now goes through `applyAndConfirm(..., paints = true)` (`src/main/controlServer.ts:709`):

- The reply carries **`applied`**, plus `visionType` and `visionSeverity` — and an omitted severity is
  reported back as the strong form rather than left for the caller to assume, which was the same gap one
  field over.
- With `paints` set, the pane is asked to draw and the answer waits for the acknowledgement
  (`IPC.drawNow` / `IPC.drewNow`, `DRAW_FLUSH_MS = 400`).
- **A missing ack is not `applied: false`.** The mode did reach the app; what is unknown is whether the
  pane painted it. So the reply keeps `applied: true` and adds a warning: *"the mode is set, but the pane
  did not acknowledge a draw in time — the picture may still show the previous mode."* "Set but not seen
  to paint" and "not set" are different facts a caller acts on differently, and answering `applied:
  false` would state the opposite of what happened.

**Bought with its own e2e**, `tests/e2e/vision-confirm.spec.ts`: the reply says whether it applied and
names the mode the app holds; the no-ack warning fires on a second app launched with
`OBSRV_TEST_NO_DRAW_ACK` — the one behaviour nothing outside the process can force on a healthy
renderer, the same justification as `OBSRV_TEST_THROTTLE_REFUSAL`; and an omitted severity comes back as
`1`.

## What this does NOT claim

**It is a disclosure fix, not a prevention.** Nothing here stops a pane from painting late. What changed
is that a caller is told when it might have — which is what the gate asks for, and is why this half is
`done` while the white render is not.

The draw handshake was previously wired only to the two capture paths (`src/main/ipc.ts:1569-1595`); the
apply surface now uses it too. A future apply that changes what the pane **looks like** should pass
`paints` rather than re-derive this.
