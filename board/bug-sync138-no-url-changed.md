---
title: "The target emits no url-changed at all — a second shape, and the test named for it"
column: doing
kind: bug
owner: "Kenya"
waiting: "Kenya: the native side of step 2 — did its load commit, or commit after the traces were read?"
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

---

**INSTRUMENT BUILT 2026-09-15 by Kenya, into Review. Branch `fix/sync138-absence-instrument`. NOT merged, NOT pushed — waits on Opeyemi's word given to Kenya directly. THE CAUSE IS NOT FOUND; this makes the next failure legible and nothing more.**

`TargetSource.commitTrace()` records every main-frame commit and whether the pane said anything about it — and when it did not, which rule silenced it. There are two such rules and both are invisible from outside: `internal` (the recreation's own `about:blank`) and `restoring` (Obsrv re-loading the page it was already showing after a density change).

So the four facts a silence used to fit are now separable:

    mirror trace empty            the bus never saw the native commit
    mirror trace 'trip'           the breaker suppressed the mirror
    mirror trace 'already-there'  the panes were judged in step
    commit trace EMPTY            nothing committed in the target at all
    commit trace said: false      a commit happened and was silenced, with the rule named

`sync.spec.ts:138` now reads both traces on every run and carries them in the assertion message, so the one failure in 160 explains itself instead of printing nothing. `mirrorTrace()` was never reached on this path — the test fails before the step loop that dumps it — which is why the card said the instrument was pointed the wrong way.

**WATCHED WORKING, because an instrument nobody has seen fire is worth what the note nobody had seen fire was worth.** Forcing the silent-commit path (a temporary env gate, since reverted) produced this on the failure:

    mirror:  native -> hairline  branch "issued"  (other was redirect.html)
             native -> redirect  branch "issued"  (other was hairline.html)
    commits: 6 x did-navigate, said: false, why: "restoring"

Which is the account the empty array could not give: the bus decided, issued the mirror, the target committed six times, and every commit was deliberately silent.

**DID NOT REPRODUCE.** 40 file-runs, 400 test-executions, `--retries=0`: all passed. At one in 160 that is about a one-in-five chance of catching it, so this is not evidence the flake is gone and is not evidence the instrument works on the real shape — only on the forced one. Rook ran separate invocations; `--repeat-each` re-runs inside one process, so the two batches are not equivalent and mine is the weaker of the two.

**A HARNESS FACT, since it differs from live-drive.spec:** `-g` filtering works on `sync.spec.ts` — its app is created in a per-file `beforeAll` with no dependency on a previous test having run. `live-drive.spec.ts` sets `info` in its first test and dies under `-g`.

**AND ONE THING I GOT WRONG, recorded because it nearly became a false reproduction.** The first run after building the instrument failed two tests, one of them this card's. It was not the flake: `npx playwright test` runs against the built `out/`, and I had changed `src/` without rebuilding, so the test ran against a build with no `commitTrace` in it. Had I reported that as a reproduction it would have been a real bug, falsely reproduced, on the first attempt.

**NOT DONE, and it is the card's own question:** whether the assertion checks what the title claims. `seen.length >= 1` is still the only witness that the target moved at all — the poll that follows passes trivially, because the target is already on HAIRLINE from the previous step, so "followed and came back" and "never moved" are the same observation to it. Anything that makes this test green should be checked against that before it is believed.

**RELEASED 2026-09-16. The session that owned this is gone.** Rook, Kenya and obsrv-e7 all ended
on 2026-09-15; the room's last message is 14 hours old. An owner line naming an absent session is
worse than no owner: it tells the next reader the work is in hand. **This card is takeable.**

## DECIDED 2026-09-16 by Henry: no run budget. A recurrence is already legible, and the first one narrows the question

**Legible? Yes, and it has been since 2026-09-15.** The instrument this card describes as "NOT merged,
NOT pushed" merged as #4 (`bd1c96c`). `sync.spec.ts:138` carries both traces in its assertion message
on main, so every CI recurrence explains itself at no cost.

**And one has happened.** Run [`35121768980`](https://github.com/vibesyemmy/obsrv/actions/runs/35121768980)
(PR #115's control tree, which touched only the overlay's focus), 2026-09-16 16:42Z, failed then
passed on retry. Its assertion message, decoded (fixture paths shortened):

    mirror (last 8)
      16:42:04.489  native tall.html       echo
      16:42:04.608  native hairline.html   echo
      16:42:04.614  target hairline.html   echo
      16:42:05.649  native redirect.html   echo
      16:42:05.653  target redirect.html   echo
      16:42:05.671  target hairline.html   issued     other was redirect.html
      16:42:05.676  native hairline.html   echo
      16:42:05.689  native hairline.html   already-there
    commits (last 8, target)
      about:blank, tall, hairline (mirroring), tall, hairline,
      redirect.html 16:42:05.653 said, hairline.html 16:42:05.671 said

**Read, with the reading marked:**
- **Measured:** the 16:42:05 entries match **step 1** entry for entry: both panes told to expect
  REDIRECT, both commit it, the target's replacement is issued to the native, and the native commits
  HAIRLINE twice. **Nothing follows 16:42:05.689.** Step 2's `native.load(REDIRECT)` left no mirror
  entry and no target commit by the time the test read the traces, and every target commit said
  something.
- **So in the card's own legend this is "the bus never saw the native commit", not a silenced
  commit.** Two facts still fit it, and they are opposite:
  - (a) the step-2 load never committed. It was aborted or was a no-op.
  - (b) it committed after the traces were read. The poll after step 2 passes the moment both panes
    read HAIRLINE, which they already did (the card's "NOT DONE" point).
- **Inference, not established:** the native's second HAIRLINE commit (16:42:05.689) came 13 ms after
  its first. Had step 1's poll passed on the first and step 2's load started before the second, the
  second navigation could have aborted the REDIRECT load. Nothing here shows the load's outcome.

**Why no run budget:** the next useful fact is on the native side, not in more repetitions of what the
target already reports. Record in step 2 whether `native.load(REDIRECT)` resolved, rejected or aborted,
and when the native committed, beside the existing traces. The next natural recurrence then separates
(a) from (b). CI supplies recurrences unasked (15 in `bug-ci-main-red-37pct`'s tally). A budget buys
nothing until an occurrence can tell the two apart.

