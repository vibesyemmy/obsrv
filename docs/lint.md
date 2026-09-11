# The lint: rules for what a 1x screen and a cheap panel break

`obsrv lint <url> [--preset …] [--profile …] [--text-scale …] [--thin-px …]`
and `obsrv_lint` (MCP, auto/headless/live) judge a page's rendered DOM on a
target screen and name the elements that will not survive it. The audit
measures millimetres; the diff measures the raster; the lint reads the DOM
at the screen's density and says which element is the problem, with a page
rect an `obsrv_drive` highlight can take as it comes (`space: 'page'`).

## The rules

Every rule is about device pixels or the panel, never CSS pixels alone. A
device pixel here is `deviceScaleFactor × textScale` CSS px: the density of
the screen, and the reflow zoom on top of it.

| Rule | What is flagged | Why |
| --- | --- | --- |
| `hairline` | An edge under one device pixel: an element whose own height or width is the line (`height: 0.5px`), a box-shadow with no blur and every length under a pixel (`0 0 0 0.5px`), an outline that computes to under a pixel. | Chromium paints it as a whole pixel, faint, or not at all, depending on where it lands. On a 2x screen the same CSS is one crisp device pixel, which is why designers do not see it. |
| `thin-text` | Text lighter than regular (weight under 400) whose font size is under `thinPx` device px (default 14). | Strokes thinner than a device pixel go grey and break up on a 1x screen; 300-weight at 12px is 12 device px on a monitor and 24 on a phone. |
| `contrast` | Text whose WCAG 2 contrast fails AA as stated: under 4.5:1, or 3:1 for large text (24px, or 18.66px bold). | The plain failure; the same figure `obsrv inspect` reports as "as stated". |
| `contrast-on-panel` | Text that passes as stated but fails once the panel profile (and, live, the vision setting) is applied. | A budget TN lifts the blacks and pulls the pair together: #767676 on white is 4.54:1 on the display it was designed on and under 4.5:1 on Budget TN. The reference profile never adds one. |
| `image-upscaled` | A raster image drawn larger, in device px, than the loaded file on either axis, as `object-fit` scales it: a cover by its larger axis, a contain by its smaller, a fill by each axis on its own. | Blurred. A 100 px asset at 200 CSS px is 2× on a 1x screen and 4× on a phone; an image that fits a 1x screen exactly is 2× on the phone. |
| `image-oversized` | A raster image whose file is more than 2× the size it is drawn at, on the axis scaled most, per `object-fit`. | Downsampled, which softens fine lines and text in it, and wasted bytes. The finding says whether a srcset offered a candidate at all. |

The background a text is judged on is what is painted under it: the stack of elements at a point inside its box, from the element down, with the first opaque background taken and the translucent layers above it composited on — so a fixed scrim from another branch of the tree counts, where a walk up the ancestors met only the body's white and failed lemonde.fr's light-on-dark consent link at 1.14:1. A background image or gradient, or an image element, on the way means no verdict (`skipped.textOnImages`). Text outside the viewport when the page is measured falls back to its ancestors.

Text that is the same colour as its background (1:1) is not a contrast
failure here: it is a reveal mask's duplicate, a decorative layer, or a bug,
and it is counted under `skipped.invisibleText` with a warning rather than
judged. A raster file of a pixel or two on a side is a spacer stretched into
a gap — the 1×1 GIFs of a table layout — not a picture, and nothing about
it is blurred: the image rules leave it out and count it under
`skipped.spacers` with a warning, so a 1998 page does not spend the image
cap on 500 of them before its first photo. A tiny file a lazy loader is
still to fill (`loading="lazy"`, a `data-src`, a `srcset`) is a placeholder,
not a spacer, and stays in the rules: that is how `--no-walk` shows a page
as it first ships. Images group by cause, not by asset size: whether a `srcset` exists,
and how many times over (2–3×, 3–5×, 5–10×, 10× and over). Contrast groups
key on the text colour and the band its background sits in (light, mid-tone,
dark), not the exact pair: a page's links sit on a dozen near-whites and are
one cause; the exemplar keeps the exact pair and its figures.

