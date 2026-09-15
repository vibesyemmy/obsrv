---
title: "The contrast figure disagrees with the colours printed beside it"
column: next
kind: bug
order: 4
---

Found in run 17 (2026-09-15, docs/research/2026-09-15-live-run-17.md). **The most serious thing that run turned up, because contrast is what this product is for.**

`https://lobste.rs/`, `laptop-768-11`, headless. `obsrv_lint` and `obsrv_inspect` agree with each other and neither agrees with arithmetic:

    a.upvoter   color #ffffff   background #0c0c0c   contrast.asIs 7.5

**White on `#0c0c0c` is 19.6:1 by the WCAG 2 formula, not 7.5:1.**

THE FORMULA IS NOT GENERALLY BROKEN, which is what makes this worth a card rather than a one-line fix. On `https://www.gov.uk/browse/benefits` the same tool reports `#0b0c0c on #d2e2f1 → 14.82:1` and the formula gives 14.81:1. It is right on dark-text-on-light and wrong on light-text-on-dark, at least in these two cases — whether that split is the real boundary is the first thing to measure, not to assume.

A ratio of 7.5 for white text implies a background luminance near 0.09, which is about `#545454`: a mid grey. So the likely mechanism is that the ratio is computed against a **composited** background while the sentence prints the element's **computed `background-color`**, or the reverse. `backgroundNote: "computed"` appears in both the right and the wrong case, so that field does not currently distinguish them.

WHAT RESTS ON IT: 242 `contrast-on-panel` findings on that one page, 217 of them plain white-on-black reported as "passes on the display it was designed on, fails on this one". If the 7.5 is wrong, that sentence is wrong 217 times in one reply, on the rule the product is named for. If the 7.5 is right, then the colours printed beside it are wrong and every one of those findings names a colour pair the reader cannot verify.

WHERE TO START, and the thing this card exists to prevent: do not fix the arithmetic. Both numbers are produced by code that believes it is right, and one of them is. Establish which half is lying first — a fixture with a known composited stack (translucent layer over a known colour) and a known computed background, where the two answers differ by construction, will say. `src/shared/inspectReadout.ts` is where both surfaces get their figures, so a unit test there can hold whichever answer turns out to be correct.

Unowned. Rook found it and did not take it: run 17's card is B1, and a third session arriving at this file cold is worth more than the finder's two hypotheses.
