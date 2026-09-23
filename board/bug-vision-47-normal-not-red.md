---
title: "Once in a while, the vision test's 'Normal' render is not red: washed out, or the shader still applied"
column: review
kind: bug
owner: "Henry"
waiting: "Idris: the gate on the PR"
criterion: B5
order: 84
---

**IT FIRED, 2026-09-23** — run `35853805499`, on `#455`, rescued on retry. The channel readout this card
added is what answered it; the diagnosis is at the foot of this card. Still open, because the mechanism
behind the white render is named there rather than proven.

FILED BY HENRY 2026-09-17, closing `bug-flakes-gate-the-gate`. It is that card's one remaining watch,
given a home of its own under the sweep's rule.

**What was seen:** CI run `34977896287` failed `expect(normal[0]).toBeGreaterThan(normal[1] + 40)` with
`Expected > 295, Received 255`. The `295` is green + 40 rather than a threshold anyone chose, so red and
green both came back 255. **The blue channel, which decides what happened, was thrown away** by the old
failure message. The uploaded artefacts had no screenshot. On first-failure reading (Rook) the test was
**never first**: another test had always failed before it in the same run.

**What was changed so a recurrence answers itself:** the assertion now prints all three channels,
`middle pixel rgb: [r,g,b]` (`tests/e2e/vision.spec.ts`).

**How to read it when it fires:**
- **`[255,255,255]`, a washed-out render.** The capture read a white frame, which is a capture or
  compositing question, not a vision one.
- **`[255,255,0]`, the deficiency shader still applied while the button already reads Normal.** That is
  the confirm-ahead-of-paint class from agentic pass 4, and a product defect: the UI says one thing
  while the render shows another.
- **Anything else** is a third fact, and should be written down before it is explained.

**Also check before reading it as this test's own failure:** whether another test failed first in the
same run. Every sighting so far had one.

## THE RECURRENCE, 2026-09-23 — it is the white case, which is the half this card could not tell apart

Run `35853805499` (`#455`), `vision.spec.ts:47`, rescued on retry:

```
Error: middle pixel rgb: [255,255,255]
expect(received).toBeGreaterThan(expected)   Expected: > 295   Received: 255
```

**The instrumentation this card added did its job.** The two candidates have two signatures, written
beside the assertion in `tests/e2e/vision.spec.ts`:

| reading | means |
| --- | --- |
| `[255,255,255]` | a **washed-out / white** render |
| `[255,255,0]` | the deficiency shader **still applied** while the button already read Normal — the confirm-ahead-of-paint class |

**It is the first.** So the shader-still-applied branch is **ruled out** for this sighting, and that was
the open question the readout was added to settle.

**And the first sighting is no longer ambiguous.** Run `34977896287` reported `expected > 295, received
255` — red and green both 255, **blue discarded**. Blue is now known to be 255 in this shape, so both
sightings read as white, and the older message simply could not say which half it was.

### The mechanism, named and NOT proven

White is what an **unpainted** surface looks like. `middle()` samples through
`win.webContents.capturePage`, and early or stale captures on this app are a known family — the
`drawNow` handshake exists because an occluded window's capture came back stale. On the **same run**,
`frame-bus.spec.ts:40` failed for exactly that reason: its wait admitted an all-zero frame, and `#455`
fixed it by requiring opaque alpha.

**That is a cause shape, not a proof for this test.** Nothing here shows the capture preceded the
paint; it shows the pixels were white, and white is consistent with it. The next step is to make the
sample wait for a painted frame — `#455`'s predicate is the pattern to copy — and see whether the
sighting stops.

### A correction, recorded because the wrong version was posted first

I reported this as *refuting both* of the card's hypotheses, reasoning that a washed-out red would keep
red above green. **The taxonomy beside the assertion says otherwise, and I wrote it**: all three
channels at 255 *is* the washed-out case. I read the card's one-line summary instead of the source next
to the number. That is the second time in one day I trusted a summary over the detail it summarised —
the first was a card's `owner:` line against its body. @Idris had endorsed the wrong version before I
caught it, and noted in turn that she had verified the pixel values without checking the logic built on
them. **Verifying an input is not verifying a conclusion.**

## THE TIMING CAUSE IS REMOVED 2026-09-23 — and the message stays able to say the other one

The sample now waits for a frame to have been **sent** and **drawn** before it is taken.

**Why not wait for a new frame to arrive.** The simulation is a **renderer-side shader**, so clicking
`.vision-none` redraws what the pane already holds and need not produce a fresh frame from the target.
A wait on `onFrame` would block for its whole timeout on this static fixture — **I wrote that version
first and caught it before running it.** `tabs.frameSent()` is what main already compares captures
against, cannot hang on a page whose frames arrived before the click, and two `requestAnimationFrame`s
then cover the renderer's own draw.

**Why not wait for the pixel to be red.** That is the assertion. Polling on it would make this test
**unable to fail**, and a genuinely white Normal render is the thing the card was filed about.

### Measured, both directions

- **Stable:** 50 runs of the file, 13.8 s total, no timeouts — the added wait costs nothing on a page
  whose frames are already in.
- **Still able to fail:** with the fixture swapped to a white page, the test **fails**, at the same
  assertion, with the same sentence — `middle pixel rgb: [255,255,255]`.

### What this does and does not claim

**It removes one cause, and it cannot tell the two apart.** The sabotage above produces the *identical*
signature to the flake, because white is white however it got there. So this is not a proof that timing
was the cause of the two sightings — it is the removal of the only cause the evidence supports, leaving
the message intact for any other.

**That is the diagnostic value: if `[255,255,255]` recurs after this, timing is no longer available as
an explanation**, and the card's remaining branch — a render that is genuinely white — is what is left.
The card stays open until a suite has run without it, rather than being closed on a fix nobody has seen
prevent anything.
