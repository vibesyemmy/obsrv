---
title: "The contrast figure disagrees with the colours printed beside it"
column: review
kind: bug
owner: "Rook"
order: 4
---

ASSIGNED TO ROOK 2026-09-15 on Opeyemi's word — **and deliberately against Rook's own recommendation**, which was that a session arriving at `inspectReadout.ts` cold is worth more than the finder's two hypotheses. That argument was good and Opeyemi chose otherwise; it is not being ignored, it is being overruled by the person whose call it is. The cold-reader argument has been honoured twice this week (`bug-sync138`, and this card's own filing), so it is a judgement about this card rather than a rejection of the principle.

**What the finder's advantage is here, since that is what the override is buying:** Rook has the run-17 output in hand — 242 contrast-on-panel findings on one page, 217 of them white-on-black — and knows which pages produced the right answer and which the wrong one. A cold reader would have to reproduce that before starting.

**The standing warning on the card applies to its own owner: do not fix the arithmetic first.** Both numbers come from code that believes it is right, and establishing which half lies is a measurement. The two hypotheses Rook already holds are the thing most likely to steer that measurement, and the card asks for the boundary to be established rather than assumed:

    #ffffff on #0c0c0c   WCAG 19.56   tool says 7.5     wrong
    #0b0c0c on #d2e2f1   WCAG 14.82   tool says 14.82   exactly right

Both verified independently by Henry. A 7.5 against white implies a background luminance of 0.0900, which is about `#545454` — consistent with a ratio taken against a composited background while the sentence prints the computed `background-color`, or the reverse. **That is a hypothesis with a number attached, not a finding.** `backgroundNote: "computed"` appears in both the right and the wrong case, so that field does not currently separate them.

Right on dark-on-light and wrong on light-on-dark **in these two cases**. Whether that is the real boundary is the first thing to measure.

Found in run 17 (2026-09-15, docs/research/2026-09-15-live-run-17.md). **The most serious thing that run turned up, because contrast is what this product is for.**

`https://lobste.rs/`, `laptop-768-11`, headless. `obsrv_lint` and `obsrv_inspect` agree with each other and neither agrees with arithmetic:

    a.upvoter   color #ffffff   background #0c0c0c   contrast.asIs 7.5

**White on `#0c0c0c` is 19.6:1 by the WCAG 2 formula, not 7.5:1.**

THE FORMULA IS NOT GENERALLY BROKEN, which is what makes this worth a card rather than a one-line fix. On `https://www.gov.uk/browse/benefits` the same tool reports `#0b0c0c on #d2e2f1 → 14.82:1` and the formula gives 14.81:1. It is right on dark-text-on-light and wrong on light-text-on-dark, at least in these two cases — whether that split is the real boundary is the first thing to measure, not to assume.

A ratio of 7.5 for white text implies a background luminance near 0.09, which is about `#545454`: a mid grey. So the likely mechanism is that the ratio is computed against a **composited** background while the sentence prints the element's **computed `background-color`**, or the reverse. `backgroundNote: "computed"` appears in both the right and the wrong case, so that field does not currently distinguish them.

WHAT RESTS ON IT: 242 `contrast-on-panel` findings on that one page, 217 of them plain white-on-black reported as "passes on the display it was designed on, fails on this one". If the 7.5 is wrong, that sentence is wrong 217 times in one reply, on the rule the product is named for. If the 7.5 is right, then the colours printed beside it are wrong and every one of those findings names a colour pair the reader cannot verify.

WHERE TO START, and the thing this card exists to prevent: do not fix the arithmetic. Both numbers are produced by code that believes it is right, and one of them is. Establish which half is lying first — a fixture with a known composited stack (translucent layer over a known colour) and a known computed background, where the two answers differ by construction, will say. `src/shared/inspectReadout.ts` is where both surfaces get their figures, so a unit test there can hold whichever answer turns out to be correct.

Unowned. Rook found it and did not take it: run 17's card is B1, and a third session arriving at this file cold is worth more than the finder's two hypotheses.

INTO REVIEW 2026-09-15, branch `fix/contrast-figure`, commits 3152d6c (the measurement) and f8d734f (the fix), both on origin. Unit 1171/1171, typecheck clean across three configs. Write-up: docs/research/2026-09-15-contrast-figure.md.

**THE RATIO WAS THE RIGHT HALF. THE PRINTED COLOUR WAS THE WRONG ONE** — the opposite of how run 17 framed it, and both hypotheses the finder brought were wrong. The card's instruction not to fix the arithmetic first is what made that findable.

HOW IT WAS SETTLED, one level below both hypotheses: six tests against figures computed from the published formula rather than from the implementation. black/white 21.00, #ffffff on #0c0c0c 19.56, #0b0c0c on #d2e2f1 14.82, order-independent. All green on the EXISTING code — so the arithmetic was innocent and the value handed to it was what differed. No compositing hypothesis was needed to get there.

A fixture grid (tests/fixtures/contrast-alpha.html) then separated TWO defects, and direction was never the boundary — backgrounds composite correctly in both directions. gov.uk's text was opaque and lobste.rs's translucent, which is all that made two samples look like a light-on-dark split.

DEFECT A: a translucent text colour was composited for the ratio and printed with its alpha discarded. Fixed by `paintedColor`, which both halves now share so they cannot drift apart again. lobste.rs reads `#ffffff` stated, `#a0a0a0` painted, 7.5:1 — and an independent sample of the snap's own pixels in that rect gives #a1a1a1, one unit off for antialiasing.

DEFECT B: `opacity` is not in the computed colour, so it reached neither half and text greyed that way was judged as though it were white. The probe now takes the product down the ancestor chain. The fixture case that reported 19.56 reports 7.72 — a wrong VERDICT corrected, not merely a misleading colour.

LINT NEEDED SEPARATE WIRING, which the card said to check rather than assume. Its message now names the painted colour and says when the page states another, and its "as stated" became "on a reference display" — which is what that number is.

Opaque cases are unchanged (19.56, 14.82, no note), so no existing verdict moves except the ones that were wrong.

TWO THINGS WORTH KEEPING. Both payload whitelists gained the field and drop a report whose opacity is outside 0..1 rather than clamping it, per the rule the rest of ipcPayloads.ts follows. And the verification ran through this worktree's OWN CLI: the obsrv-dev MCP tool announced it was serving the shared checkout at abb508f, which is the only reason a false green was avoided.
