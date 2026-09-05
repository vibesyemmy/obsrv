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
| `image-upscaled` | A raster image drawn wider, in device px, than its natural width. | Blurred. A 100 px asset at 200 CSS px is 2× on a 1x screen and 4× on a phone; an image that fits a 1x screen exactly is 2× on the phone. |
| `image-oversized` | A raster image whose natural width is more than 2× its drawn device width. | Downsampled, which softens fine lines and text in it, and wasted bytes. The finding says whether a srcset offered a candidate at all. |

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
profile, pageHeight, thresholds { thinPx },
summary { hairline, thin-text, contrast, contrast-on-panel, image-upscaled, image-oversized },
findings [ { rule, element, text, rect, message, …per-rule figures } ],
skipped { textOnImages }, truncated { findings, text, edges, images }, warnings
```

`obsrv_lint` adds `mode` (`headless` | `live`), `notes`, and live, the tab
it judged (`tabId`, `tabIndex`). Exit code 0 and findings are informational:
thresholds for CI are the caller's.

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
