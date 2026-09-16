---
title: "Whatever decides, something else must notice when the decision changes"
column: doing
owner: "Rook"
waiting: ""
kind: chore
criterion: B5
order: 13
---

THE RULE, which is the general form and the reason this card exists: whatever decides something, a separate thing must notice when that decision changes. Three instances turned up in one afternoon and none of us saw the pattern until the third:
  • a filtered test run decides nothing was compared — so the test must announce that it had no evidence (cbe4981)
  • an EXPLAINED row decides a difference is excused — so something must notice when the difference is gone (d69b2c1)
  • a motion probe would decide whether values are compared — so something must assert WHICH pages were compared

THE FINDING THAT PRODUCED IT (obsrv-e7, 2026-09-14). CI on cdd7056 failed the parity gate: `obsrv_audit pageHeight — moves: headless=1080 live=1065`, obsrv_lint the same, on tests/fixtures/moves-while-measured.html, which slides at 140 px/s. Read twice, fifteen px apart. The surfaces were never implicated. CI sequence: 586caab green (before the C4 work), cdd7056 failure (E2E, one test, one assertion, one page), 1d4e505 SUCCESS — so the red lasted one run and was never 'the C4 work'.

THE LESSON. This machine read 1080 twice on every local run, so the comparison was wrong from its first run and every local green was evidence that two reads landed in the same frame. A third kind of silence: not a VALUE that fits two opposite facts, but an AGREEMENT that fits two — two numbers matching means either 'these agree' or 'nothing moved between the reads'. Both gate verifications that day were sound and neither could have caught it: both test the LOGIC, and this was the INPUT.

THE DESIGN, argued between both sessions. obsrv-a6 proposed replacing the `moving` flag with src/shared/pageMotion.ts, which already answers 'was this page holding still' on both surfaces. obsrv-e7's objection, correct: THE PROBE ANSWERS PER-RUN TOO — a page that moves slowly, or only while loading, reads as still on a fast host, which is how `moves` got past everyone. A probe that silently decides whether to compare values gives a green that fits two facts again, harder to spot because nothing names it.

So: per page, store each surface's probe verdict and whether values were compared; assert that the value-compared set equals the expected set. A page that silently stops being compared goes red; so does one that starts. Take the UNION across surfaces — if either says moving, it was moving. KEEP THE FLAG as an override: a fixture whose purpose is motion should not depend on a probe agreeing about it on the day. Probe for discovery, flag for what we can state.

## Claimed by Rook 2026-09-16, assigned by Wren

## The trap in reading the verdict, found before writing any of it

**The probe's verdict reaches a reply only as note text, and only when it is positive.**
`pageMovedNote` (`src/shared/pageMotion.ts:150`) returns `null` when `moved === 0 && changed === 0`,
so a reply that is *not* moving carries no note at all. Which means **the absence of that note fits
three facts**:

1. the probe ran and the page was still;
2. the probe ran and the page **stopped answering** — `motionAfter` returns `null` when the
   re-measure comes back empty (`pageMotion.ts:81`), and no note is produced;
3. the tool **never probes**. Only `audit` and `lint` call `motionAfter`; `snap` and `inspect` do
   not, so their replies are silent about motion whatever the page did.

**So "no note ⇒ still" would rebuild this card's own defect inside the fix for it** — a verdict that
fits several facts, silently deciding whether values get compared. That is the third instance in the
rule at the top of this card, arriving in the implementation of the third instance.

**What this card's check therefore does, and does not, rest on.** The probe never decides alone and
its silence is never read as "still": a verdict is recorded as one of `moving`, `still` or
`unknown`, and `unknown` is what absence means for any tool that does not probe. What *guards* the
change is the assertion over the compared set, not the probe — the probe only has to be able to move
a page out of that set, where the assertion then notices. A wrong or absent verdict cannot silently
change what is compared, because the compared set is stated and checked rather than derived.
