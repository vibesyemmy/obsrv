# Obsrv — multi-tab sessions

**Date:** 2026-08-28
**Status:** Draft — awaiting review
**Extends:** `2026-08-22-obsrv-design.md` (§4 architecture), and the chrome specs
`2026-08-23-obsrv-ui-style.md`, `2026-08-27-obsrv-toolbar-design.md`.

## The problem

Obsrv answers "how does this URL look on that screen?" for exactly one URL and one
screen at a time. The workflow it cannot express is the one people reach for tabs to
do: hold a desktop view and a mobile view of the same site open at once and flip
between them, or keep a staging page and its production counterpart side by side in
time rather than space.

Today that means retyping a URL and re-picking a preset, and losing the scroll
position and page state of whatever you left.

## The architecture this lands on

The two panes are not two views, and the difference governs the whole design.

| | Native pane | Target pane |
|---|---|---|
| Object | `WebContentsView` (`nativePane.ts`) | hidden `BrowserWindow`, `offscreen: { deviceScaleFactor }` (`targetSource.ts`) |
| Attached to | `win.contentView.addChildView` — an OS-level overlay | nothing |
| How it reaches the screen | the OS composites it | `paint` → BGRA dirty rect → IPC → **one** WebGL2 canvas in the renderer |

A tab is therefore **one `WebContentsView` plus one offscreen `BrowserWindow`** — two
Chromium renderer processes.

**Tab switching recreates nothing.** Each tab's offscreen window is created at its own
device scale factor and keeps it for life. Activation re-points the frame bus and
resumes painting; that is all. The OSR recreation path — and its two documented
Electron 43/macOS hazards, the destroy-order teardown and the first-navigation
segfault — is reached only when a preset change inside a tab crosses a density
boundary, exactly as it is today.

## Cost, and the lever that pays it

`TargetSource` sets `backgroundThrottling: false` and `setFrameRate(30)`. Left alone,
every background tab would rasterise a full viewport thirty times a second forever.

**Background tabs call `webContents.stopPainting()`; the active tab calls
`startPainting()`.** The page stays loaded — DOM, JS timers, scroll position, network
all live, which is what "background tabs stay loaded" has to mean — it simply stops
producing pixels nobody is looking at. This is mandatory, not an optimisation.

The native views have no equivalent lever, so **tabs are capped at 12**. Past that the
process count alone makes the app worse than the problem it solves.

## Data model

### Main

A `TabSession` owns what `boot()` and `registerIpc` currently hold as loose singulars:

```
TabSession
  id                  stable string, generated once, never reused
  native              NativePane
  target              TargetSource
  sync                SyncBus            per pair
  presetId, profileId, viewMode, pixelExact, mode
  viewportPending, viewportArrived       the resize-settle pair
  painting            boolean
```

`AppContext` becomes `{ win, tabs, activeId, bus, toolbarH }`.

**`FrameBus` stays singular.** There is one canvas in the renderer, so there must be
one bus; N buses racing to fill one texture is a defect, not a feature. It gains
`setSource(target)`, which re-points it and invalidates once so the new tab paints a
full frame immediately.

### The global-channel problem

`ipcMain.on` is process-global. `attachSyncBus` registers `IPC.syncScroll` and
`attachFrameBus` registers `IPC.frameSubscribe`; instantiated per tab, every instance
would receive every message — a scroll in one tab moving another.

**Each channel keeps exactly one `ipcMain` listener, owned by a router that resolves
`e.sender` to its tab.** `SyncBus` loses its own registration and gains a method the
router calls. This is the change most likely to produce silent cross-tab corruption if
done casually, and it is where the tests should push hardest.

### Renderer

The store's per-session fields — `url`, `presetId`, `custom`, `profileId`,
`profileOverride`, `viewMode`, `pixelExact`, `mode`, `image`, `error`, `targetLoading`,
`agentPan`, `agentHighlight` — move into `tabs: Record<id, TabState>` behind
`activeId`. Selectors read through the active tab, so component code changes very
little.

