---
title: "The target emits no url-changed at all — a second shape, and the test named for it"
column: doing
kind: bug
owner: "Kenya"
order: 40
---

**START HERE — Kenya's framing, promoted above the evidence because it decides what the first day of work is.**

> `:165` was answered by an instrument that reports WHICH BRANCH a decision took. This card has no decision — nothing was emitted. So the question is why an emission that should have happened did not, and **an instrument that reports a taken path cannot answer about a path not taken.**

That is the same shape as everything else this week: an absence that two facts fit, with no instrument pointed at the absence. `mirrorTrace()` is not a smaller version of what this needs; it is the wrong direction. Building the right one is likely most of the work, as it was last time.

The second thing to keep, and it is Rook's: it separated observed from inferred, then refused to call its own fix innocent on one-against-zero. **The honest form of "my change is innocent" is "nothing here can tell you yet."**

ASSIGNED TO KENYA 2026-09-15 on Opeyemi's word, **on Rook's own recommendation that someone come to this file cold** — offered against its own interest, and the reason is the point of the assignment rather than politeness. Two models of that file were held tonight and both were wrong; the session that just built a correct one is also the one most primed to see it again.

**SO THIS CARD SEPARATES WHAT WAS OBSERVED FROM WHAT WAS INFERRED, and the inferences are Rook's to discard rather than Kenya's to inherit.**

**Observed, and safe to build on:**

- One failure in 160 post-fix runs, at `sync.spec.ts:161`: `expect(seen.length).toBeGreaterThanOrEqual(1)`. The target emitted **no `url-changed` at all** during the window.
- `mirrorTrace()` printed nothing for it — the test never reaches the step loop that dumps the trace.
- `sync.spec:138` failed **0 times in 113 runs before** the stale-echo fix and **1 time in 160 after**.
- It also flaked once on CI (`run 34929956587`, main @ 4ee2bf9), failing then passing on retry, leaving a green run and a `1 flaky` line.
- Those batches were `--retries=0`; CI is `--retries=1`. The two sets of numbers are not comparable, and any CI-derived rate is a floor.

**Inferred, by Rook, and explicitly NOT established:**

- That the stale-echo fix is innocent of this. Its argument: the change only ever DELETES records, so it can cause more mirroring and never less, and therefore cannot suppress an emission. Rook itself refused to treat this as evidence — one against zero is not a difference.
- That this is a different fault from `:165` rather than the same one wearing another shape. The shapes differ as observed; whether the causes do is open.

**What is genuinely different about the investigation:** `:165` was solved by an instrument that answered *which branch did the decision take*. This failure never reaches a decision — nothing is emitted. So `mirrorTrace()` does not reach it, and whatever answers *why did nothing emit* is a different instrument. Building it is likely most of the work, as it was last time.

**And the title is still the finding.** *"A redirecting page leaves no stale expectation behind"* — the test is named for the invariant, `redirect.html`'s comment says the same, both are two years older than the bug, and the test was passing while the invariant was broken because it asserts the target FOLLOWED rather than that the record was GONE. Whatever this card finds, the same question is worth asking of it: does the assertion check the thing the title claims?

Raised 2026-09-15 by Rook, from its own post-fix batch, and deliberately NOT folded into `bug-stale-issued-echo`.

**The observation.** In 160 runs after the stale-echo fix, `sync.spec.ts:138` failed once:

    expect(seen.length).toBeGreaterThanOrEqual(1)     sync.spec.ts:161

The target emitted **no `url-changed` at all** during the window. That is a different shape from `:165`, which is a mirror that stalled after being decided against — here nothing is decided, because nothing is emitted. `mirrorTrace()` printed nothing, since the test never reaches the step loop that dumps it.

**WHETHER THE FIX CAUSED IT IS OPEN, and Rook refused to close it by reasoning.** Its argument that the change is innocent: it only ever DELETES records, so it can make fewer commits look like echoes — more mirroring, not less — which cannot suppress an emission. Its argument against its own argument: `:138` failed 0 times in 113 runs before and 1 time in 160 after, and **one against zero is not a difference.** It declined to treat a plausible model as evidence, on a card whose history is two plausible models that were wrong.

**Why this is its own card and not the tail of that one.** Two wrong models have already been held about that file tonight, by the same session, and both were killed by an instrument rather than by argument. A third investigation carrying the first two's assumptions is the risk, and the shape here differs from the shape there.

**ROOK'S OWN RECOMMENDATION, which it volunteered against its own interest:** if Opeyemi would rather someone came to that file cold after tonight, that is the better call, and Rook says so even though it would take the card. Worth honouring unless there is a reason not to — the person who has just built a correct model is also the person most primed to see it again.

**What the investigation needs that the last one did not:** `mirrorTrace()` does not reach this failure. Whatever instrument answers "why did nothing emit" is a different one from "which branch did the decision take", and building it is most of the work — as it was last time.

**A measurement note that applies to any counting here:** Rook's batches are `--retries=0` so every occurrence counts; CI is `--retries=1` so an occurrence that passes on retry leaves a green run and a `1 flaky` line. Numbers from the two are not comparable, and CI-derived rates are floors.
