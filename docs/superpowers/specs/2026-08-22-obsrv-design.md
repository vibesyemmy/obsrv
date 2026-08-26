# Obsrv — Design Spec

**Date:** 2026-08-22
**Status:** Approved (brainstorm complete)
**Research:** [../../research/2026-08-21-existing-tools.md](../../research/2026-08-21-existing-tools.md)

## 1. Problem

Designers and developers work on HiDPI (2x–3x) monitors. A large share of end users are on 1x screens (1080p desktops, 1366×768 laptops, cheap TN panels). On 1x:

- thin font weights (≤300) render weak and grey
- hairline / 0.5px borders vanish or double
- 1px icons and subpixel-positioned elements blur
- low-contrast grey text becomes illegible
- 1x `srcset` assets look soft
- gradients band, P3 colours clip, blacks wash out on cheap panels

Existing tools (Chrome DevTools, Polypane, Sizzy, Responsively) emulate viewport and `devicePixelRatio` for media queries and `srcset`, but **rasterise on the host's physical pixels** — text stays retina-sharp. OS-level hacks (BetterDisplay, SwitchResX) switch the whole display and still don't simulate cheap panels. No existing product shows a live, pixel-accurate 1x render beside the 2x render with panel-quality simulation.

## 2. Goal (v1)

A macOS desktop app that shows any URL (or a dropped design export) two ways, side by side:

1. **Native** — rendered at host DPR, as the developer normally sees it.
2. **Target** — rendered at true 1x, displayed at the physical size it would have on a chosen target monitor, with optional cheap-panel simulation.

Success criteria:

- A 0.5px hairline and 300-weight 12px text visibly differ between panes.
- Target pane is interactive (click, type, scroll) and stays in sync with Native.
- Switching preset or panel profile updates Target in under one frame interval.
- A dropped 2x Figma PNG export shows its 1x appearance without leaving the app.

## 3. Scope

### In scope (v1)
- URL bar with history, reload, back/forward
- Screen presets (viewport + diagonal) and custom entry
- Physical-size calibration (host PPI vs target PPI)
- Panel simulation profiles + advanced sliders
- Image drop mode (PNG/JPG)
- Scroll / navigation sync between panes
- Input forwarding into Target pane

### Out of scope (v1) — planned later on same core
- Lint rules (auto-flag hairlines, thin fonts, contrast)
- Windows / Android font rasteriser emulation
- Figma plugin push
- Swipe / overlay / toggle compare modes
- Headless CLI + CI snapshot mode
- Windows / Linux builds (Electron makes these cheap later; Windows build also gives native Windows 1x font rendering for free)

## 4. Architecture

Stack: Electron (latest stable), Vite, React, TypeScript, raw WebGL2 (no three.js), Vitest, Playwright for Electron.

```
┌ Main process ──────────────────────────────────────────────┐
│ NativePane   WebContentsView attached to window, host DPR   │
│ TargetSource offscreen webContents                          │
│              enableDeviceEmulation({deviceScaleFactor: 1,   │
│                screenSize/viewSize: preset viewport})       │
│              'paint' (dirtyRect, NativeImage) → FrameBus    │
│ FrameBus     dirty-rect BGRA slices over IPC, ≤30 fps cap   │
│ SyncBus      preload in both webContents: scroll + nav +    │
│              URL change → mirrored to the other             │
│ InputBridge  renderer pointer/key events ÷ S → sendInputEvent│
└─────────────────────────────────────────────────────────────┘
┌ Renderer (React + TS) ─────────────────────────────────────┐
│ Toolbar      URL · preset · panel profile · pixel-exact ×2  │
│ Left         NativePane region (view positioned by main)    │
│ Right        TargetCanvas (WebGL2)                          │
│              tex1x → nearest upscale ×S → PanelShader → out │
│ DropZone     image mode                                     │
│ Settings     host monitor diagonal (one-time)               │
└─────────────────────────────────────────────────────────────┘
```

### 4.1 Units

| Unit | Does | Interface | Depends on |
|---|---|---|---|
| `TargetSource` | Owns offscreen webContents at DPR 1; emits 1x frames | `load(url)`, `setViewport(w,h)`, `on('frame', {x,y,w,h,buf})`, `sendInput(ev)` | Electron |
| `FrameBus` | Ships dirty-rect slices main→renderer, rate-limited | `push(frame)`, renderer `subscribe(cb)` | Electron IPC |
| `SyncBus` | Mirrors scroll position and navigation between panes | preload script → `ipc('sync', {type, payload})` | Electron preload |
| `InputBridge` | Converts canvas pointer/key events to webContents input | `forward(domEvent, S)` | `TargetSource` |
| `Calibration` | Computes S from host display + preset | `computeScale(host, preset) → number` | pure TS |
| `PanelSim` | Shader params from profile; TS reference impl | `profileToUniforms(p)`, `simulatePixel(rgb, p)` | pure TS |
| `TargetCanvas` | WebGL2 texture upload, upscale, shader | React component | `FrameBus`, `PanelSim`, `InputBridge` |
| `ImageMode` | Decode drop, downsample to 1x, feed texture | `loadImage(file, scale) → ImageData` | pure TS + canvas |
| `Presets` | Screen presets + panel profiles data | typed constants | — |

