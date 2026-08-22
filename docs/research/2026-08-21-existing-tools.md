# Existing tools — low-resolution / low-DPI testing (research, 2026-08-21)

## Problem statement
Developer on 4K / HiDPI (2x–3x) monitor cannot see how the site looks on a
1x 1080p (or worse) screen. Layout is testable today; **rendering quality is not**.

Two distinct failure classes:

| Class | What breaks on 1x / low-end screens | Testable today? |
|---|---|---|
| **Layout** | breakpoints, overflow, viewport units, content density | Yes — DevTools, Polypane, Sizzy, Responsively |
| **Rendering** | thin fonts (300 weight) go weak/grey, 0.5px / hairline borders vanish or double, 1px icons blur, low-contrast grey text illegible, images/srcset 1x assets soft, subpixel-positioned elements shimmer, gradients band | **No** — every tool rasterises on the host's physical pixels |

## Tools reviewed

### Multi-viewport browsers
- **Polypane** (paid) — best-in-class emulation: viewport, DPR, UA, safe-area, svh. DPR emulation changes `devicePixelRatio`, media queries, `srcset` selection. Does **not** degrade rasterisation: text on a 2x Mac still draws at 2x. Docs: https://polypane.app/docs/emulation/
- **Sizzy** (paid) — same model. https://sizzy.co
- **Responsively App** (free/OSS) — same model, fewer emulation knobs.

### Chrome DevTools Device Mode
- Can set custom 1920×1080 viewport + DPR 1. Same limitation — "the actual rendition on your screen doesn't change visibly because the physical output … stay[s] constant". https://developer.chrome.com/docs/devtools/device-mode

### Online "screen resolution simulators" (Aynzo, Bright SEO Tools, Veewom, BLVD)
- iframe at a fixed CSS width. Layout only. Irrelevant to rendering.

### Headless screenshot (Playwright `deviceScaleFactor: 1`)
- Closest thing to "true 1x". Produces a real 1x raster. But: no live tool, no side-by-side at correct physical scale, no panel simulation, no font-hinting differences (headless Chromium on macOS still uses macOS font smoothing; Windows 1x with ClearType/GDI-ish hinting looks different again). https://playwright.dev/docs/test-snapshots

### OS-level: BetterDisplay / SwitchResX (macOS), Windows display scaling
- Can force monitor into a non-HiDPI 1920×1080 mode. Closest to ground truth. Downsides: whole-OS switch, disruptive, 4K panel upscaling 1080p ≠ native 1080p panel (blurrier), still doesn't simulate panel quality. https://github.com/waydabber/BetterDisplay

## Gap (nothing found that does this)
1. **True-1x rasterisation preview**, live, side-by-side with the 2x view, shown at *physically correct size* (1 CSS px = 1 device px on a 1x screen ≈ 2×2 px block on the 2x monitor, nearest-neighbour, no smoothing).
2. **Platform rasteriser differences** — macOS (no hinting, greyscale AA) vs Windows ClearType/DirectWrite vs Android/Linux FreeType. 1x Windows is where most real-world ugliness lives.
3. **Panel-quality simulation** — cheap TN/IPS: lower contrast (800:1 vs 1500:1), sRGB-only gamut (P3 colours clip), 6-bit+FRC banding, lower peak brightness, gamma drift, viewing-angle washout.
4. **Automated lint** — flag hairlines < 1px, font weights < 400 at < 14px, contrast that fails once panel contrast is reduced, 1x-only `srcset` gaps.

## Sources
- https://www.browserstack.com/guide/responsive-design-testing-tools
- https://polypane.app/blog/polypane-26-accurate-device-emulation-with-safe-area-and-small-viewport-units/
- https://www.devgem.io/posts/optimizing-device-simulation-in-chrome-devtools-understanding-viewport-and-dpr
- https://tonsky.me/blog/monitors/
- https://skip.house/blog/macos-font-rendering
- https://en.wikipedia.org/wiki/Font_hinting
- https://tools.aynzo.com/en/tools/screen-resolution-simulator
