---
title: "Once in a while, the vision test's 'Normal' render is not red: washed out, or the shader still applied"
column: backlog
kind: bug
criterion: B5
order: 84
---

**Waiting on a recurrence:** `vision.spec` *"it actually changes the render, and turning it off restores it"* failing with `middle pixel rgb: [r,g,b]`. Nothing can be done until it fires.

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