An image with a `srcset` (or inside a `<picture>`) is judged by the file
Chromium chose, not by the element's `naturalWidth`: with a srcset that
value is density-corrected — the candidate's pixels over its density, the
CSS size it is meant for — so on a 2x screen every responsive image would
read as upscaled 2×. The walk loads the chosen URL as a plain image (from
cache) for its real pixels, and the finding names the candidate taken
(`chosen`, e.g. `640w`), so a reader can tell a srcset with nothing larger
from a `sizes` that undersold the slot.

Both rules follow `object-fit`, because the width alone says nothing about
how blurred an image is: a 960×331 file covering a 551×567 box is scaled by
its height, 1.7×, and a fill of that box stretches its height 1.7× while
squeezing its width — so the factor is the axis scaled most, the finding
carries `objectFit`, and the sentence says which axis when a fill stretches.
`contain` and `scale-down` follow the smaller axis; `none` scales nothing.

Findings come rule by rule in that order, the worst first within a rule
(thinnest edge, smallest text, lowest ratio, largest factor), at most 200
listed and every one counted in `summary`. Text over an image or a
gradient gets no contrast verdict, because the pixels under it are not a
colour anyone stated; `skipped.textOnImages` says how many, and a warning
says so.

## What it cannot see

- **A sub-pixel border.** Chromium snaps a border width under one device
  pixel up to a whole one at style time, so `border-top: 0.5px` computes
  and paints as 1px on a 1x screen. That is not a hairline problem in this
  engine, and the lint does not report it; a 0.5px border is a Safari or
  Firefox question, which Obsrv, being Chromium, cannot answer.
- **A hairline made by a transform** (`transform: scaleY(0.5)` on a 1px
  element): the DOM says 1px. The diff's row ratio is the place to look.
- **Weight that survives the rules but still looks grey**, gradients that
  band, an image whose content is text: the rules see numbers, not
  pixels. Reading the `obsrv snap` PNG is still step 2 of the loop.
- **Windows.** Rasterisation truth is macOS Chromium; ClearType text
  differs.

## Options

- `--profile` names the panel the `contrast-on-panel` rule is judged on.
  Live, the panel and vision setting in force are used.
- `--thin-px` sets the thin-text threshold in device px. Provisional and
  stated in the output.
- `--text-scale` multiplies the density: at 200% on a 1x screen a 0.5px
  rule is a whole pixel and 12px light text is 24 device px tall.
- Custom `--width`/`--height`/`--dsf` work as for `snap`; the diagonal is
  not needed (no millimetres here).

## Output

```
url, preset, cssWidth, cssHeight, deviceScaleFactor, textScale?, throttle?,
profile, pageHeight, layoutScale, thresholds { thinPx },
summary { hairline, thin-text, contrast, contrast-on-panel, image-upscaled, image-oversized },
findings [ { rule, element, text, rect, message, …per-rule figures } ],
skipped { textOnImages }, truncated { findings, text, edges, images }, warnings
```

`obsrv_lint` adds `mode` (`headless` | `live`), `notes`, and live, the tab
it judged (`tabId`, `tabIndex`). Its `groups` carry a slim exemplar (element,
text, rect, message); `groupsOnly: true` (`--groups-only` on the CLI) leaves
the per-finding list out altogether, which on a big page is most of the
payload — and with it the cut the cap counts (`truncated.findings` is 0: no
list, nothing cut) and the sentence about it, which is only ever
said by whoever prints the list (the CLI, the MCP), never by the report, which
shows groups. Exit code 0 and findings are informational: thresholds for CI
are the caller's.

## Walked first

