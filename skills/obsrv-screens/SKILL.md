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
`claude plugin install obsrv@obsrv` (installs the latest release; for a
newer one later, `claude plugin marketplace update obsrv` then
`claude plugin update obsrv@obsrv`).

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

# The whole page, not just the first viewport (captured a screenful at a time and stitched,
# at the screen's own viewport, following an inner scroller if that is what the page scrolls):
$OBSRV snap http://localhost:5173 --preset laptop-768 --full-page --out shots/full.png

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

`audit`, `lint` and `report` walk the page a screenful at a time to the end
and back before measuring, so lazy images are judged by the file that arrived
and sections that mount on scroll exist (`walked` in the JSON); `--no-walk`
measures the page as it first shows.

`$OBSRV --help` lists every preset (`1080p-24`, `laptop-768`,
`android-65`, `iphone-61`, …), profile (`reference`, `office-ips`,
`budget-tn`, `old-laptop`), and flag (`--width/--height/--dsf`, `--text-scale`,
`--throttle`, `--wait`, `--timeout`).

## The MCP tools

If the obsrv MCP tools are connected (`obsrv_snap`, `obsrv_diff`,
`obsrv_audit`, `obsrv_lint`, `obsrv_inspect`, `obsrv_report`, `obsrv_drive`,
`obsrv_presets`), prefer them over shelling out — same pipeline, and the PNG
comes back inline (`inlined: true`; past 1.5 MiB it stays on disk, `inlined: false` with a warning naming the path). `obsrv_presets { group: 'phones' }` lists just the phones
(`laptops`, `desktops` likewise); with a group it answers with the presets
alone.

**Quote a group, not its members.** `obsrv_lint` and `obsrv_audit` both
answer with `findings` (worst first, at most 200) and `groups`: the same
findings grouped by what they share — a text colour on light, mid-tone or
dark backgrounds, a weight and size, an
edge kind, a `srcset`-or-not and a factor bucket for images; a control's
short side or a font size for the audit — over every finding counted, each with a
count, the worst member as exemplar and a few of the elements. A page with
270 identical contrast failures is one group with count 270. Read the
summary, then the groups; ask `obsrv_audit` or `obsrv_lint` `{ groupsOnly: true }`
when the list would only be noise — on a retail page at a phone preset the
audit's list alone is most of the answer. Text the same colour as its background is set aside as
`skipped.invisibleText`, not reported as a contrast failure; text over an
image gets no contrast verdict either, and 1×1 spacer files are counted under
`skipped.spacers` rather than judged; the warnings say how many of each.

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

## Review (live)

The user installed a window to watch. Review in it.

1. **One tab per screen.** `obsrv_drive { tab: "new", url, preset: "laptop-768", capture: "pane" }` — the app launches if it is not running (`launched: true` on that call; say so once). Repeat with `android-65`, `1080p-24`, whatever the question is about. Leave the tabs open; the user flips through them afterwards.
2. **Walk each page a screenful at a time.** `obsrv_drive { scroll: { page: "next" }, capture: "pane" }` until the result says `atEnd: true`. Look at each capture as it comes. No arithmetic, no page height.
3. **Point at what you mean.** `obsrv_drive { highlight: { …rect, space: "page" } }` with an `obsrv_audit` finding's rect or `obsrv_inspect`'s `pageRect`, while you talk about it. A rect below the fold needs a scroll first, in the same call — `{ scroll: { x: 0, y: rect.y - 200 }, highlight: { ...rect, space: "page" }, capture: "pane" }` — the marker stays up until the shutter fires, so it lands in the PNG. `obsrv_audit`, `obsrv_lint`, `obsrv_inspect` in `mode: "auto"` measure the tab in front. `obsrv_audit` and `obsrv_lint` walk the page a screenful at a time before measuring — live so the user sees it look, headless too so lazy images are judged by the file that arrived and late sections exist (`walked` in the result either way); pass `walk: false` to re-measure quietly after a fix, or to measure a scrolled position or an open menu as it stands — the walk returns the page to the top.
4. **Switch with `tab: <id>`** (ids from any result's `tabs`); `closeTab: "current"` when a tab has served.

Captures: `capture: "window"` is the whole app as the user sees it; `"pane"`
is just the target pane, cropped (what steps 1-3 above use); `"raster"` is
the target's own frame at device pixels with no scaling — the one for
judging type. Each answers `settled` and, when false, `unsettledReason` (see
Caveats). One Obsrv runs per profile: a second launch hands the window to
the first, so what you drive is what the user sees.

If a result says `mode: "headless"`, read `why` and tell the user in plain words:
- `requested` — you asked for headless.
- `headless-only` — `fullPage` (obsrv_snap only) or custom width/height: things the live app cannot do.
- `no-display` — nowhere for a window (SSH, CI, `OBSRV_HEADLESS=1`).
- `declined` — the user turned agent control off in the app (the AGENT chip, or Settings → Agent control). Ask them; do not retry.
- `launch-timeout` — the app was launched and did not answer in time. It may still be starting; the next call usually finds it.

`obsrv_report` and `obsrv_diff` are headless always — they never drive the app, and their output has no `mode` or `why` field at all, so there is nothing to check on them.

## Deliver (headless)

`obsrv_report` is the artefact: a matrix of screens, full-page bands, audit
and lint, one HTML page. It never drives the window — deliver it, do not
narrate it. `obsrv_snap { fullPage: true }` for a whole-page raster;
`obsrv_diff` for the 1x-vs-2x numbers. All headless by design.

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
  It cannot name the element that weakened either: measured per box, the 1x
  render carries *more* ink than the 2x reference, and the size of the
  difference tracks the text's colour rather than its stroke (the figures
  are in `src/cli/metrics.ts`). Ask `lint` which elements, and read the PNG.