Each pure-TS unit is testable without Electron.

### 4.2 Why offscreen rendering

A normal view with `enableDeviceEmulation` renders at 1x internally but the compositor bilinear-upscales to the host surface — soft, not pixel-accurate, and there is no hook to run a shader. Offscreen rendering exposes the raw 1x bitmap, which is the entire product.

### 4.3 Frame path

1. `paint` fires with `dirtyRect` and a `NativeImage` (BGRA, 1x).
2. Main crops to dirty rect, posts `{x,y,w,h,buf}` as transferable ArrayBuffer.
3. Renderer `texSubImage2D` into a persistent RGBA8 texture sized to the viewport.
4. Draw call: fullscreen quad, nearest filtering, uniform `S`, panel uniforms.

Rate cap 30 fps via `webContents.setFrameRate(30)`. Full-frame 1920×1080 BGRA is 8.3 MB; at 30 fps worst case ≈ 250 MB/s over IPC, acceptable on Apple Silicon for v1. If profiling shows stalls, fallback is Electron's shared-texture offscreen mode (`offscreen: { useSharedTexture: true }`), which avoids the copy.

## 5. Screen presets and scale

`S = hostPPI / targetPPI`, where `PPI = sqrt(w² + h²) / diagonalInches`.

Host PPI: `screen.getPrimaryDisplay().size × scaleFactor` gives physical pixels; diagonal entered by user once in Settings (default 27", editable). If the window is moved to another display, recompute from that display.

| Preset | Group | Viewport | Diagonal | PPI |
|---|---|---|---|---|
| 1366×768 15.6" | Laptop | 1366×768 | 15.6 | 100 |
| 1366×768 14" | Laptop | 1366×768 | 14 | 112 |
| 1366×768 11.6" (Chromebook) | Laptop | 1366×768 | 11.6 | 135 |
| 1280×800 11.6" (Chromebook) | Laptop | 1280×800 | 11.6 | 130 |
| 1600×900 17.3" | Laptop | 1600×900 | 17.3 | 106 |
| 1080p 15.6" | Laptop | 1920×1080 | 15.6 | 141 |
| 1080p 24" | Desktop | 1920×1080 | 24 | 92 |
| 1080p 27" | Desktop | 1920×1080 | 27 | 82 |
| 1440p 27" | Desktop | 2560×1440 | 27 | 109 |
| 1280×1024 19" (5:4) | Desktop | 1280×1024 | 19 | 86 |
| 1440×900 19" | Desktop | 1440×900 | 19 | 89 |
| Budget Android 6.5" @2x | Mobile | 360×800 @2x (720×1600) | 6.5 | 270 |
| iPhone SE 4.7" @2x | Mobile | 375×667 @2x (750×1334) | 4.7 | 326 |
| iPhone 6.1" @3x | Mobile | 393×852 @3x (1179×2556) | 6.1 | 461 |
| iPad 10.9" @2x | Mobile | 820×1180 @2x (1640×2360) | 10.9 | 264 |
| Custom | — | user | user | computed |

The preset dropdown is grouped (Laptops / Desktops / Mobile); the default is 1080p
24". v1.2 added the seven low-end entries — 1366×768 at 14"/11.6", 1280×800 11.6",
1600×900 17.3", 1080p 15.6", 1280×1024 19" and 1440×900 19". v1.3 added the four
mobile entries; the Custom screen stays 1x for now.

"Pixel-exact ×2" toggle forces `S = 2` regardless of PPI — useful when the user wants to inspect pixels rather than judge physical size. (More precisely `S = host scaleFactor`: device pixels shown 1:1, on mobile presets too.)

Target pane is a scrollable region; if `viewport × S` exceeds the pane, the canvas scrolls. Viewport dimensions clamp to 4096 per axis with a warning; on a mobile preset the clamp budget is *device* pixels, so the CSS limit shrinks by the factor (393×852 @3x = 1179×2556 fits).

### 5.1 Mobile presets (v1.3)

Real phones are 2x/3x — a phone preset rasterised at 1x would look *worse* than any
real device. A mobile preset therefore rasterises at the device's true
`deviceScaleFactor` and is shown at true physical size, which on a desktop monitor
means *minified*: an iPhone 6.1" packs 461 device PPI, so on a ~138 PPI host each
device pixel gets S ≈ 0.30 host pixels. All the calibration maths is per device
pixel — `targetPPI = hypot(cssW·dsf, cssH·dsf) / diagonal` — and the target-pane
footer states both the density and the per-device-pixel magnification:
`393×852 @3x · ×0.30`. Because S < 1, the 1:1 view minifies through the same
smooth (mipmapped) sampler fit mode uses; nearest decimation below 1 would moiré.

Implementation notes, verified by spike and asserted in `tests/e2e/mobile.spec.ts`:

- **Raster density.** `offscreen.deviceScaleFactor` is fixed at BrowserWindow
  creation, so changing the factor recreates the offscreen window (new window
  first, then destroy the old — the reverse order was observed to tear the
  replacement down with the old one). Each fresh window re-arms the
  first-navigation crash gate, and the page the target was showing is reloaded
  once the new gate settles. Paint frames are always CSS × dsf (1179×2556 for
  the iPhone 6.1"), and in-page `devicePixelRatio` equals the factor. The
  page to restore comes from tracked intended-URL state (set by `load()` and
  by committed navigations), never read off the dying window — mid-recreation
  that window shows `about:blank` and a rapid second density change would
  silently drop the real page. A density change does reset the target's own
  navigation history and scroll position (its history is not user-facing;
  scroll re-syncs on the next mirrored move).
  `enableDeviceEmulation` alone was tested and rejected for this job: under OSR
  it never scales paint bitmaps, whatever `deviceScaleFactor` it is given.
- **Viewport semantics.** `enableDeviceEmulation({ screenPosition: 'mobile' })`
  *does* work under OSR for layout: a page without `<meta name="viewport">` lays
  out at Chromium's 980px virtual viewport and is scaled to fit (visualViewport
  scale 393/980), while a page with the meta lays out at the preset's CSS width —
  both proven in e2e. Two caveats found by spike: Chromium wipes the emulation on
  every cross-document navigation (so it is re-applied in `did-navigate`, the
  earliest post-commit moment), and applying it before a window's first
  navigation commits segfaults the OSR renderer (so it is never applied earlier).
- **User agent.** Mobile presets set one Android-style mobile Chrome UA on the
  target webContents only (the native pane is "your dev view" and keeps its
  desktop UA). A single constant for phones and the iPad alike is a deliberate
  simplification; the Chrome version comes from the running Electron. Mobile-ness
  is keyed on dsf > 1 — the only signal the viewport payload carries — so a
  hypothetical 2x desktop preset would also be treated as mobile.
- **Sync.** URL and scroll sync keep working across the pair; scroll magnitudes
  can diverge when the two panes lay the page out at different widths, which is
  accepted (the panes are showing genuinely different layouts).

## 6. Panel simulation

Fragment shader, operating in linear light. Order:

1. **Contrast (black floor):** `c = floor + (1 - floor) * c`, `floor = 1 / contrastRatio`
2. **Brightness (backlight):** `c *= nitsTarget / nitsHost` — applied after the floor so black-level leakage scales with the panel's own backlight
3. **Gamut coverage:** `c = mix(vec3(luma(c)), c, coverage)`
4. **Bit depth:** quantise to `2^bits` levels; if `frc` enabled, add ordered 4×4 Bayer dither before quantising
5. **Gamma encode** to sRGB

Profiles (typed constants in `Presets`):

| Profile | Contrast | Gamut | Bits | FRC | Nits |
|---|---|---|---|---|---|
| Reference | off | off | 8 | — | host |
| Office IPS | 1000:1 | 100% sRGB | 8 | no | 300 |
| Budget TN | 700:1 | 72% sRGB | 6 | yes | 250 |
| Old laptop | 600:1 | 60% sRGB | 6 | no | 220 |

Advanced panel exposes each parameter as a slider. UI labels the feature "approximation — not colourimetric".

Host nits default 500 (editable in Settings alongside diagonal).

## 7. Image mode

- Drop PNG/JPG onto the window (or File → Open).
- Prompt for export scale (1x / 2x / 3x, default 2x).
- Downsample by integer box filter (area average) to 1x `ImageData`.
- Left pane shows the original image at its native pixels; right pane feeds the 1x data into the same texture and shader path.
- No input forwarding or sync in image mode; toolbar URL bar shows the filename and is read-only.
- Returning to URL mode restores the last URL.

## 8. Sync and input

- Preload script in both webContents listens for `scroll` (throttled to rAF) and `popstate`/`load`, sends `{type:'scroll', x, y}` or `{type:'nav', url}` to main.
- Main forwards to the other webContents, which applies `window.scrollTo` or `loadURL`. Guard flag prevents echo loops.
- Target canvas captures pointer and keyboard events, divides coordinates by `S`, calls `webContents.sendInputEvent`. Wheel events are forwarded too, so scrolling in Target also syncs back to Native.

## 9. Error handling

| Condition | Behaviour |
|---|---|
| URL fails to load | Chromium error page appears in both panes; toolbar shows a red badge with the error code |
| No `paint` for > 2 s while page is loading/alive | Target canvas overlays "No frames from target renderer" + Reload button |
| Non-image file dropped | Toast "Unsupported file type" |
| Display info unavailable | Fall back to `S = 2`, show a one-line notice in Settings |
| Preset viewport > 4096 px per axis | Clamp and show warning in the preset dropdown |
| WebGL2 unavailable | Fatal dialog on launch — app cannot function without it |

## 10. Testing

- **Unit (Vitest, pure TS):** `Calibration.computeScale`, `PanelSim.simulatePixel`, `ImageMode` downsampler, `Presets` schema.
- **Shader parity:** headless WebGL2 test renders a gradient fixture through `PanelShader`, `readPixels`, compares to `PanelSim.simulatePixel` per pixel within ±1/255.
- **Integration (Electron, Vitest + electron runner):** load fixture HTML containing a 0.5px hairline and 300-weight 12px text; assert Target frame dimensions equal preset viewport; assert the hairline's rendered row count differs from a 2x `capturePage` of Native; assert a scroll in Native arrives in Target within 100 ms.
- **E2E (Playwright for Electron):** launch app, enter URL, both panes render non-blank; switch preset; drop fixture PNG; image mode shows 1x result.

## 11. Milestones

1. Electron shell with Native pane + URL bar.
2. `TargetSource` offscreen at DPR 1 → raw frames visible in canvas (nearest ×2). **This milestone proves the product.**
3. `Calibration` + presets + Settings.
4. `PanelSim` shader + profiles + sliders.
5. `SyncBus` + `InputBridge`.
6. `ImageMode`.
7. Error states, tests, packaging (macOS, signed DMG).

## 12. Risks

- **IPC bandwidth** for full-frame paints — mitigated by dirty rects, 30 fps cap, shared-texture fallback.
- **Offscreen rendering uses software compositing** in Electron — acceptable; correctness over speed. Sites with heavy WebGL may run slowly in Target.
- **macOS font smoothing at 1x** differs from Windows ClearType — v1 shows macOS 1x truth, which still exposes hairline/weight/contrast problems. Windows build later gives Windows truth natively.
- **Electron API drift** — `enableDeviceEmulation` and offscreen `paint` are long-standing APIs; pin Electron major version.

## 13. v1.1 — Fit & pan

The target pane at, say, 1920×1080 × 1.5 is a 2889×1625-device-pixel canvas
inside an ~800 px pane. v1 relied on `overflow: auto` alone: macOS hides the
scrollbars, the wheel forwards to the page rather than the crop, and users read
the visible top-left corner as "cropped". Two additions, both renderer-local
(no new IPC):

- **Fit overview.** A `1:1 / Fit` segmented control in the toolbar. Fit scales
  the whole viewport into the pane — `min(pane×dpr/viewport, S)` per axis,
  never enlarged past 1:1 — through a LINEAR_MIPMAP_LINEAR sampler, because
  nearest decimation at ~0.3× moirés. The exact 1:1 path stays `texelFetch`,
  bit-identical to v1, and the panel simulation runs on the sampled colour in
  both paths. **Caveat: fit is a map, not the product** — a minified overview
  cannot be pixel-exact, and the footer says so (`fit ×0.42 · not
  pixel-exact`). A click in fit jumps back to 1:1 with the clicked target
  pixel centred in the pane; the wheel still browses the page from the
  overview; clicks and keys never forward from it.
- **Panning at 1:1.** Middle-button drag and Option+left-drag pan the pane
  under pointer capture; Option+wheel pans in natural direction. While a pan
  gesture is live (or Option is held over the canvas) nothing forwards to the
  page; a plain wheel forwards exactly as before. Applies in image mode too —
  the image is drawn through the same canvas.

## 14. Headless CLI (v1.2)

**What.** `bin/obsrv.js` (plain Node) spawns `electron out/main/cli.js -- <argv>`:
a second main-process entry that drives the same `TargetSource` the app uses —
same offscreen raster density, mobile UA/emulation, dsf recreation and crash
gates — with no window ever shown (`app.dock.hide()`, throwaway user-data dir).
Machine output (JSON) goes to stdout, human output to stderr; exit 0 success,
1 render failure, 2 usage error.

- `obsrv snap <url>` — render at a preset (or `--width/--height/--dsf`),
  optionally `--full-page` and a `--profile` panel simulation (mapped on the
  CPU through `simulatePixel`, the shader's parity-tested reference), write a
  PNG (`nativeImage.createFromBitmap` over the composited BGRA frame; channel
  order pinned by an e2e test decoding the PNG independently of Electron).
  `--matrix id,id,…` renders several presets per run.
- `obsrv diff <url>` — render the preset (the *target*, profile applied) and a
  *reference*: the same CSS viewport at dsf 2 — what a HiDPI dev sees —
  box-downsampled onto the target's 1x grid. Prints ink coverage, ink-row
  counts (reference rows counted on the raw 2x raster, so the ratio reproduces
  §10's 2:1 device-row finding), 8 horizontal band deltas, and humanised
  findings. Findings are informational; thresholds are the caller's job.

**Why.** Agents and CI need the product's truth without the GUI: "render this
URL the way a 1366×768 Chromebook or budget Android sees it, give me the PNG
and machine-readable findings" — then judge legibility from the image and
numbers, fix CSS, re-render.

**Quiescence.** `load()` resolves on did-finish-load, but paints trail it. The
capture forces a full repaint (`invalidate()`), composites dirty BGRA slices
into a device-pixel buffer, and settles once no paint has arrived for 400 ms
*and* a full-coverage frame has been seen since the last frame-size change.
`--full-page` measures `scrollHeight` after the first settle, regrows the
viewport (clamped to the 4096 device-px budget, warning when clamped) and
re-settles.

At `--timeout` the capture is *rescued*, never failed, as long as any pixels
arrived: a covered-but-noisy page (animation) and a page whose coverage never
completed both come back `settled: false`, exit code 0, with a warning naming
what was missing (uncovered percentage and the bounding box of the region that
never painted). An unsettled picture beats no picture, and machine consumers
gate on the flag. Only a surface that painted *nothing* is an error — there is
no image to return. The accumulated buffer is the rescue image on purpose:
`capturePage()` does work on an offscreen window but hands back a 1x
(DIP-sized) bitmap — 393×852 for a dsf-2 render whose raster is 786×1704,
`getScaleFactors()` `[1]` — and silently dropping to a fraction of the device
pixels would be a worse lie than an unsettled frame.

**Paint dirty-rect units (v1.6 fix).** Chromium's offscreen `paint` damage
rects are in device pixels — the same space as `image.getSize()` — *except*
the repaint `webContents.invalidate()` forces, which arrives in DIPs. Measured
on Electron 43 / macOS at CSS 400×300: an ordinary partial repaint of a CSS
box at (100, 60) 40×30 reports `200,120 80×60` at dsf 2 and `300,180 120×90`
at dsf 3, while `invalidate()` reports `0,0 400×300` at every density against
an 800×600 / 1200×900 bitmap. Read literally that is a top-left slice covering
1/dsf² of the frame, so the cumulative coverage gate stalled at exactly 75 %
(dsf 2) or 88.9 % (dsf 3) uncovered and dense-DPR snaps failed with "no full
frame painted within N ms" — page-dependently, because a page that happens to
emit one *ordinary* full-frame paint after the invalidate is rescued by it.
`shared/paint.ts` `isFullFrame` recognises both spellings of "the whole
frame"; a device-pixel partial repaint landing exactly on the DIP full-view
rect is read as full too, which is the safe direction (the caller sends the
entire correct bitmap instead of a slice — bandwidth, never pixels). The crop
was *not* mis-regioned by this: the DIP rect is anchored at (0, 0), so the
cropped pixels were the correct top-left quadrant, composited in the correct
place. The shipped consequence for the app was staleness rather than
corruption — an `invalidate()` at a mobile preset refreshed only the top-left
1/dsf² of the target pane, leaving the rest until the page repainted
naturally.

**dsf > 1 diff limitation.** `diff` is 1x-only in v1: for a dense preset the
"reference at 2× the density on the same grid" comparison would need a 4x/6x
raster past the 4096 budget, and the mobile presets already *are* the dense
render. Dense presets exit with a clear error pointing at `snap`. Likewise CSS
viewports over 2048px (1440p-27) cannot fit their 2x reference in the budget.
The reference render reuses `TargetSource` with a `mobileEmulation: false`
constructor opt-out (CLI-only; the app's dsf>1 ⇒ mobile coupling is unchanged)
so it stays a desktop page — only the raster density differs.

**MCP server (v1.3).** `bin/obsrv-mcp.js` runs `out/mcp/server.js` (compiled
by `tsconfig.mcp.json`, chained into `npm run build`): a stateless stdio MCP
server exposing the CLI as three read-only tools. `obsrv_snap` maps tool input
onto CLI argv (preset XOR custom dims validated up front), spawns
`bin/obsrv.js` into a per-call temp dir and returns the CLI's JSON as
structured content plus the PNG as an inline image (≤1.5 MiB, else the path
with a note); `obsrv_diff` returns the metrics JSON and the target/reference
paths (inline images opt-in); `obsrv_presets` serves the presets/profiles
catalog straight from `src/shared/presets.ts` without spawning. The server
never re-implements capture: the CLI keeps signals, user-data isolation and
crash fast-fail, and its stderr tail becomes the tool-error message (a wedged
run is SIGTERMed after the per-render budget plus boot headroom).

**Live drive (v1.4).** Headless renders are invisible; when the user has the
desktop app open, agent commands should drive the *visible* window — the URL
loads, presets flip, panel profiles apply on screen — while the agent still
gets captures back. A toolbar toggle "Agent control" (neutral chrome,
`aria-pressed`, persisted as `settings.agentControl`, default **off**;
`OBSRV_AGENT_CONTROL=1` force-enables a session in memory) starts a loopback
control server in main (`src/main/controlServer.ts`): plain `node:http` bound
to **127.0.0.1** on an ephemeral port, discovered through `control.json`
(`{ port, token }`, mode **0600**, in `userData`; removed on toggle-off and
quit). One endpoint, `POST /` with `{ token, command, payload? }`; the token
(32 random bytes, hex) is compared constant-time (hash-then-`timingSafeEqual`)
on **every** command, `status` included — the 0600 file already proves "same
user", so a token-free status would only leak state for no benefit; a wrong
token is a detail-free 403. Commands re-enter existing validated paths only:
`navigate` through the same normalise/`sync.expect`/both-panes path as
`IPC.navigate` plus the MCP scheme allowlist; `setPreset` / `setProfile` /
`setViewMode` forward an `IPC.agentApply` patch the renderer store applies
with its own toolbar actions (the custom preset is refused — it means
"whatever is typed in the fields"), confirmed against a main-side mirror the
renderer keeps fresh over `IPC.uiState`; `status` reads that mirror plus the
target's URL; `captureVisible` is `win.webContents.capturePage()` — the
window as the user sees it. Received commands light a small neutral AGENT
badge in the toolbar for ~3 s (`IPC.agentActivity`).

MCP side: discovery derives the per-platform userData path under plain node
(`OBSRV_CONTROL_FILE` overrides; group/other-readable or malformed files are
treated as "not reachable") and proves liveness with a tokened `status`
(500 ms). `obsrv_snap` gains `mode: auto | headless | live` (default auto):
live when the app answers — navigate, optional preset/profile, a bounded
redirect-tolerant wait for `status.url`, then the window PNG, with
`mode: "live"` in the result — else the unchanged headless render, now
labelled `mode: "headless"`. Custom dims and `fullPage` always render
headlessly with a note (even under explicit `live`); `waitMs` is ignored live
with a note; `mode: "live"` with no app is an actionable error, never a
silent fallback. `obsrv_drive` (`readOnlyHint: false` — it changes what the
user's window shows) applies `{ url?, preset?, profile?, viewMode? }` and
returns the confirming status. `obsrv_snap` keeps `readOnlyHint: true` (it
renders and captures), but its description states plainly that a live snap
steers the open app window — navigation, preset flip — as its means of
capture, so auto-approving clients are not surprised: that visible steering
is the feature. `obsrv_diff` stays headless-only: the
comparison needs both rasters, which the visible app cannot show.

The server itself adds browser-shaped defence-in-depth ahead of the token
check: any request carrying an `Origin` header is refused (403 — a browser's
cross-site POST always sends one; same-user local clients never do), and the
`Content-Type` must be `application/json` (415 — a no-cors "simple request"
cannot send it). The renderer-mount apply queue is bounded (32 entries,
oldest dropped with a one-time warning).

**Drive controls (v1.5).** Live drive chooses *what* the app shows; ten more
commands let a drive session steer *where the user looks* and interact, so it
works as a guided demo. Same rules as v1.4: every payload through a shared
validator, every effect through an existing validated path — no
`executeJavaScript`, no new privileged surface.

| Command | Payload | Effect |
|---|---|---|
| `scroll` | `{ x, y, scrollSelector? }` (CSS px, `parseScrollRequest`; selector non-empty, ≤ 512 chars) | Absolute page scroll, sent to *both* panes over the pane-sync `applyScroll` channel (an applied scroll is deliberately not re-reported, so main fans out rather than relying on the mirror). Replies `{ ok: true, scrolled: { x, y }, scroller: 'root' \| 'element' }` — see "Scroll round-trip" below. |
| `panTo` | `{ x, y }` (target px, finite ≥ 0) | Centres the target pixel in the pane's 1:1 view via `IPC.agentApply` → the same clamped `centreScroll` maths as a fit click; from fit it jumps to 1:1 centred there. |
| `click` | `{ x, y, button? }` (CSS px; validated inside the live viewport, refused not clamped) | mouseDown + mouseUp (clickCount 1) through `parseInputEvent` → `target.sendInput` — the canvas-forwarding path. A click may navigate; that mirrors as usual. |
| `highlight` | `{ x, y, width, height, durationMs? }` (rect like `parseRect`, ≥ 1×1; duration default 2000, clamped 250–10000) | A temporary neutral overlay (light outline, dark dashed inner edge — no hue, per the style spec) drawn over the rect at the canvas scale, `pointer-events: none`; a new highlight replaces the previous, auto-removed after its duration. |
| `back` / `forward` / `reload` | — | The toolbar handlers verbatim: native-only history (the mirror carries the target), reload reloads both panes. |
| `setPixelExact` | `{ on: boolean }` | `IPC.agentApply` → the store's own toggle. |
| `captureTarget` | — | `capturePage` cropped to the target pane's window-relative bounds (CSS px), which the renderer reports with every `uiState` (measured by ResizeObserver); unknown bounds fall back to the full window with a warning. |
| `focusWindow` | — | `win.show(); win.focus()`. |

Confirmation: `setPreset` / `setProfile` / `setViewMode` keep their v1.4
mirror-confirmed replies (`applied: true`), because the uiState mirror
carries those fields. `setPixelExact`, `panTo` and `highlight` are
accepted-not-confirmed — the reply's `ok: true` means the validated patch
was queued for the renderer (fire-and-forget), not that it has visibly
applied; the mirror does not carry them, and confirming would add a
renderer round-trip for presentation-only state. Stale-highlight hygiene is
the renderer's: a committed navigation (reload included), a preset/custom
viewport change or a mode switch clears any showing highlight, and the
expiry timer is seq-guarded so it can never remove a newer highlight than
the one it was armed for.

**Scroll round-trip (v1.6).** `scroll` used to be fire-and-forget, which made
it a silent no-op on the app-shell pattern: with `html, body { overflow:
hidden }` and an inner `overflow-y: auto` scroller (dashboards, editors, most
"web app" landings) `window.scrollTo` clamps to 0 without throwing, and the
reply was indistinguishable from a real scroll. Two changes:

- *Scroll-host detection.* When `document.scrollingElement` has nothing to
  scroll, the sync preload finds the scroll host — the largest-by-client-area
  visible descendant whose computed `overflow-x/y` is `auto` or `scroll` and
  which actually overflows, depth-first tiebreak — and writes the offset to
  *its* `scrollTop`/`scrollLeft`. Absolute-offset semantics and two-pane
  synchronisation survive: both panes run the same detection over the same
  DOM. The walk visits at most 2000 elements, beyond which the best candidate
  so far wins, so a pathological DOM cannot stall the preload.

  Visibility is `checkVisibility({ visibilityProperty: true, opacityProperty:
  true })` (guarded for engines without it): `visibility: hidden`, `opacity: 0`
  and hidden `content-visibility` all keep full client area, so a closed drawer
  would otherwise win "largest scroller". An element translated off-canvas is
  still eligible — transforms position a great many *open* panels too, and
  `scrollSelector` covers a page that ever hits it. Only `display: none`
  subtrees are pruned, and only after a computed-style check: client area
  cannot stand in for "has no box" (an inline `<span>` wrapper and a `display:
  contents` wrapper both report zero client area, and pruning on that hid every
  scroller beneath them), and `checkVisibility` cannot either (it answers false
  for `display: contents` exactly as for `display: none`). The style lookup
  runs for boxless elements only, never the whole tree.

  The resolved element is cached per document. The cache is revalidated against
  the element it holds — dropped when it detaches, stops being able to scroll,
  or the root becomes scrollable again — but it does *not* re-run the walk to
  see whether a larger candidate has appeared, so an SPA that mounts a bigger
  scroller beside the cached one keeps scrolling the cached one until that one
  goes away. `scrollSelector` names the container outright when that bites.
- *Achieved-offset reply.* `applyScroll` carries a correlation id when someone
  is waiting. The preload writes the offset (`behavior: 'instant'`, so a
  page's `scroll-behavior: smooth` cannot make the read-back lie), reads it
  back, and replies on `IPC.scrollResult`. Main awaits the **target** pane's
  reply, bounded at 1 s, and answers `{ ok: true, scrolled: { x, y },
  scroller }`; on timeout `{ ok: true, scrolled: null, warnings: ['scroll
  offset could not be confirmed'] }`. The native pane gets the identical
  apply, unwaited. The pane-sync mirror sends no id and expects no reply.

`scrollSelector` is the escape hatch for pages the heuristic misjudges
(several large scrollers, a virtualised list that translates content). The
preload passes it to `document.querySelector` in its isolated world — never
evaluated as code — and never falls back: a selector that matches nothing, or
an element that cannot reach the offset, comes back with `scrolled` reflecting
reality plus a warning saying so.

**Reach limit.** Both the walk and `scrollSelector` see the light DOM of the
top-level document only: neither `children` traversal nor `querySelector`
crosses a shadow root or an iframe boundary. A scroller inside either is
unreachable, and since the escape hatch has the same reach, a web-component
app that puts its scroller in a shadow root has no way through at all. Piercing
would mean walking `shadowRoot` and same-origin frame documents, and driving a
cross-origin frame is not something this path should grow.

Reporting stays one-way: only `window` scroll events are mirrored back, so a
user dragging an *inner* scroller in the native pane is not reflected in the
target. Element scroll events do not bubble to `window`, so the report side
never sees it. Mirroring that is a deliberate follow-up; `findScroller` in
`src/preload/sync.ts` is written to be reusable by it.

MCP: `obsrv_drive` gains the matching optional inputs, run in a documented
fixed order — focus → url → preset → profile → viewMode → pixelExact →
reload → back → forward → scroll → panTo → click → highlight — with the
final `status` as the result; after a click the server polls status briefly
(2 s bound), so a click that navigates is reflected in that result. A `scroll`
adds `scrolled`, `scroller` and any `warnings` to that result, so an agent can
tell "scrolled" from "clamped" without taking a capture and diffing it.
`obsrv_snap` live mode gains `capture: 'window' | 'pane'` (default window;
`'pane'` uses `captureTarget` and includes the pane's footer readout; the
reported width/height are DIPs, the PNG raster is DIPs × display scale);
headless renders note the option was ignored.

#### 14.1 Capturing a driven state (v0.6.1)

A navigate is a fresh `loadURL`, so it resets scroll. Two consequences were
wrong until this revision:

- `liveSnap` navigated on *every* live snap, even when the app was already
  showing that URL. It now compares the requested URL against `status.url`
  (parsed, through `normalizeUrl`, so `http://h:5173` matches the committed
  `http://h:5173/`) and skips the navigation when they match. The result
  carries `navigated`, and `settled` is trivially true when nothing moved.
- `obsrv_drive` could scroll but not photograph; `obsrv_snap` could
  photograph but only after navigating. Neither could answer "show me the
  page scrolled to y". `obsrv_drive` now takes `capture: 'window' | 'pane'`,
  running last in the fixed order (…→ highlight → capture), and returns
  `pngPath`, `width` and `height` plus the inline image. Both tools share one
  `liveCapture` helper, so the PNGs are produced identically.

`obsrv_drive` remains the only way to capture a state that took several
commands to reach, because it never navigates unless given `url`.

#### 14.2 What a capture waits for, and what it frames (v0.7.1)

A preset change recreates the offscreen target at a new viewport and reloads
the page. `setPreset` confirms only that the *renderer store* applied the
change, so a capture fired straight after photographed the previous texture —
and the status returned beside it described the new state. The tool contradicted
itself: `presetId: laptop-768` next to a 360x800 render.

`captureTarget` and `captureVisible` now settle first: poll `getViewport()`
until two identical reads (the resize has stopped), force a repaint, wait for
that frame, then allow a short draw window. Bounded at 4 s; on expiry the
capture still returns, with a warning saying it may show a transitional frame.
`navigate` never needed this — it already awaits both panes' `loadURL`.

`captureTarget` also crops to the **render** rather than the pane: the renderer
reports `canvasBounds` (the canvas rect clipped to the pane) alongside
`targetBounds`, and the capture uses it. At 1:1 a desktop render overflows the
pane and the crop is the visible part; minified — a mobile preset, or fit mode —
the crop hugs the render, so the PNG is the screen under test and nothing
else.
