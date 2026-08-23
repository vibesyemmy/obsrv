# Obsrv

See your site the way 1x screens see it.

Designers and developers work on HiDPI (2x–3x) monitors. A large share of users are on
1x screens — 1080p desktops, 1366×768 laptops, cheap TN panels. On those screens, thin
font weights go weak, 0.5px hairlines vanish, low-contrast grey text becomes illegible,
gradients band and P3 colours clip. Browser dev tools emulate the *viewport* of a 1x
screen but still rasterise on your monitor's physical pixels, so you never see any of it.

Obsrv shows any URL (or a dropped 2x design export) two ways, side by side:

- **Native** — rendered at your host DPR, the way you normally see it.
- **Target** — rendered at a true 1x by an offscreen Chromium surface
  (`deviceScaleFactor: 1`), displayed at the physical size it would have on a chosen
  target monitor, with optional cheap-panel simulation (contrast floor, sRGB coverage,
  6-bit + FRC dithering, brightness) applied in a WebGL2 shader.

Both panes stay in lock-step (scroll, navigation) and the 1x pane is fully interactive.

## Use

```bash
npm install
npm run dev
```

Type a URL (localhost is fine), pick a target screen preset (1080p 24", 1366×768
laptop, …), pick a panel profile (Reference, Office IPS, Budget TN, Old laptop) or open
the advanced sliders. Enter your own monitor's diagonal in Settings once so the target
pane renders at true physical size. Drop a 2x/3x PNG or JPG export to check a design
before it's built.

The target pane opens at 1:1, which usually overflows the pane: pan with a
middle-button drag, Option+drag or Option+wheel, or switch the toolbar's
`1:1 / Fit` control to a fit-to-pane overview (smoothly minified, so not
pixel-exact — the footer says so) and click anywhere in it to jump back to 1:1
at that spot.

## Develop

```bash
npm run typecheck     # tsc, both processes
npm test              # unit (Vitest, node)
npm run test:browser  # shader parity vs the TS reference (Vitest browser mode)
npm run test:e2e      # Playwright driving the real Electron app
npm run dist          # build a macOS DMG (unsigned without a Developer ID identity)
```

Architecture, decisions and the full spec live in
[docs/superpowers/specs/2026-08-22-obsrv-design.md](docs/superpowers/specs/2026-08-22-obsrv-design.md);
the UI style rationale (why the chrome is strictly neutral) is in
[docs/superpowers/specs/2026-08-23-obsrv-ui-style.md](docs/superpowers/specs/2026-08-23-obsrv-ui-style.md).

## Known v1 limits

- Rendering truth is the host OS's 1x rasteriser (macOS today). Windows ClearType at 1x
  looks different again; a Windows build would show Windows truth natively.
- Panel simulation is an approximation, not colourimetric.
- Non-ASCII text input does not type into the target pane (Electron `sendInputEvent`
  limitation); nested scroll containers aren't mirrored.
- Frame delivery has no renderer-side backpressure mailbox (see plan header); at 30 fps
  with dirty rects it has not been needed.
