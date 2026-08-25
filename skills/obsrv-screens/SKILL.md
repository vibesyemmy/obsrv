---
name: obsrv-screens
description: Check how a site or CSS change actually looks on the screens users own — 1080p desktops, 1366×768 laptops, Chromebooks, budget Android phones, cheap TN panels — before declaring frontend work done. Use for screen-size testing, low-DPI legibility, vanishing hairlines, weak thin fonts, grey-on-grey text, mobile rendering at true device DPR, or any "does this hold up on a normal screen?" question.
---

# obsrv-screens — see your pages the way 1x screens see them

Obsrv renders any URL in an offscreen Chromium surface at a *target screen's*
true raster density — a real 1x raster for monitor presets (not your HiDPI
monitor's pixels resampled), the device's real 2x/3x DPR plus mobile UA and
viewport semantics for phone presets — with optional cheap-panel simulation
(contrast floor, sRGB coverage, 6-bit + FRC dithering, brightness). Dev-tools
emulation only changes the viewport; Obsrv changes the rasterisation, which is
where thin fonts, 0.5px hairlines, and low-contrast grey text actually break.

## Commands

Prerequisite: `npm run build` must have been run in the Obsrv repo (the CLI
runs the built `out/`). If a snap fails with "out/main/cli.js is missing", run
`npm run build` in `/Users/opeyemiajagbe/Documents/Projects/Obsrv` first.

```bash
OBSRV=/Users/opeyemiajagbe/Documents/Projects/Obsrv/bin/obsrv.js

# One screen, one PNG (+ JSON metadata on stdout, humans on stderr):
node $OBSRV snap http://localhost:5173 --preset laptop-768 --out shots/laptop.png

# The recommended matrix — small laptop, budget phone, 1080p desktop:
node $OBSRV snap http://localhost:5173 --matrix laptop-768,android-65,1080p-24 --out shots/

# Worst realistic panel (cheap TN) on the small laptop:
node $OBSRV snap http://localhost:5173 --preset laptop-768 --profile budget-tn --out shots/laptop-tn.png

# Whole page, not just the first viewport (device px cap 4096, warns if clamped):
node $OBSRV snap http://localhost:5173 --preset laptop-768 --full-page --out shots/full.png

# Numbers instead of eyeballs: 1x target vs a 2x-reference downsample, JSON to stdout:
node $OBSRV diff http://localhost:5173 --preset laptop-768 --out-dir shots/diff
```

`node $OBSRV --help` lists every preset (`1080p-24`, `laptop-768`,
`android-65`, `iphone-61`, …), profile (`reference`, `office-ips`,
`budget-tn`, `old-laptop`), and flag (`--width/--height/--dsf`, `--wait`,
`--timeout`).

If the obsrv MCP tools are connected (`obsrv_snap` / `obsrv_diff` /
`obsrv_presets`), prefer them over shelling out — same pipeline, and the PNG
comes back inline.

## The loop that catches real regressions

1. Snap the dev URL across `--matrix laptop-768,android-65,1080p-24`, plus a
   `--profile budget-tn` snap of the most text-heavy screen.
2. **Read each PNG and judge it like a user**: Is thin (300-weight) text still
   readable or gone fuzzy-grey? Do 0.5px hairlines/dividers still separate
   anything? Is grey-on-grey copy legible with the contrast floor? Do
   gradients band? Did the mobile preset get the mobile layout?
3. Run `diff` on suspect pages for numeric confirmation: `inkCoverage.delta`
   (negative = the 1x render is losing ink — strokes weakening), `rows.ratio`
   (≈0.5 is normal glyph scaling; hairlines contribute 1 row at any density),
   per-band deltas and humanised `findings`.
4. Fix the CSS (heavier weight, ≥1px borders, more contrast), re-snap the same
   presets, compare.

Don't declare frontend work done on visual grounds until step 2 has actually
happened on the matrix snaps.

## Caveats

- Rasterisation truth is **macOS Chromium**: it exposes hairline/weight/
  contrast problems faithfully, but Windows ClearType text will differ.
- Panel profiles are principled approximations (documented transfer curves),
  not colorimetry of one specific panel.
- `diff` is 1x-only in v1: dsf>1 presets and CSS viewports over 2048px exit
  with an error. Its findings are informational — apply your own thresholds.
- `diff` cannot say "the hairline vanished": a 0.5px hairline renders one
  device row at 1x *and* 2x. It reports ink deltas and row ratios; vanishing
  is judged by reading the PNG.
- Animating pages never go paint-quiet; the capture takes the frame at
  `--timeout` with a warning. Use `--wait` for late-settling content.
