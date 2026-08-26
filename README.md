# Obsrv

[![CI](https://github.com/vibesyemmy/obsrv/actions/workflows/ci.yml/badge.svg)](https://github.com/vibesyemmy/obsrv/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/getobsrv)](https://www.npmjs.com/package/getobsrv)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

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

- **Mobile presets** — phone and tablet presets (iPhone 6.1" @3x, budget Android @2x, …)
  rasterise at the device's *true* 2x/3x DPR, wear a mobile user agent, get real mobile
  viewport semantics (a page without a viewport meta lays out at 980px and shrinks to
  fit), and are shown at true physical size — usually a small, dense render on a
  desktop monitor, exactly like the phone in your hand.

## Use

```bash
npm install
npm run dev
```

Type a URL (localhost is fine), pick a target screen preset (1080p 24", 1366×768
laptop, iPhone 6.1" @3x, …), pick a panel profile (Reference, Office IPS, Budget TN, Old laptop) or open
the advanced sliders. Enter your own monitor's diagonal in Settings once so the target
pane renders at true physical size. Drop a 2x/3x PNG or JPG export to check a design
before it's built.

The target pane opens at 1:1, which usually overflows the pane: pan with a
middle-button drag, Option+drag or Option+wheel, or switch the toolbar's
`1:1 / Fit` control to a fit-to-pane overview (smoothly minified, so not
pixel-exact — the footer says so) and click anywhere in it to jump back to 1:1
at that spot.

## Agent & CI use

The same rendering pipeline runs headless — no window, JSON on stdout, humans
on stderr — so agents (Claude Code) and CI can ask "how does this URL look on
a 1366×768 laptop / budget Android?" without the GUI. Build first
(`npm run build`; the CLI runs the built `out/`), then:

```bash
# One PNG at a preset's true raster density (+ metadata JSON on stdout):
npx -y getobsrv snap http://localhost:5173 --preset laptop-768 --out shot.png

# A matrix of screens, cheap-panel simulation, full-page capture:
npx -y getobsrv snap http://localhost:5173 --matrix laptop-768,android-65,1080p-24 --out shots/
npx -y getobsrv snap http://localhost:5173 --preset laptop-768 --profile budget-tn --out tn.png
npx -y getobsrv snap http://localhost:5173 --preset laptop-768 --full-page --out full.png

# Machine-readable 1x-vs-2x comparison (ink coverage, row ratios, band deltas):
npx -y getobsrv diff http://localhost:5173 --preset laptop-768 --out-dir diffout
```

`npx -y getobsrv --help` (or `node bin/obsrv.js --help` in a checkout) lists every preset, profile and flag. Diff findings
are informational (exit 0); CI thresholds are the caller's job. A ready-made
Claude Code skill that wraps the loop (snap matrix → read the PNGs → diff →
fix → re-snap) lives at [skills/obsrv-screens/SKILL.md](skills/obsrv-screens/SKILL.md).

### MCP server

The same CLI is also wrapped as an MCP server (stdio, stateless) so MCP
clients get the tools natively: `obsrv_snap` (render a URL at a preset's true
raster density — the PNG comes back as an inline image up to 1.5 MiB),
`obsrv_diff` (the 1x-vs-2x metrics as structured output) and `obsrv_presets`
(every preset and panel profile, no render).

If the desktop app is open with the toolbar's **Agent control** toggle on,
`obsrv_snap` drives the *visible* window instead: you watch the URL load and
the preset flip, and the agent gets back a capture of the app exactly as you
see it (plus `obsrv_drive` to flip URL/preset/profile directly). With no app
running, everything falls back to the headless render automatically.

Build first, then register:

```bash
claude mcp add --scope user obsrv -- npx -y getobsrv mcp
```

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

## Install (desktop app)

Grab the DMG for your chip from [Releases](https://github.com/vibesyemmy/obsrv/releases),
drag Obsrv.app to Applications, then clear the quarantine flag once (the build is not
yet notarised, so macOS falsely reports it as "damaged"):

```bash
xattr -cr /Applications/Obsrv.app
```

## Distribution

Publish via a packed tarball, never bare `npm publish`: `npm publish` snapshots
package.json before lifecycle hooks run, which silently skips the prepack
electron dev→prod dependency swap (this shipped a broken 0.4.0). The flow is:

```bash
npm run release:pack
npm publish ./getobsrv-<version>.tgz
```

Obsrv publishes to npm as **`getobsrv`** (the installed commands remain `obsrv`
and `obsrv-mcp`; the app's display name remains Obsrv). The bare `obsrv` npm name
belongs to an unrelated package.

## Known v1 limits

- Rendering truth is the host OS's 1x rasteriser (macOS today). Windows ClearType at 1x
  looks different again; a Windows build would show Windows truth natively.
- Panel simulation is an approximation, not colourimetric.
- Non-ASCII text input does not type into the target pane (Electron `sendInputEvent`
  limitation); nested scroll containers aren't mirrored.
- Frame delivery has no renderer-side backpressure mailbox (see plan header); at 30 fps
  with dirty rects it has not been needed.