`panes`, `surround`, `split`, `settings`, `host` and `update` stay global: they
describe the window and the machine, not the page.

### Persistence

**`tabs.json` in userData, not `settings.json`.** Different lifetime, different failure
mode: a corrupt tab list must not cost the user their monitor calibration. Same
validation shape as `settings.ts` — every field checked with a fallback, a malformed
file treated as empty rather than fatal.

Stored per tab: `{ url, presetId, profileId }`, plus `activeIndex`. **Scroll position
is not persisted** — restoring a scroll into a page that may have changed underneath
is a guess presented as a memory. An empty or missing file opens one blank tab, which
is today's behaviour exactly.

## The tab bar

A third chrome row **above** the browse row, matching every browser and putting the
tab strip furthest from the panes. Chrome height goes 82px → roughly 114px;
`TOOLBAR_H` in `src/main/ipc.ts` and the `.chrome` height assertion move with it.

Per the style spec: neutral greys only, no hue, the active tab marked by a fill step
and weight — the idiom `.segmented` and `.menu-row` already use. Tab titles come from
the page title, falling back to the host, falling back to the URL. A close button per
tab, a new-tab button at the end of the strip. **Reordering is out of scope for the
first cut.**

Keyboard: `Cmd+T` new tab, `Cmd+W` close tab, `Cmd+1`–`Cmd+9` switch (9 = last tab, as
browsers do). These join the existing application menu so they work while the native
pane — an OS-level view outside the renderer's document — holds focus, the same reason
`Cmd+L` is routed through the menu today.

Closing the last tab opens a fresh blank one rather than closing the window; the window
is the app, and an empty app with no way back is a trap.

## Agent control

`obsrv_drive` and `obsrv_snap` act on the **active tab**, resolved per command rather
than bound at drive start. A command that silently succeeded on a tab the user cannot
see would not surface until the drive ended.

**`status` gains `tabId` and `tabIndex`.** The agent already reads `navigated` and
`settled` to understand what happened to its command; the tab it landed on is the same
contract. An agent that cares can compare across calls and notice the user moved.

**The driven tab is marked in the UI.** While agent control is on, the tab the agent is
acting on carries a persistent neutral marker — the 2px inset rule the surround control
and menu rows already use for selection — and brightens for ~3s on each command,
exactly as the existing `AGENT` chip does. No hue, no glow: a blur would be the first
shadow in the app, and the rule against it is what keeps the chrome from biasing the
render beside it.

## MCP and headless are untouched

`src/cli/` constructs its own `TargetSource` and never sees a window. It has no tab
layer, needs none, and this spec adds nothing to it. The only MCP-visible change is the
two new `status` fields.

## Risks

1. **Cross-tab message leakage** through the global `ipcMain` channels. Mitigated by
   the single-listener router; tested by driving two tabs and asserting isolation.
2. **Process count.** 12 tabs is 24 renderers. Capped, and background targets stop
   painting.
3. **`registerIpc` is already a long function** holding a great deal of closure state.
   Turning each value into a per-tab field will grow it past what is comfortable to
   reason about; the session state should move onto `TabSession` rather than into a
   wider closure.
4. **Test surface.** `globalThis.__obsrv` exposes `AppContext` wholesale and specs
   reach into `__obsrv.native` directly. Changing that shape touches many e2e files.

## Test plan

**Unit** — the pure tab-list module: add, close, activate, close-the-active (which
neighbour gets focus), the 12 cap, `tabs.json` round trip, a malformed file loading as
empty, title derivation from URL.

**E2E** —
- A new tab is independent: set a different preset in each, both survive switching.
- A background tab keeps its page state and scroll across a switch.
- A background tab is not painting, and resumes on activation.
- A scroll in one tab does not move another (the leakage risk).
- Tab URLs are restored on relaunch; scroll is not.
- `Cmd+T`, `Cmd+W`, `Cmd+1`–`9` work while the native pane holds focus.
- Closing the last tab leaves one blank tab, not a dead window.
- `status` reports the active tab's id, and it changes when the user switches.
- The driven-tab marker appears on the right tab and only while agent control is on.
