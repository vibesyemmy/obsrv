# The physical-units audit

```
obsrv audit <url> --preset android-65
```

Every interactive element and every element with text of its own, measured in
**millimetres on the chosen screen**. A 24 CSS px control is 6.6 mm on a 24"
1080p and 4.5 mm on a 6.5" phone; a CSS-pixel rule cannot say which of those
a thumb can hit. The same page, the same CSS, a different answer per screen —
which is the point of the app, applied to layout.

## Output

Machine JSON on stdout (humans on stderr): the applied screen, its density
(`ppi`), the thresholds used, per-group summaries (count, how many are under,
the smallest in px and mm), and `findings`, smallest first:

```json
{ "kind": "small-target", "element": "button#tiny", "text": "×",
  "rect": { "x": 16, "y": 76, "width": 24, "height": 24 },
  "cssWidth": 24, "cssHeight": 24, "mm": 4.52 }
{ "kind": "small-text", "element": "p#caption", "text": "A caption at ten pixels…",
  "rect": { … }, "fontSizePx": 10, "mm": 1.88 }
```

At most 200 findings are listed; the rest are counted in `truncated`.
Findings are informational and exit 0 — thresholds for CI are the caller's,
as with `diff`. The MCP tool is `obsrv_audit`, same inputs.

## The thresholds, and why they are provisional

- **Targets, 7 mm** on the shorter side. Apple's 44 pt is 6.9 mm on a 163 ppi
  screen; Google's 48 dp is 9 mm; WCAG 2.5.8's 24 CSS px is the legal floor
  and says nothing about millimetres. 7 sits between the platform guides.
- **Text, 2 mm** of font size. No standard states a floor in millimetres.
  2 mm is roughly 11 px on a phone and 7 px on a 1080p monitor; below it,
  body text is unreadable and captions are guesswork at arm's length.

Both are exposed (`--tap-mm`, `--text-mm`) and stated in every output, so a
team can tune them and a reader can see what was applied. The audit's value
is the millimetres, not the line.

### What the defaults do on real pages (measured 2026-09-02)

Public pages at `android-65` (6.5", 2x, 270 ppi) and `1080p-24` (92 ppi):

| Page | Targets under 7 mm, phone | under 6 mm, phone | under 7 mm, 1080p | Text under 2 mm, phone |
| --- | --- | --- | --- | --- |
| Wikipedia article | 8 of 28 (29%) | 29% | 26% | 0 |
| GitHub repo | 36 of 38 (95%) | 63% | 22% | 0 |
| BBC News front | 8 of 13 (62%) | 62% | 15% | 0 |
| Stripe home | 120 of 162 (74%) | 57% | 52% | 124 of 420 (29%) |
| Hacker News front | 30 of 30 (100%) | 100% | 100% | 0 |
| MDN CSS docs | 10 of 12 (83%) | 33% | 1% | 0 |
| The Guardian front | 95 of 241 (39%) | 25% | — | 0 |

Read that as the state of the web, not as noise: a 32 CSS px icon button is
6.0 mm on that phone, under every platform's minimum, and most sites are
built from them. Text at 2 mm is quiet everywhere except fine print. `--tap-mm
6` roughly halves the phone findings; `--tap-mm 4.5` is about WCAG 2.5.8's
24 CSS px on that phone. The smallest-first ordering is the practical tool:
the 1.9 mm items at the top are the ones a thumb cannot hit at all.

## What is counted

**Targets:** links, buttons, form controls (not hidden inputs), `summary`,
the interactive ARIA roles (button, link, checkbox, radio, tab, menuitem,
switch), and anything focusable by `tabindex`. **Inline links in running text
are exempt**, as in WCAG 2.5.8: a link is as tall as its line, and flagging
every one would drown the rest. A link styled as a control (block,
inline-block, flex) is a target like any other.

**Text:** any element with a non-blank text node of its own — the element
whose font size the glyphs actually take.

**Skipped:** zero-size boxes, `visibility: hidden`, `display: none`,
`opacity: 0`, a font size of zero (the wrapper trick, not text), the 1×1
clipped box of the "visually hidden" pattern (screen-reader text and the
controls made accessible that way — on real pages those were the 0.2 mm
"targets"), and anything parked off the page at a negative offset.

Rects are page coordinates, so the whole page is covered from one viewport.
Phone presets get the mobile UA and viewport semantics, so the page's mobile
layout is what gets measured. Custom `--width`/`--height` need `--diagonal`
for any millimetres at all; without one the counts and pixel sizes are still
reported, with a warning.

## What it does not do

- It measures layout, not pixels: `--profile` does not apply and is refused.
- It does not judge contrast (the inspector does, one element at a time).
- It does not model `opacity` on ancestors, transforms, or text clipped by
  `overflow`.
- Elements past the caps (2000 targets, 3000 text elements) are counted, not
  measured; the output says so.

## How it is wired

The walk (`auditPage` in `src/shared/audit.ts`) runs in an isolated world of
the target's `webContents`, shipped as source and self-contained (the browser
test runs the stringified form). Its answer is parsed field by field on the
way back (`parseAuditReport`), then `cli/audit.ts` — pure, no Electron — turns
CSS pixels into millimetres from the preset's diagonal and applies the
thresholds. `obsrv_audit` maps its input to the same argv.
