---
title: "The app's Inspect footer ignores the element's opacity, so its contrast disagrees with obsrv inspect and obsrv_inspect"
column: doing
owner: "Henry"
waiting: ""
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

