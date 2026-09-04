# The onion skin

```
Toolbar › Onion off · 25% · 50% · 75% · 100%
obsrv_drive { onionSkin: 0.5 }      status → onionSkin
```

The target pane shows a page as a 1x screen rasterises it. The onion skin
shows, over that, the same page as a HiDPI screen rasterises it — the one
the designer is looking at — blended at an opacity you step between. What
the cheap raster *moved* is visible as a ghost: a line that wraps a word
earlier because hinted metrics are wider, a hairline that is there in one
and gone in the other, a weight that thinned. At 100% the pane is the
HiDPI render outright, so stepping 0 → 100 → 0 is an A/B flip on one
canvas.

## What it is

A second offscreen render of the target's page, at 2× and the target's
own CSS viewport, kept only while the skin is on. It follows the target:
every new document the target commits, its viewport and phone-ness, its
text scale, and its scroll (the pane sync's own scroll message is applied
to it too). Its frames arrive on their own channel and land in a second
texture; the canvas draws the target as before and then the reference over
it, through the same panel simulation, with the opacity as alpha. The
panel profile therefore applies to both: an onion skin on Budget TN shows
that panel's HiDPI render over its 1x one, which is the comparison that
means something on that panel.

The reference is exactly as expensive as the target, so it exists only
while the skin is on and is dropped at `off`. Per tab, like the throttle,
and like the throttle **not remembered across launches**: every launch
starts without one.

## Where it cannot go

The reference doubles the device pixels. A 4K or ultrawide desktop preset
at 1x is already at the raster budget's edge, and a reference at a clamped,
narrower viewport would be a picture of a different layout — so the skin
is refused there rather than rendered wrong: the menu falls back to `off`,
and an agent reads `0` back. Everything up to 2048 CSS px on each axis
takes one; every laptop, phone and tablet preset does.

## For agents

`obsrv_drive { onionSkin }` sets it, `status.onionSkin` reads it back, and
`obsrv_drive { capture: 'pane' }` captures the blend as the user sees it.
An app older than the field rejects the command and reports `0`. The
headless commands have no onion skin: `obsrv diff` already renders both
rasters and measures the difference in numbers, which is the tool for a
report; the skin is for eyes.

## Measured

`tests/e2e/onion-skin.spec.ts`: a page that is blue at 1x and red at
2dppx captures as (0,0,255) with the skin off, (128,0,128) ± a few at
50%, (255,0,0) at 100%, and blue again at off with the reference gone; a
navigation moves the reference with the target; a 4K preset refuses and
the value reads back as 0.
