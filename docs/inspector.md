# The inspector

Switch it on with **Inspect** in the target footer, hover the target, and the
footer reads:

```
INSPECT  p#grey · 13px = 3.6 mm · #6b7280 on #ffffff · 4.8:1 here · 3.0:1 on Budget TN
```

Element, font size in CSS pixels and in millimetres on this screen, the text
colour on the background it actually sits on, the WCAG 2 contrast as stated,
and the same pair after the panel profile and the vision setting. The last
figure is the point: the pair was judged on the display the page was made on,
and this is what a cheaper panel makes of it. A click pins the readout so the
pointer can leave; a second click lets go. While the inspector is on, the
pointer reads the page instead of driving it.

## What it measures, and how

- **The element** is `elementFromPoint` in the target page: the topmost
  element under the point, which is what the pixels there belong to.
- **Millimetres** come from the preset's diagonal: CSS pixels × scale factor ÷
  device-pixel PPI × 25.4. The same 13px is 3.6 mm on a 24" 1080p and
  2.2 mm on a 6.1" phone at 3x.
- **The background** is found by walking up from the element to the first
  opaque `background-color`, compositing any translucent colours passed on
  the way onto it, and the viewport's white under a page that paints nothing.
  A background image or gradient anywhere on the way is a stop: nothing
  stated is the colour under the text, and the readout says *on an image ·
  contrast not measurable* rather than guessing.
- **Contrast here** is WCAG 2's ratio of the composited pair.
- **Contrast on the panel** runs both colours through `simulatePixel`, the
  reference implementation the shader is parity-tested against, with
  dithering off (a single colour has no neighbours to dither with; the mean
  level is what an eye averages), then the vision matrix if one is set, then
  the same ratio. It is omitted when the panel is the reference and the
  viewer is normal, because it would repeat the first figure.

## What it does not do

- `opacity`, `filter`, `mix-blend-mode` and text shadows are not modelled.
  The colour reported is the computed `color`, composited over the found
  background.
- Text over an image is not sampled from the rendered frame. That is the
  honest failure case for now; a later version can read the target's own
  pixels.
- It is a readout of one point, not an audit. Findings across a page belong
  to `obsrv diff`.

## How it is wired

The script (`inspectAtPoint` in `src/shared/inspect.ts`) is shipped as
source and evaluated in an isolated world of the target's `webContents` — not
the page's main world, so nothing the page defines can shadow what it calls,
and not the sync preload's world either. It is self-contained on purpose and
the browser test runs the stringified form to prove it. Its answer is parsed
field by field on the main side like any other untrusted payload
(`parseInspectReport`), and the renderer's point is parsed on the way in
(`parseInspectPoint`). Hovers are throttled to one ask every 80 ms with a
trailing ask, and answers that arrive out of order are dropped.
