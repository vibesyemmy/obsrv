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

Prerequisite: none when using `npx -y getobsrv` (npm downloads everything,
including Electron, on first run). In a local Obsrv checkout, run
`npm install && npm run build` there first.

```bash
# Installed anywhere via npm (first run downloads Electron):
OBSRV="npx -y getobsrv"
# Or, in a local Obsrv checkout (faster, no download):
# OBSRV="node /path/to/Obsrv/bin/obsrv.js"

# One screen, one PNG (+ JSON metadata on stdout, humans on stderr):
$OBSRV snap http://localhost:5173 --preset laptop-768 --out shots/laptop.png

# The recommended matrix — small laptop, budget phone, 1080p desktop:
$OBSRV snap http://localhost:5173 --matrix laptop-768,android-65,1080p-24 --out shots/

# Worst realistic panel (cheap TN) on the small laptop:
$OBSRV snap http://localhost:5173 --preset laptop-768 --profile budget-tn --out shots/laptop-tn.png

# Whole page, not just the first viewport (device px cap 4096, warns if clamped):
$OBSRV snap http://localhost:5173 --preset laptop-768 --full-page --out shots/full.png

# Numbers instead of eyeballs: 1x target vs a 2x-reference downsample, JSON to stdout:
$OBSRV diff http://localhost:5173 --preset laptop-768 --out-dir shots/diff
```

`$OBSRV --help` lists every preset (`1080p-24`, `laptop-768`,
`android-65`, `iphone-61`, …), profile (`reference`, `office-ips`,
`budget-tn`, `old-laptop`), and flag (`--width/--height/--dsf`, `--wait`,
`--timeout`).

If the obsrv MCP tools are connected (`obsrv_snap` / `obsrv_diff` /
`obsrv_audit` / `obsrv_presets`), prefer them over shelling out — same
pipeline, and the PNG comes back inline. `obsrv_audit` (or `obsrv audit`)
measures every tap target and text element in **millimetres on the chosen
screen** and lists what is under 7 mm / 2 mm (provisional, tunable): a 24 CSS
px control is 6.6 mm on a 24" 1080p and 4.5 mm on a 6.5" phone, so run it on
a phone preset before declaring a mobile layout usable, and quote the
millimetres, not the pixels. If the Obsrv desktop app is open with "Agent control" on
(toolbar toggle), snaps drive the visible window — the user watches — and
`obsrv_drive` flips its URL/preset/profile directly, and can also scroll,
click, pan and highlight to walk the user through what it found; no app
means the usual headless render.

To see anything below the fold, scroll and capture in the **same**
`obsrv_drive` call — `{ scroll: { x: 0, y: 1500 }, capture: 'pane' }`. That
tool never navigates unless you pass `url`, so the scroll is still in place
when the PNG is taken. Reaching for `obsrv_snap` after a scroll works only
when the app is already on that exact URL (it answers `navigated: false`);
snapping a different URL is a fresh load and lands back at the top.

The app can hold several sessions open as tabs, and both tools act on the one
in **front** — resolved per command, so the user can move it under you. Each
result names the tab (`tabId`, `tabIndex`); if you drive over several calls and
the state has to hold, check that `tabId` did not change rather than assuming
it. You cannot name another tab, and you cannot open, close or switch tabs —
ask the user. An empty `tabId` is an app older than tabs, which has only one.

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
- `diff` on an animating page compares two different frames. Check `settled`
  in its output: when false the band deltas are frame-to-frame noise and
  `findings` says so rather than interpreting them. Snap that page instead.
- `diff` cannot say "the hairline vanished": a 0.5px hairline renders one
  device row at 1x *and* 2x. It reports ink deltas and row ratios; vanishing
  is judged by reading the PNG.
- Animating pages never go paint-quiet; the capture takes the frame at
  `--timeout` with a warning. Use `--wait` for late-settling content.