- The MCP server runs at most two headless renders at once
  (`OBSRV_MCP_CONCURRENCY` raises it): each is its own Electron, and nine in
  parallel starved two of them past their load budget. More calls queue in
  order, and one that waited over a second says so in its warnings or notes;
  a long wait can hit the client's own request timeout, so fan out in twos.
- Animating pages never go paint-quiet. A covered frame that keeps painting
  steadily is captured after ~2 s — headless and live alike — with
  `settled: false` and `unsettledReason: "animating"`; waiting longer would
  not help, so don't raise `--timeout` for it. `"timeout"` means still
  painting at the budget (under a throttle the early exit is off, since
  `settledMs` is the measurement); `"uncovered"` means part of the frame
  never painted; `"blank"` means the frame went quiet one colour end to end
  and stayed that way for 3 s — the page's background with nothing on it
  yet (espn.com paints its page a second after its white), or a page that
  really is empty — so the PNG is not a picture of the page: `waitMs` for a
  page that paints late; `"loading"` means the load itself outran `--timeout` (under a
  throttle, a slow load is the point): the PNG is what had painted, `settledMs`
  is null, and `--timeout` is the answer. Use `--wait` for content that settles late.
- The report's full-page capture takes a tall page in bands of one
  screenful each (the viewport stays the screen's, so `100vh` sections keep
  their size). Chrome stuck to the viewport would be painted into every band,
  so a full-bleed header or cookie bar is hidden from the second band on: it
  appears once, and the page rows behind it are captured rather than lost. An
  app shell gets the same against its own scroller — a sticky toolbar inside it
  is hidden, the chrome around it was never in those bands. A stuck side rail
  stays, since it covers no page content.
- `--full-page` captures the page a screenful at a time and stitches it, at
  the screen's own viewport, so `100vh` sections keep their size; full-bleed
  chrome stuck to the viewport is hidden for the bands after the first
  (`keepStuckChrome` / `--keep-stuck-chrome` leaves it), and the JSON's
  `stuckChrome` names what was hidden. An **app shell** —
  `html, body { overflow: hidden }` with an inner `overflow-y: auto`
  container, most web apps — is followed by scrolling that container, so its
  content is captured and the report pins findings on it, with chrome stuck
  inside that container hidden for the bands after the first. `singleSurface`
  (`--single-surface`) asks for one viewport as tall as the page instead,
  which is faster and has no bands at all, but lays a viewport-sized page out
  differently and gets one screen of an app shell; it says so when it does.
  `snap --full-page` keeps its single-surface cap unless you add `--tiled`
  (`tiled: true` on `obsrv_snap`). On one surface the viewport is as tall as
  the page, so a `100vh` hero becomes the whole surface's height: a page that
  moves is warned about by name, and `--tiled` is the answer.
