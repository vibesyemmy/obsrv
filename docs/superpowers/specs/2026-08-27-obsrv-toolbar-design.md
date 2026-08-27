# Obsrv — toolbar cleanup and solo-target view

**Date:** 2026-08-27
**Status:** Approved 2026-08-27
**Supersedes nothing.** Extends `2026-08-23-obsrv-ui-style.md`, which still governs
colour, neutrality and the pane surround.
**Ships as:** 0.8.0

## The problem

Two complaints, and they are different problems with different fixes.

**Cluttered.** The toolbar carries sixteen interactive targets in a single 44px strip
with no hierarchy: back, forward, reload, URL field, image-close, preset select,
view-mode pair, profile select, pixel-exact checkbox, update button, three surround
swatches, agent toggle, panel drawer, settings drawer — plus three status elements
that appear and disappear (loading, error badge, clamped warning), reflowing
everything to their right when they do. The URL field takes whatever space is left,
so on a narrow window the controls crush together while on a wide one the field is
mostly empty. Nothing in the strip says which controls matter.

**Amateur.** Every glyph is a literal text character typed into JSX — `‹`, `›`, `⟳`,
`▦`, `⚙`, `✕`. They render in whatever the system font resolves, at inconsistent
optical weights and baselines, and they cannot be aligned to a grid. Buttons are
26×24px, below the 28px floor where a pointer target stops feeling accidental.
`.toolbar select` is the native macOS select, which brings its own radius, its own
inset shadow and its own font — three things this app's style spec forbids
everywhere else. Everything is one type size.

## The governing constraint, restated

The 2026-08-23 spec says the chrome must not editorialise about the thing being
measured. That rule was over-applied: it was read as *the whole app must be
featureless*, which is why the toolbar has no hierarchy or type scale.

The constraint is colorimetric and it is about proximity. Simultaneous contrast acts
across an edge. A control 40px from the canvas, separated by a 1px line and a strip
of neutral chrome, does not shift the perceived hue of a render.

So the rule splits in two:

- **Within the pane frame** — the surround, the pane borders, the footers: unchanged.
  Exactly neutral greys, zero border-radius, no shadow, no translucency, no accent.
- **In the chrome above it** — proper hit targets, a real type scale, a small radius
  on controls, one step of surface separation. Still achromatic. Still no accent.

## Layout

Two strips, replacing the single one. This is Chrome DevTools' device-mode grammar,
not Chrome's browser toolbar: browsing controls and the controls that describe the
simulated screen are different jobs and get different rows.

### Row 1 — browsing (44px, `--chrome-1`)

```
[←] [→] [⟳]  [ URL field ......................... ]  [status]  [⋮]
```

- Back, forward, reload: 30×30 icon buttons.
- URL field: `flex: 1`, 30px tall, `--field` background, 12.5px.
- Image mode replaces the status slot with the close-image button, and the field goes
  read-only showing the filename — unchanged behaviour, spec §7.
- **Status cluster**, right of the field, before the overflow: loading, error badge,
  clamped-viewport warning, update-available button. Fixed order, and it is the only
  region that grows and shrinks — so appearing status reflows nothing but itself.
- `⋮` overflow: 30×30, last.

### Row 2 — the screen under test (38px, `--chrome-0`)

```
[ 1366×768 · 15.6" ▾ ]  [1:1|Fit]  [Both|Target]  [ Budget TN ▾ ]  [■■■]      [AGENT]
```

Left-aligned, `gap: 8px`, then a flex spacer, then the agent indicator right-aligned.
`--chrome-0` (darker than row 1) so the two rows read as separate registers rather
than one 82px slab.

### Overflow menu (`⋮`)

Pixel-exact · Panel controls · Settings · Agent control · Check for updates.

Rare controls only. Panel controls and Settings still open the existing drawers; the
menu item shows their open state.

**Agent control is the exception that must not hide.** It is rare to *set* and
critical to *see*: it opens a loopback control server. When it is on, row 2 shows a
persistent `AGENT` chip regardless of whether an agent is currently driving. The
existing three-second activity flash stays, as a brighter state of the same chip.

### Vertical cost

44px → 82px, a net 38px. On a 900px window that is 4.2% of height, and none of it
comes off the panes' width. `TOOLBAR_H` in `src/main/ipc.ts` (the fallback layout
main uses before `NativeSlot` first reports) moves 44 → 82, and the comment in
`styles.css` that pins the two together moves with it.

## Solo-target view

A `Both | Target` segmented control, sitting beside `1:1 | Fit` because it is a view
control over the same thing.

Two states. Native-only is not offered: that is a browser, and the user has one.

### State

`panes: 'both' | 'target'` on the store, defaulting to `'both'`. Not persisted to
settings — it is a per-look toggle like view mode, not a preference.

### Renderer

When `panes === 'target'`, `App` renders neither `NativeSlot` nor `ImagePane`, and the
target pane takes the full width of `.panes`. Nothing else changes: `targetBounds`
and `canvasBounds` are already ResizeObserver-driven, so the agent-control crop
follows the new geometry without new code.

### Main

`NativeSlot` unmounting stops `setNativeBounds`, but the `WebContentsView` keeps its
last bounds and stays visible — it is an OS-level overlay, so it would float over the
target pane. An explicit signal is required.

Add `setNativeVisible(visible: boolean)` to the IPC surface. Main keeps both inputs
and derives visibility in one place:

```ts
// mode and panes are the only two inputs; deriving in one place stops them
// fighting over the same view.
const applyNativeVisibility = (): void => {
  native.setVisible(mode === 'url' && panesVisible)
}
```

