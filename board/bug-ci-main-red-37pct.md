---
title: "CI on main fails about one run in three, from at least three different tests"
column: next
kind: bug
criterion: B5
order: 37
---

**Measured 2026-09-14 ~21:50, and it supersedes the single-test framing on `bug-resizing-test-flaky-ci`.** Henry reported "main is red" about one flaky test. It is not one test and it is not occasional.

**Every completed CI run on main since the C5 merge (3f92680), counted:**

    27 runs,  10 failures,  17 successes   —  37% red

    failed: 202d118 c494f7c e921b64 735f60f 6a8cd02 b89ec67 ddb2c72 67c4176 81f139f a1c9050

**At least three distinct tests, sampled rather than assumed:**

    a1c9050   tests/e2e/live-drive.spec.ts:963    the resizing verdict
    b89ec67   tests/e2e/cli-walk.spec.ts:173
    6a8cd02   tests/e2e/devtools.spec.ts:92

Only the first is the one already carded. The other two are unexamined.

**HOW THIS WENT UNNOTICED FOR OVER THREE HOURS, which is the part that matters more than the rate.** Every merge this evening was verified the same way: run the suite locally, read the green, push, report it as verified. Nobody read CI after the push. Several of the failing commits — a1c9050, 81f139f, 284dac2 — touch nothing but board cards and generated docs, so the failures cannot be caused by what was merged, and were visible the whole time to anyone who looked.

Henry stated "typecheck clean, 1121/1121, pushed" repeatedly tonight. Each of those was true and none of them was about CI.

**WHY IT IS THE STRONGEST EVIDENCE FOR `ci-second-host`, not a distraction from it.** The local desk and CI disagree, repeatedly, across at least three unrelated tests. That is the card's thesis demonstrated at scale: one desk cannot tell you whether a result is about the tool or about the machine. B5's repeatability zero was established on the local desk alone and says the tool does not drift; CI says something drifts about a third of the time.

Those are not contradictory — B5 measured fixtures, these are live e2e — but nobody can say which kind of fact they are holding without the comparison `ci-second-host` asks for.

**WHAT THIS CARD ASKS FOR,** and it is deliberately not "fix the flakes":

- The failure for each of the ten runs, classified by test. Ten is small enough to read them all rather than sample three.
- Whether they share a cause — a shared app, a shared budget, host speed — or are three unrelated races that happen to coincide.
- A number for how long this has been true. The window measured here starts at the C5 merge because that is where Henry started looking, which is not evidence it started there.

**AND A GATE QUESTION FOR OPEYEMI, because it is a policy decision rather than an engineering one:** at 37% red, CI currently cannot tell anyone whether a change broke something. A red run means nothing, so a green run means nothing either. Either the flakes get fixed or the suite gets quarantined into "gating" and "informational" — and the second is how a suite quietly stops being a gate while still looking like one.

Related: `bug-resizing-test-flaky-ci` is one instance. `ci-second-host` is the measurement this argues for. `chore-guard` is about greens that mean nothing; this is reds that mean nothing, which is the same disease.
