---
name: obsrv-screens
description: Check how a site or CSS change actually looks on the screens users own — 1080p desktops, 1366×768 laptops, Chromebooks, budget Android phones, cheap TN panels — before declaring frontend work done. Use for screen-size testing, low-DPI legibility, vanishing hairlines, weak thin fonts, grey-on-grey text, mobile rendering at true device DPR, or any "does this hold up on a normal screen?" question.
---

# obsrv-screens — see your pages the way 1x screens see them

Obsrv renders any URL in an offscreen Chromium surface at a *target screen's*
true raster density — a real 1x raster for monitor presets (not your HiDPI
monitor's pixels resampled), the 1.25x/1.5x of Windows display scaling, the
device's real 2x/3x (or 2.625x Pixel) DPR plus mobile UA and viewport
semantics for phone presets — with optional cheap-panel simulation
(contrast floor, sRGB coverage, 6-bit + FRC dithering, brightness). Dev-tools
emulation only changes the viewport; Obsrv changes the rasterisation, which is
where thin fonts, 0.5px hairlines, and low-contrast grey text actually break.

## Commands

Prerequisite: none when using `npx -y getobsrv` (npm downloads everything,
including Electron, on first run). In a local Obsrv checkout, run
`npm install && npm run build` there first. As a Claude Code plugin the
repo installs the skill and the MCP server in one step:
`claude plugin marketplace add vibesyemmy/obsrv` then
`claude plugin install obsrv@obsrv`.

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

# Whole page, not just the first viewport (one surface: device px cap 4096, warns if clamped;
# add --tiled to capture a taller page in bands instead):
$OBSRV snap http://localhost:5173 --preset laptop-768 --full-page --tiled --out shots/full.png

# Numbers instead of eyeballs: 1x target vs a 2x-reference downsample, JSON to stdout:
$OBSRV diff http://localhost:5173 --preset laptop-768 --out-dir shots/diff

# The page as a user at 150% sees it (browser zoom as reflow; works on every command):
$OBSRV snap http://localhost:5173 --preset laptop-768 --text-scale 1.5 --out shots/laptop-150.png

# How it feels on a budget phone over 3G with a slow CPU: settledMs in the JSON, next to
# a --throttle none baseline (presets: fast-4g, slow-4g, 3g, cpu-4x, cpu-6x, mid-phone, budget-phone):
$OBSRV snap http://localhost:5173 --preset android-65 --throttle budget-phone --out shots/slow.png

# One element, measured (font mm, colours, contrast as stated and on the panel, WCAG verdict):
$OBSRV inspect http://localhost:5173 --preset android-65 --profile budget-tn --selector '#cta'

# Tap targets and text in millimetres on that screen, under 7 mm / 2 mm, grouped by size:
$OBSRV audit http://localhost:5173 --preset android-65

# The elements this screen and panel break, named and grouped by cause: edges under a
# device pixel, light text too small for its weight, contrast failing as stated or only
# on the panel, images upscaled or oversized (docs/lint.md):
$OBSRV lint http://localhost:5173 --preset 1080p-24 --profile budget-tn

# All of it for a matrix of screens on one HTML page, with the worst findings pinned and
# cropped on a full-page overview — the thing to attach to a PR:
$OBSRV report http://localhost:5173 --out obsrv-report.html
```

`$OBSRV --help` lists every preset (`1080p-24`, `laptop-768`,
`android-65`, `iphone-61`, …), profile (`reference`, `office-ips`,
`budget-tn`, `old-laptop`), and flag (`--width/--height/--dsf`, `--text-scale`,
`--throttle`, `--wait`, `--timeout`).

## The MCP tools

If the obsrv MCP tools are connected (`obsrv_snap`, `obsrv_diff`,
`obsrv_audit`, `obsrv_lint`, `obsrv_inspect`, `obsrv_report`, `obsrv_drive`,
`obsrv_presets`), prefer them over shelling out — same pipeline, and the PNG
comes back inline. `obsrv_presets { group: 'phones' }` lists just the phones
(`laptops`, `desktops` likewise); with a group it answers with the presets
alone.

**Quote a group, not its members.** `obsrv_lint` and `obsrv_audit` both
answer with `findings` (worst first, at most 200) and `groups`: the same
findings grouped by what they share — a colour pair, a weight and size, an
edge kind, a `srcset`-or-not and a factor bucket for images; a control's
short side or a font size for the audit — over every finding counted, each with a
count, the worst member as exemplar and a few of the elements. A page with
270 identical contrast failures is one group with count 270. Read the
summary, then the groups; ask `obsrv_lint { groupsOnly: true }` when the list
would only be noise. Text the same colour as its background is set aside as
`skipped.invisibleText`, not reported as a contrast failure; text over an
image gets no contrast verdict either, and the warnings say how many.

`obsrv_audit` measures every tap target and text element in **millimetres on
the chosen screen**: a 24 CSS px control is 6.6 mm on a 24" 1080p and 4.5 mm
on a 6.5" phone, so run it on a phone preset before declaring a mobile layout
usable, and quote the millimetres, not the pixels.

`obsrv_report` does snap, audit, lint and diff for a whole matrix of screens
and writes one self-contained HTML page: per screen the render, the audit and
lint grouped, the 1x-vs-2x comparison on 1x screens, and a **"Where the
problems are"** section — the full page (captured in bands when it is
taller than one surface) with a numbered pin on each of the worst audit and
lint findings and a crop of each at the render's own pixels. Attach that to
the PR rather than a folder of PNGs; it returns the path and a per-screen
summary. It stays headless: a batch over a matrix should not commandeer the
window.

## Driving the visible app

If the Obsrv desktop app is open with "Agent control" on (toolbar toggle),
the tools follow it: `obsrv_snap` drives the visible window and the user
watches; `obsrv_audit`, `obsrv_lint` and `obsrv_inspect` measure the page in
front, on the screen, text scale and panel in force, in whatever state you
drove it into (scrolled, a menu open, text at 150%) — `mode: 'headless'`
forces a fresh load instead. `obsrv_drive` flips URL/preset/profile/panes,
scrolls, clicks, pans, throttles, blends the onion skin, and highlights, so
you can walk the user through what you found. No app means the usual
headless render. One Obsrv runs per profile: a second launch hands over to
the first, so what you drive is what the user sees.

To see anything below the fold, scroll and capture in the **same**
`obsrv_drive` call — `{ scroll: { x: 0, y: 1500 }, capture: 'pane' }`. That
tool never navigates unless you pass `url`, so the scroll is still in place
when the PNG is taken. Reaching for `obsrv_snap` after a scroll works only
when the app is already on that exact URL (it answers `navigated: false`);
snapping a different URL is a fresh load and lands back at the top.

To point the user at a finding, pass its `rect` to `highlight` as it came,
with `space: 'page'` — `{ scroll: { x: 0, y: finding.rect.y - 200 },
highlight: { ...finding.rect, space: 'page' }, capture: 'pane' }` — and the
app maps it through the scroll, text scale and density. The result says
`highlight: { drawn, pane }`; with a capture in the same call the marker
stays up until the shutter has fired, so it is in the PNG. `obsrv_inspect`
answers with `pageRect` in the same space.

Captures: `'window'` is the app as the user sees it, both panes; `'pane'` is
the target pane as shown (minified in Fit); `'raster'` is the target's own
frame at device pixels without changing the view — the one for judging type.
Each answers `settled` and, when false, `unsettledReason`: `animating` means
the page keeps painting steadily and the capture was taken after about two
seconds rather than the full wait; waiting longer would not help. On an
animating page the onion skin blends two frames, and the result says so.
`status.loading` says whether a load is still in flight; `reload` answers
once it has finished.

The app can hold several sessions open as tabs, and every tool acts on the
one in **front** — resolved per command, so the user can move it under you.
Each live result names the tab (`tabId`, `tabIndex`); if you drive over
several calls and the state has to hold, check that `tabId` did not change
rather than assuming it. You cannot open, close or switch tabs — ask the
user.

## The loop that catches real regressions

1. `lint` the dev URL on the 1080p and the phone with `--profile budget-tn`,
   and `audit` the phone. Read the summaries, then the groups: the elements
   the rules can catch, each with a page rect you can hand to `highlight` and
   one sentence with the figures. Quote those.
2. Snap the matrix `--matrix laptop-768,android-65,1080p-24`, plus a
   `--profile budget-tn` snap of the most text-heavy screen, and **read each
   PNG like a user**, for what no rule sees: Is thin (300-weight) text still
   readable or gone fuzzy-grey? Do 0.5px hairlines/dividers still separate
   anything? Is grey-on-grey copy legible with the contrast floor? Do
   gradients band? Did the mobile preset get the mobile layout?
3. Run `diff` on suspect pages for numeric confirmation: `inkCoverage.delta`
   (negative = the 1x render is losing ink — strokes weakening), `rows.ratio`
   (≈0.5 is normal glyph scaling; hairlines contribute 1 row at any density),
   per-band deltas and humanised `findings`.
4. Fix the CSS (heavier weight, ≥1px borders, more contrast), re-lint and
   re-snap the same presets, compare. For a review, `report` the matrix and
   attach the page.

Don't declare frontend work done on visual grounds until step 2 has actually
happened on the matrix snaps.

## Caveats

- `lint` cannot see a sub-pixel *border*: Chromium snaps one up to a whole
  device pixel at style time, so `border-top: 0.5px` is 1px here and a
  Safari or Firefox question. A hairline drawn as an element's own height,
  or as a box-shadow, it does see.
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
- Animating pages never go paint-quiet. A covered frame that keeps painting
  steadily is captured after ~2 s — headless and live alike — with
  `settled: false` and `unsettledReason: "animating"`; waiting longer would
  not help, so don't raise `--timeout` for it. `"timeout"` means still
  painting at the budget (under a throttle the early exit is off, since
  `settledMs` is the measurement); `"uncovered"` means part of the frame
  never painted. Use `--wait` for content that settles late.
- The report's full-page capture takes a tall page in bands of one
  screenful each (the viewport stays the screen's, so `100vh` sections keep
  their size), so a sticky header repeats at the top of each band, as it
  does when a person scrolls.
  `snap --full-page` keeps its single-surface cap unless you add `--tiled`
  (`tiled: true` on `obsrv_snap`).
