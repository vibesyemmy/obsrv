---
title: "The app's Inspect footer ignores the element's opacity, so its contrast disagrees with obsrv inspect and obsrv_inspect"
column: review
owner: "Henry"
waiting: "Wren: the cold read of the fix PR, then Henry merges"
kind: bug
criterion: C4
order: 68
---

FOUND BY WREN'S RELEASE SWEEP 2026-09-17 as an unverified lead. **Confirmed by Henry, by reading. Not
yet shown on a page.**

`f8d734f` (unreleased, in 0.61.0) let opacity reach the verdict on the CLI and MCP readout:
`src/shared/inspectReadout.ts` calls `effectiveContrast(report.color, report.background, params, vision,
report.opacity)` and prints `colorPainted`. The app's footer (`src/renderer/src/components/PaneFooter.tsx`)
still calls `effectiveContrast(r.color, r.background, params, matrix)`, so `opacity` defaults to 1, and it
prints the stated `hex(r.color)`. The renderer's `inspection` is the same `InspectReport`, and
`opacity: number` is on it (`src/shared/inspect.ts`). The value is there; the footer doesn't pass it.

**Effect:** on text at `opacity: 0.5`, the footer's "here" and "on <panel>" ratios are those of the
fully opaque colour, higher than what the CLI and MCP print for the same element on the same screen. The
app is where a person reads it.

**Fix direction:** pass `r.opacity`, and show the painted colour (or say the stated colour is shown at an
opacity), matching the readout's wording. A control: a fixture with `opacity: .5` text, where the footer's
ratio must equal `obsrv inspect`'s.

## Claimed by Henry 2026-09-17, routed by Wren

Pulled from Backlog; it's the other app-side known issue in the 0.61.0 notes. **Plan:**
- The footer passes the report's `opacity` to `effectiveContrast`, as `inspectReadout` does.
- It shows the painted colour, or says the stated colour is shown at an opacity, in the readout's words.
- **The test:** a fixture with `opacity: .5` text, where the footer's ratio must equal what
  `inspectReadout` computes for the same report. Control: drop the argument, and it goes red.
- **The desk check comes before any local run.** A spec that hovers the target may need the inspector
  overlay, which has recorded focus history.

## In review 2026-09-17: the footer's facts come from one pure function, held to the readout's

- **The fix:** the footer's inspect facts move out of `PaneFooter.tsx` into `src/shared/inspectFooter.ts`
  (`inspectFooterFacts`). It composites the colour at its own alpha and the element's `opacity`, making the
  same `paintedColor`/`effectiveContrast(…, opacity)` calls as `inspectReadout`. PaneFooter calls it.
- **What a person reads now** (all five shapes printed and read):
  - opacity 0.5: `p#dim.caption · 13px = 3.3 mm · #888888 on #ffffff (#111111 at opacity 0.5) · 3.5:1 here`.
    Before, the footer said `#111111 on #ffffff · 18.9:1 here`.
  - A colour's own alpha: `#707070 on #ffffff (#111111 at alpha 0.6)`. Before, the pair showed the stated
    hex beside a ratio that was already composited, so the two disagreed.
  - Opaque text and text over an image read as before.
- **Test (`inspectFooter.test.ts`):** for the same report, the footer's "here" and "on Budget TN" figures
  match `inspectReadout`'s to the footer's one decimal. The pair leads with the readout's `colorPainted`.
  The opaque ratio is more than 5 away, so the test isn't vacuous.
- **Control:** `opacity` dropped from the footer's contrast goes red on both parity arms (off by 15.36).
- **Wiring:** `inspect.spec`'s footer test ("#6b7280 on #ffffff", "4.8:1 here") passes locally on the
  built app (harness-only, desk-safe).

