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

| Preset | Viewport | Diagonal | PPI |
|---|---|---|---|
| 1080p 24" | 1920×1080 | 24 | 92 |
| 1080p 27" | 1920×1080 | 27 | 82 |
| Laptop 15.6" | 1366×768 | 15.6 | 100 |
| 1440p 27" | 2560×1440 | 27 | 109 |
| Custom | user | user | computed |

"Pixel-exact ×2" toggle forces `S = 2` regardless of PPI — useful when the user wants to inspect pixels rather than judge physical size.

Target pane is a scrollable region; if `viewport × S` exceeds the pane, the canvas scrolls. Viewport dimensions clamp to 4096 per axis with a warning.

## 6. Panel simulation

Fragment shader, operating in linear light. Order:

1. **Brightness:** `c *= nitsTarget / nitsHost`
2. **Contrast (black floor):** `c = floor + (1 - floor) * c`, `floor = 1 / contrastRatio`
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
