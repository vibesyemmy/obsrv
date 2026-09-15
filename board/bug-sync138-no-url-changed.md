---
title: "The target emits no url-changed at all — a second shape, and the test named for it"
column: next
kind: bug
order: 40
---

Raised 2026-09-15 by Rook, from its own post-fix batch, and deliberately NOT folded into `bug-stale-issued-echo`.

**The observation.** In 160 runs after the stale-echo fix, `sync.spec.ts:138` failed once:

    expect(seen.length).toBeGreaterThanOrEqual(1)     sync.spec.ts:161

The target emitted **no `url-changed` at all** during the window. That is a different shape from `:165`, which is a mirror that stalled after being decided against — here nothing is decided, because nothing is emitted. `mirrorTrace()` printed nothing, since the test never reaches the step loop that dumps it.

**WHETHER THE FIX CAUSED IT IS OPEN, and Rook refused to close it by reasoning.** Its argument that the change is innocent: it only ever DELETES records, so it can make fewer commits look like echoes — more mirroring, not less — which cannot suppress an emission. Its argument against its own argument: `:138` failed 0 times in 113 runs before and 1 time in 160 after, and **one against zero is not a difference.** It declined to treat a plausible model as evidence, on a card whose history is two plausible models that were wrong.

**Why this is its own card and not the tail of that one.** Two wrong models have already been held about that file tonight, by the same session, and both were killed by an instrument rather than by argument. A third investigation carrying the first two's assumptions is the risk, and the shape here differs from the shape there.

**ROOK'S OWN RECOMMENDATION, which it volunteered against its own interest:** if Opeyemi would rather someone came to that file cold after tonight, that is the better call, and Rook says so even though it would take the card. Worth honouring unless there is a reason not to — the person who has just built a correct model is also the person most primed to see it again.

**What the investigation needs that the last one did not:** `mirrorTrace()` does not reach this failure. Whatever instrument answers "why did nothing emit" is a different one from "which branch did the decision take", and building it is most of the work — as it was last time.

**A measurement note that applies to any counting here:** Rook's batches are `--retries=0` so every occurrence counts; CI is `--retries=1` so an occurrence that passes on retry leaves a green run and a `1 flaky` line. Numbers from the two are not comparable, and CI-derived rates are floors.
