# Obsrv — UI style direction

**Date:** 2026-08-23
**Status:** Approved 2026-08-23 — folded into the plan
**Plan it affects:** `../plans/2026-08-22-obsrv-v1.md` — Tasks 14, 15, 16, 17 (`styles.css`)

## Mobbin references

| Screen | What it is good for |
|---|---|
| [Framer, dark canvas](https://mobbin.com/screens/1fd04a0a-3462-4669-b5a3-c59266660c93) | Chrome recedes to near-nothing; artboards are the only colour on screen. Closest match to Obsrv's two panes. |
| [Framer, light canvas](https://mobbin.com/screens/872c3411-485f-419c-900d-13ff1be5b81e) | Per-artboard label above each frame (`Desktop 1200`, `Tablet 1199 — 810`). Cheap, self-documenting. |
| [Rive](https://mobbin.com/screens/50e1f036-8b00-4e43-ba07-1d59cebb877a) | Dense inspector: grouped sections, ~11px labels, paired numeric fields. The model for `PanelControls` / `SettingsPanel`. |
| [Leonardo AI](https://mobbin.com/screens/fd99c906-280a-4500-9513-18bf503c9d99) | Presets as a button grid rather than a dropdown; slider with the value pinned right. |
| [Air](https://mobbin.com/screens/ca6bc0b2-853f-46f5-8418-b97bf03f1b68) | Single artefact on a quiet dark field. Restraint as the whole design. |
| [Google AI Studio](https://mobbin.com/screens/2456c6b7-87b8-41d4-8157-802eef61fc6b) | Segmented Preview/Code toggle in a thin pane header. |

Common thread across all six: **the chrome is achromatic and the content carries all
the colour.** For most tools that is a taste decision. For Obsrv it is a requirement.

## The governing constraint

Obsrv exists so someone can judge a 0.5px hairline, #767676 text, and 6-bit banding.
Chrome that carries hue, gradient or glow biases that judgement — simultaneous
contrast is real, and a warm-tinted UI visibly shifts the perceived hue of what sits
next to it. A light UI makes the panes read darker; a black one makes midtones read
lighter.

So the thesis is not "dark mode because dev tools are dark". It is:

> **The chrome is a measuring instrument. It must not editorialise about the thing
> being measured.**

Everything below follows from that.

## Rules

1. **Every grey is exactly neutral** — R = G = B, no exceptions. No `#0d1117`-style
   blue-black, no warm greys.
2. **No brand accent colour at all.** The only chromatic pixels in the chrome are
   amber (a warning) and red (an error). Colour therefore always means "attention",
   never decoration. This is the point of view, not an omission.
3. **Zero border-radius on anything touching a pane.** A rounded pane edge clips or
   antialiases the corner pixels the user came to inspect. Panes get square corners
   and a 1px hairline. Controls, away from content, may use 4px.
4. **No shadow, blur or translucency near the panes.** Same reason.
5. **Every number is monospace with tabular figures**, so values do not jitter as a
   slider moves. Numbers are this chrome's real content.

   **Agent control is a warning, not decoration.** While an agent is driving a
   tab, its indicator and the tab itself carry `--warn`. The page is moving
   under the user's hands without their input, which is exactly the "something
   needs your attention" case this rule exists to reserve colour for — so the
   amber is the rule being applied, not an exception to it. It is asserted in
   `tests/e2e/tabs.spec.ts`; do not neutralise it back to grey.

## Tokens

```
--void        #000000   behind the canvas and the native view
--surround    #2a2a2a   the field the panes sit in — user-switchable
--chrome-0    #141414   window ground
--chrome-1    #1c1c1c   toolbar, drawers, strips
--chrome-2    #262626   buttons, inputs
--line        #333333   hairlines
--text-0      #ededed   primary
--text-1      #8a8a8a   labels, units
--warn        #d8a33a   clamped viewport, stalled target, agent control
--error       #e5484d   load-failure code
```

Ten values. Eight neutral, two semantic, no accent.

## Type

- **UI:** `system-ui` (SF on macOS). Native, invisible, respects the user's own
  settings. A characterful display face in the chrome would risk being read as part
  of the page under test — actively harmful in this product.
- **Numerics: IBM Plex Mono**, self-hosted via `@fontsource/ibm-plex-mono`, used for
  every measured value — viewport, PPI, scale, nits, contrast ratio, bit depth, error
  codes. Slightly mechanical, real character in the numerals, tabular by default. The
  packaged app never reaches the network for a font.

## Signature: the pane footer readout

A hairline strip under each pane stating exactly what you are looking at:

```
NATIVE   1600×956 · ×2 host                    TARGET   1366×768 · ×1.83 · Budget TN · 6-bit+FRC
```

Three reasons it earns its place:

- You can never misread which pane is which, or what the right one is simulating.
- A screenshot of Obsrv is self-documenting — and designers will paste these into
  Slack, which is the product's main route to spreading.
- It makes the app read as an instrument rather than a viewer, which is what it is.

Set in the mono face, `--text-1`, 11px, uppercase label, tabular figures.

## Second signature: the surround control

Three-state toggle in the toolbar setting the field the panes sit in: **Black**
(`#000000`), **Graphite** (`#2a2a2a`, the default), **Neutral 50%** (`#808080`).
Implemented as `data-surround` on the root element, repainting `--surround` only —
the pane field, nothing else.

Photographers and colourists judge images against a controlled neutral surround for
exactly the reason above — ISO 3664 specifies a mid-grey viewing surround, because a
black one makes midtones look lighter and a white one crushes them. No web tool offers
this. It costs one CSS variable and it is the most defensible feature in the UI.

## Layout, unchanged from the plan

Toolbar (44px) · optional strip · panes · optional 280px drawer. Drawers sit beside
the panes rather than over them, because the native `WebContentsView` is an OS-level
overlay that paints above the page.

## What this rules out

Gradient buttons, coloured active states, glass/blur, elevation shadows, an accent
hue, rounded pane corners, icon colour, and any illustration. If a control needs to
stand out it does so with weight and a 1px border, not colour.

## Decisions taken

| Axis | Chosen | Rejected, and why |
|---|---|---|
| Mono | IBM Plex Mono | JetBrains Mono reads as the default dev-tool face; SF Mono is invisible but gives up the Windows build later |
| Default surround | Graphite `#2a2a2a` | Neutral 50% is colorimetrically better but harsh at night; black lifts perceived midtones |
| Accent | None | Focus and active states use weight and a 1px inset ring. The only chromatic pixels in the chrome are a real warning or a real error |

## Where this lands in the plan

| Task | Change |
|---|---|
| 1 | `@fontsource/ibm-plex-mono` dependency; font imported in `main.tsx` |
| 13 | `surround` state and `setSurround` in the store, default `graphite` |
| 14 | New token block; `PaneFooter.tsx` with `NativeFooter` / `TargetFooter`; `NativeSlot` measures into state and renders its readout; surround control in `Toolbar`; panes become flex columns of `.pane-body` + `.pane-footer` |
| 15–17 | Token names updated throughout the appended CSS |
| 16 | `ImagePane` gains a `SOURCE` readout |
