# Text scale

```
Toolbar › Text 100% · 125% · 150% · 200%
obsrv snap|diff|audit|report <url> --text-scale 1.5
obsrv_snap / obsrv_audit / obsrv_report { textScale: 1.5 }
obsrv_drive { textScale: 1.5 }
```

The page as a user who has zoomed their browser to 150 % sees it — which
is also what a phone's larger-text setting and a Windows panel at 150 % do
to a layout. Not magnification: reflow. The CSS viewport shrinks by the
factor and every CSS pixel grows by it, so a 16 px font is 24 device pixels
on a 1x screen, the three-column grid that fit at ×1 wraps to two, and the
sticky header that was fine at ×1 now covers a third of the page. The
screen itself does not move: the 1366×768 laptop is still 1366×768 device
pixels, the phone is still the phone, and the PNG `obsrv snap` writes is
still the screen's size.

## What the page sees

| Screen | Text | The page's `innerWidth` | `devicePixelRatio` |
| --- | --- | --- | --- |
| 1080p-24 (1920×1080 @1x) | 100 % | 1920 | 1 |
| 1080p-24 | 150 % | 1280 | 1.5 |
| laptop-768 (1366×768 @1x) | 150 % | 911 | 1.5 |
| iphone-61 (393×852 @3x) | 200 % | 197 | 6 |

`innerWidth` rounds: 1366 / 1.5 is 910.67, and the emulated page is 911 CSS
px wide, which overruns the surface by half a device pixel that is
clipped. (Flooring would leave a device-pixel sliver of nothing down the
right edge instead.)

## How it is applied

Chromium has a zoom factor of its own, and it would have been one line —
but it is kept **per host across the session**: zooming the target would
zoom the native pane beside it and every other tab on the same origin, and
Electron persists it. So the scale is applied as device emulation on the
target's own `webContents`, the same call the phone presets have always
used for their viewport semantics: the emulated view is the surface
divided by the scale at the surface's density multiplied by it, drawn
back onto the surface with a transform of the scale — the emulation's
`scale`, which is what makes the smaller view fill the surface's device
pixels. (Without it the view is painted 1:1 into the top-left corner, and
the density is only what the page is *told*: 0.22.0 shipped that way, and
the frame is now pinned by pixels rather than by the page's arithmetic.)
The raster stays sharp: the compositor rasters at the transformed scale
rather than upsampling. The native pane, the other tabs and the surface
are untouched. It is re-applied on every navigation, and on the fresh
window a density change swaps in.

## Where it shows

- **Footer.** `text 150%` among the target facts while a scale is in force;
  nothing at ×1.
- **Inspector.** The point under the cursor is mapped into the scaled
  page and the box mapped back out, so the highlight lands on the element.
  The readout's `px` is the page's own font size — what the stylesheet says
  — and its millimetres are that many CSS px at `density × scale`, so
  `16px = 4.4 mm` at ×1 reads `16px = 6.6 mm` at ×1.5.
- **Audit.** Every millimetre grows by the scale: the 24 px control that is
  6.1 mm on the 15.6" laptop at ×1 is 9.1 mm at ×1.5 and stops being a
  finding; `rect`s and `pageHeight` stay in the page's own CSS px. The JSON
  carries `textScale` when one other than 1 was applied.
- **Snap and report.** `textScale` in the JSON when one other than 1 was
  applied (the ×1 JSON is a published contract and is unchanged), and
  `text 150%` in the log line and in the report's per-screen facts. The
  1x-vs-2x comparison is run at the same scale on both sides.
- **Agents.** `obsrv_drive { textScale }` sets it live and `status` reports
  it; an app older than the field reports `1`, which is what it renders,
  and rejects the command.

## Per tab, persisted

Like the orientation: each tab has its own scale, it is written to
`tabs.json` with the preset and the profile, and a restored tab comes back
at the scale it was being viewed at — applied to the target before any
renderer has reported, so the page lays out at its scale from the first
paint. A file from before the field, or one with junk in it, reads as ×1.

## Range

The toolbar offers ×1, ×1.25, ×1.5 and ×2. The CLI and the tools take any
number from 0.5 to 4 (Chromium's own zoom stops at 25 % and 500 %; below
one half nothing is legible and above four nothing fits). Out of range is
refused, not clamped — a clamped ×10 would render something nobody asked
for.
