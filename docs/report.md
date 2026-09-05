# The report

```
obsrv report <url> [--matrix id,id,…] [--profile id] [--out obsrv-report.html]
```

One self-contained HTML file: for each screen in the matrix, the render at
that screen's true density (through the panel profile, if one is set), the
physical-units audit — tap targets and text in millimetres on that screen,
findings under the thresholds — and, for 1x screens that fit a 2x reference,
the 1x-vs-2x comparison against the display the page was probably designed
on, the two renders side by side. Same page, same CSS, a different answer
per screen. It is the thing to attach to a PR, hand to a designer, or open
from a folder in a year.

The default matrix is `laptop-768, 1080p-24, android-65, iphone-61`: two
laptops-and-desktops, two phones. `--preset` covers one screen; custom
`--width/--height` need `--diagonal` for any millimetres.

## What is on the page

- A header: the URL, the panel profile, the audit thresholds (provisional,
  and stated), when, and which obsrv.
- Per screen: its CSS size and density, the render's device pixels, the
  screen's physical size in millimetres and its ppi; the render (or, for 1x
  screens, this screen next to the 2x reference, both on the same 1x grid,
  with ink coverage, ink-row ratio and the band findings); the audit
  summary and its findings, smallest first; the lint on the same loaded
  page, judged on the report's profile — six rule counts, then the findings
  grouped by what they share (one colour pair, one weight and size, one edge
  kind, one image asset), each group with its count, its worst member and
  the finding's sentence, so 270 identical contrast failures are one row;
  any warnings from the renders.
- **Where the problems are**, when a screen has findings: the full page,
  captured, with a numbered pin on each of the worst findings — the audit's
  smallest first and one exemplar per lint group, up to six of each — and a
  crop of each at the render's own pixels, so the
  reader sees not just that a control is 5 mm but where it sits and what it
  looks like. A page taller than one capture surface (4096 device px, so
  4096 CSS px at 1x, 2048 at 2x, 1365 at 3x) is captured in bands: the
  viewport is held at the cap, the page scrolled a band at a time with an
  instant scroll, each band captured quiescent and stitched into one raster,
  up to eight bands. Two things follow from that. A sticky header repeats at
  the top of every band, as it does when a person scrolls. And an animating
  page pays its early exit once per band, so a long animated page costs a
  few seconds more. Past eight bands the report says how many findings lie
  beyond what was captured. The overview is downsampled to about 800 device
  px wide and at most 3200 tall, so a long page becomes a map and the crops
  carry the detail. The machine output and `obsrv_report` carry
  `problems: { featured, belowCapture }` per screen; the images are in the
  HTML, not the JSON. `snap --full-page` keeps its single-surface cap; the
  bands are the report's.
- The panel profile applies to the render shown. The 1x-vs-2x comparison is
  measured **without** it: it is about rasterisation, and a profile's
  brightness and black floor would darken every pixel past the ink
  threshold (measured: 100% coverage under `budget-tn`, every band "+90pp").
  With a profile set, a 1x screen therefore shows its profiled render and,
  below it, the unprofiled pair the numbers were taken from.

The page holds its own images (PNG, inline), its own style, and no script.
Nothing is fetched when it is opened. Everything that came from the page
under test — element names, text, warnings — is HTML-escaped on the way in.

## Output on stdout

Machine JSON: the file path and size, the profile and thresholds, and one
entry per screen with the audit summary (counts, smallest sizes, number of
findings), the diff metrics or the reason there was no diff, and warnings.
`obsrv_report` returns the same object; the HTML is a file, not inlined.

## Cost

Each screen is one render, with the audit walk on the same loaded page. A 1x
screen costs a second render for its 2x reference. The default matrix is
four screens and six renders — a minute or so on a laptop, longer on a slow
page. `--wait` and `--timeout` apply per render.

## What it is not

- Not a live capture: the report never drives the visible app.
- Not physically sized on *your* screen: the images are shown scaled to fit,
  and the physical size stated is the target's. Open the PNGs at 1:1, or the
  page in Obsrv, for the actual pixels.
- Not a verdict: findings and diff metrics are informational, as everywhere
  else in Obsrv; thresholds for CI are the caller's.
