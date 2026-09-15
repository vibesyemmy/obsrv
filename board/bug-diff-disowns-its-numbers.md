---
title: "`diff` calls its band deltas noise and leaves its headline numbers standing"
column: next
kind: bug
order: 31
---

FOUND BY ROOK in run 18, 2026-09-15. **Unowned.**

On an unsettled page `diff` prints:

    the band deltas below are frame-to-frame noise, not evidence about rasterisation

and **above that sentence**, from the same two mismatched frames:

    inkCoverage.delta  -0.0991
    rows.ratio          0.4934

Those are the two numbers a person actually quotes. The disclaimer names *the bands* and reaches
only downward, so the headline figures — which are comparisons between the same two frames the
sentence has just called incomparable — stand unqualified.

**The control is what makes it a finding rather than a quibble.** On a static page: `settled`
true, `findings` empty, and those two numbers print in **exactly the same shape**. So nothing in
the output distinguishes *these mean something* from *these are noise* except one sentence with
the wrong scope. A reader who trusts the numbers and skims the prose gets a confident wrong
answer; a reader who reads the prose still has no instruction about the two figures above it.

**Why this is the house defect rather than a typo.** `docs/read-the-output-not-the-code` says a
sentence must name its own subject and key off a fact it measured, not off a neighbouring
sentence. This sentence keys off its own *position* — "below" — which is the most fragile
subject a sentence can have, because a layout change silently re-scopes it.

## What a fix has to get right

**Not simply moving the sentence above the numbers.** Position is the bug; another position is
not the cure. The disclaimer should name the figures it invalidates, or `settled: false` should
suppress or mark the figures themselves, so the qualification travels with the data rather than
with the page.

Whichever is chosen, note that `settled` is already in the output: a caller *can* do this
correctly today. The question is what the tool says to someone who does not.

## The measurement trap this one sits next to

Both documented `diff` limits refuse correctly and exit **2** with empty stdout. Rook first read
those exit codes as **0**, having taken `$?` after a pipe into `tail` — `$?` is the *last*
command's status, so `obsrv diff … | tail` reports `tail`'s success whatever `diff` did.

That is the fourth instance in one session of a check with no subject, and the first with no
filename involved. It is in `CONTRIBUTING.md` under *A check that looked at nothing passes*.
Anyone testing a fix here should read exit codes without a pipe.
