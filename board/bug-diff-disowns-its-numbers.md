---
title: "`diff` calls its band deltas noise and leaves its headline numbers standing"
column: review
kind: bug
owner: "Rook"
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


## Resolved by Rook, 2026-09-16 — branch `fix/report-diff-trio`

**Both halves.** The sentence names its subjects: `UNSETTLED_FINDING` (`metrics.ts`) now reads
*"…the two captures are different frames: inkCoverage.delta, rows.ratio and every band delta here
are frame-to-frame noise, not evidence about rasterisation"* — no *below*, nothing keyed off
position. And the report's HTML (`reportHtml.ts`) no longer paints an unsettled ink delta red:
the `bad` class follows `settled`, and the note saying why sits **above** the table with the
numbers it is about, not after the findings list where a reader who stopped at the table never
reached it. Unit tests pin both, and the settled case keeps its verdict.

**Observed in output:** `diff` on the animated fixture with `--timeout 1000` answers
`settled: false`, `inkCoverage.delta` and `rows.ratio` unchanged in shape, and
`findings[0]` naming both fields.

**Not done, on purpose:** the figures are not suppressed or nulled when unsettled. Changing a
number to `null` changes its type, which is a meaning change under `compatibility.md`; and
`settled` is already in the output for a caller who reads it. The fix is what the tool says to a
caller who does not.
