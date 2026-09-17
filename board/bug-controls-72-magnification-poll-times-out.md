---
title: "`controls.spec:72`: the backing width never halved, once, and the retry passed in 225 ms"
column: backlog
kind: bug
order: 93
---

**Waiting on a recurrence:** `tests/e2e/controls.spec.ts:83` failing with

```
Error: expect(received).toBeLessThanOrEqual(expected)
Expected: <= 2
Received:    453
Call Log:
- Timeout 10000ms exceeded while waiting on the predicate
```

FILED BY HENRY 2026-09-17. Seen once, on CI run `35218827856` (#292's suite): attempt 1 of *a bigger
host diagonal means a smaller magnification* failed after 10.1 s, and the retry passed in **225 ms**.

**What the number says.** The test sets the host diagonal to 54 and polls until the backing width is
within 2 px of half its value at 27. `453` is the difference it was still seeing when the poll gave
up, which is the whole of it: the width had not moved at all. So the renderer either never received
the new diagonal or never re-rendered at it inside 10 s — not a rounding or a race at the threshold.

**What to read when it fires again:**
- whether `at27`, the width before, was itself plausible: the test asserts only that it is above 0;
- the screenshots in `test-results/controls-a-bigger-host-dia-*`, which show the field and the pane
  at the moment it gave up;
- whether the retry's 225 ms means the app was still busy with the previous test when the first
  attempt ran — the same shape as `bug-controls-spec-85-needs-its-predecessor`.

**Why it is not folded into the two neighbouring cards.** `bug-controls-blur-timeout` waits on
`locator.blur: Timeout 30000ms exceeded`, and `bug-controls-spec-85-needs-its-predecessor` is about
`:85` depending on the value this test leaves behind. This is a third failure, in this test's own
poll, and folding it into either would put two failure texts on one card and make the sweep's grep
ambiguous.