`setMode` and `setNativeVisible` each update their input and call it. Neither calls
`native.setVisible` directly any more.

### SyncBus stays enabled

Image mode disables the bus because there is no live page. Solo-target is not that
case: the native pane is still loaded, still receiving `did-navigate`, still the
navigation master. Disabling the bus here would break the URL bar, back/forward and
link-clicks in exactly the mode where the target pane is the only thing on screen.

So `setNativeVisible` must **not** touch `bus.setEnabled`. Only `setMode` does.

### Risk, and how it is settled

A hidden `WebContentsView` may be background-throttled by Chromium, which would stall
the scroll mirror. Scroll sync is driven by explicit `scrollTo` from a preload rather
than by rAF, so this is unlikely — but "unlikely" is not "tested".

**Settled: hiding the view is enough; the fallback was not needed.** The e2e test `a
scroll in solo target still reaches the hidden native pane` (`tests/e2e/solo-target.spec.ts`)
switches to solo target, confirms `native.isVisible()` is `false`, scrolls the target
pane's page to y=1600 in the 5000px `tall.html` fixture, and reads the hidden native
pane's `window.scrollY` back through its `webContents`. It arrives at exactly 1600 —
the full offset, not a stale or partial one — and it arrives fast enough that the whole
test runs in ~150ms, so the mirror is not merely eventually consistent under throttling.

Nothing but `SyncBus` writes that offset: an agent's `scroll` drives both panes directly
via `scrollBoth`, and it is not used here. The test was verified to have teeth by making
`SyncBus`'s scroll mirror drop sends bound for the native pane: the native assertion then
failed with `Received: 0` while the target still reached 1600, so a stalled mirror is
caught and nothing else masks it.

The fallback — keeping the view visible but parked beneath the target pane's canvas —
therefore stays unbuilt. `applyNativeVisibility` remains a plain
`native.setVisible(modeIsLive && panesShowNative)`.

### Agent surface

`panes` joins `AgentApplyPatch` and the `status` report, validated the same way
`viewMode` is. Solo target is precisely what an agent wants before a capture, and
`obsrv_drive` gaining it costs one field.

## Craft

- **Hit targets** 30×30 minimum. Delete `.toolbar button { width: 26px }` — that
  blanket rule is specificity (0,1,1) and is what silently truncated the update
  button to "v0." in 0.7.0. Every control sizes itself; no blanket rule survives.
- **Icons.** `lucide-react`, a new runtime dependency. Per-icon imports tree-shake, so
  the eight used cost roughly 2KB; they are inline SVG components with no font file
  and no network fetch, which matters in a signed Electron app. Its default 1.5px
  stroke on a 24px grid already matches this spec.

  | Use | Import |
  |---|---|
  | Back / forward | `ArrowLeft`, `ArrowRight` |
  | Reload | `RotateCw` |
  | Overflow menu | `EllipsisVertical` |
  | Close image mode | `X` |
  | Panel controls (menu row) | `SlidersHorizontal` |
  | Settings (menu row) | `Settings` |
  | Select chevron | `ChevronDown` |

  It goes in **`devDependencies`**, not `dependencies`. `electron.vite.config.ts`
  applies `externalizeDepsPlugin()` to main and preload only, so the renderer bundles
  its imports — the built `out/` carries the eight icons inline and needs nothing
  resolved at runtime. Listing it as a runtime dependency would put it in the
  `getobsrv` npm tarball, which ships the CLI and MCP server and never loads a
  renderer.

  Rendered at `size={16}`, `strokeWidth={1.5}`, colour inherited via `currentColor`.
  Icon-only buttons keep their existing `aria-label` and `title`; the SVG is
  `aria-hidden`. The library is chosen over hand-drawn paths because the toolbar will
  grow again and the next control should not need new paths drawn.
- **Selects.** A styled shell — `--chrome-2`, 5px radius, our own chevron — with the
  native `<select>` kept for the popup and its keyboard behaviour, made transparent
  over the shell. Native semantics, our surface.
- **Type scale**, three sizes: 12.5px URL, 11.5px controls, 10px status and labels.
  Pane footers keep their existing mono/tabular treatment untouched.
- **Radius** 5px on controls in the chrome. Zero everywhere in the pane frame.
- **Surfaces**: row 1 `--chrome-1`, row 2 `--chrome-0`, controls `--chrome-2`, fields
  `--field`. No shadow anywhere.

## Out of scope

Pane footers, the surround values, panel-simulation controls' contents, settings
contents, the drawers' internals. This changes what is in the chrome and how it
looks, not what any control does — with the single exception of the new toggle.

## Test impact

Nine files select on toolbar internals and will need updating with the markup:

`tests/unit/store.test.ts`, `tests/unit/calibration.test.ts`,
`tests/e2e/controls.spec.ts`, `tests/e2e/panes.spec.ts`,
`tests/e2e/image-mode.spec.ts`, `tests/e2e/update.spec.ts`,
`tests/e2e/live-drive.spec.ts`, `tests/e2e/mobile.spec.ts`,
`tests/e2e/fit-pan.spec.ts`.

Controls that move into the overflow menu (pixel-exact, panel, settings, agent) need
their tests to open the menu first. This is mechanical, but it is nine files, and the
plan budgets for it rather than discovering it.

New tests:

- Solo target hides the native view and gives the target pane full width.
- Scroll still mirrors to the hidden native pane in solo mode (the throttling risk).
- Returning to `Both` restores the native view at correct bounds.
- `obsrv_drive` can set `panes`, and `status` reports it.
- The update button renders at its full width — a bounding-box assertion, not a text
  assertion, since text passed while the button was clipped.