The page is measured as a user who scrolled it sees it, not as it first
shows. Headless, `obsrv lint` (and `audit`, and every screen of `report`)
walks it a screenful at a time to the end and back before running the rules
(`src/cli/walk.ts`, over the live scroll's own arithmetic, `walkStep` in
`src/shared/scrollHost.ts`), dwelling briefly on each so observers fire and
loaders swap their sources, then waits for the images those swaps started.
Measured on apple.com at 1080p-24 before this existed: nineteen "upscaled"
findings, every one a 1×1 placeholder GIF judged against a 1250 px box; the
same page linted live, where the walk had run, had none. The JSON's `walked`
says how far it went (`screenfuls`, `atEnd`, `ms`). Its only bound is a
fifteen-second budget, like the live walk's: there used to be a cap of twelve
screenfuls too, borrowed from the full-page capture where each screenful is a
render, and everything below it was measured as it first shipped — bbc.com on
a phone is twenty-two screenfuls, and the lint reported 41 placeholder GIFs
below the twelfth as upscaled (62 with no walk at all). A walk costs a dwell,
so the budget covers about a hundred screenfuls. When it does run out, the
warnings say so and count the image findings below the height it reached,
which may be placeholders. `--no-walk` (`walk: false` on the MCP) measures the
page as it first shows.

A document with nothing in it — no text and no targets, or for the lint no text, edges or images — is held for three seconds and asked again every quarter second before it is measured as empty: booking.com's mobile page is empty at `load` and rendered by script in the next second, and the lint once answered zeros for it with no warning. A page that fills in that time is walked again and measured; one that stays empty is measured as it is, with a warning that says nothing was there to measure and that `--wait` (`waitMs`) gives a late page longer.

`--timeout` (`timeoutMs`) bounds the load, and then, separately, everything after it: the walk, the wait for a document with nothing in it, and the page ask itself. A page ask is one script call, and it cannot return while the page's main thread is blocked — a bot challenge working, an interstitial, a script waiting on a dead host — so it is raced against the budget; when the budget wins, the figures are of nothing and the first warning says so and what to do. A page that navigates itself after `load` (a challenge that solved and reloaded, a redirect by script) is given the rest of the budget to arrive and is measured where it arrived, which a warning names. A load that has not finished within the budget — a consent wall whose partner beacon never answers — is measured as it stands, with a first warning saying so, as a snap captures it; the measurement then has its own budget as after any load. An empty page that is an iframe — a bot wall — is named as one, with the share of the viewport it covers, since the measurement does not enter iframes. A page that hides the document's overflow with no scroller the walk can find is named by the walk, so `walked: { screenfuls: 0 }` is not mistaken for a one-screen page.

## Under a page that does not fit its screen

A page with no `<meta name="viewport">` under a phone preset is laid out at
Chromium's fallback width, 980 CSS px, and drawn scaled to fit the screen:
on a 360 px phone, at 360/980. The page reports its lengths in its own
layout px, and every rule here judges device pixels, so the density is
multiplied by that scale — `layoutScale` in the output, 1 for a page that
fits — and a warning says so. It changes verdicts, not just figures: a
75 px logo drawn at 75 layout px covers 55 device pixels on that phone, not
150, so it is not "upscaled 2×"; a 0.5 px rule is 0.37 of a device pixel,
a hairline, where the unscaled figure made it a whole one. The rects and
`pageHeight` stay in the page's own px.

## Live

With the app open and Agent control on, `obsrv_lint` judges the page in
front on the screen, text scale and panel in force, in whatever state it
has been driven into. The control command is `lint` (`{ thinPx? }`); the app
runs the same page walk `obsrv lint` runs headlessly (`TargetSource.lintPage`)
and the same rules (`cli/lint.ts`, Electron-free), so the numbers match.

## Not yet

- (Done in 0.32.0: the report carries the lint, grouped, and pins its
  exemplars on the page.)
- Picture sources and `sizes`: the lint reads `<img>` and the candidate
  Chromium chose; `<picture>` is judged by whichever `<img>` it resolved to.
