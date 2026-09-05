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

## Quickstart

**The desktop app** — download the DMG for your chip from
[Releases](https://github.com/vibesyemmy/obsrv/releases), drag Obsrv.app to
Applications, then clear the quarantine flag once (the build is not yet
notarised, so macOS falsely reports it as "damaged"):

```bash
xattr -cr /Applications/Obsrv.app
```

Open it and set your monitor's diagonal in Settings — that one number is what
makes the target pane render at true physical size.

**The CLI, and Claude Code / MCP clients:**

```bash
npm i -g getobsrv                                          # or use npx -y getobsrv
obsrv install-skill                                        # teach Claude Code when to use it
claude mcp add --scope user obsrv -- npx -y getobsrv mcp   # give it the tools
```

`install-skill` copies the [obsrv-screens skill](skills/obsrv-screens/SKILL.md)
into `~/.claude/skills/` (`--dest` for elsewhere, `--print` to pipe it into
another agent framework). The skill is what makes an agent reach for Obsrv on
its own when frontend work needs checking; the MCP registration is what gives
it the tools to do so. New sessions pick both up.

**Both together** — install the app *and* the tools, then flip **Agent control**
on in the app's toolbar: agent testing now drives the window you are watching
instead of rendering invisibly.

## Use

```bash
npm install
npm run dev
```

Type a URL (localhost is fine), pick a target screen preset (1080p 24", 1366×768
laptop, iPhone 6.1" @3x, …), pick a panel profile (Reference, Office IPS, Budget TN, Old laptop) or open
the side panel (the sliders icon) for the rest: text scale, throttle, the **onion skin** — the
page's HiDPI render ghosted over the 1x raster, what the cheap raster moved, in one place
(`docs/onion-skin.md`) — the panel sliders and colour vision. A condition in force is named in the
target pane's footer, and clicking it opens the panel at its control. Enter your own monitor's
diagonal in Settings once so the target pane renders at true physical size. Drop a 2x/3x PNG or JPG export to check a design
before it's built.

The target pane opens in **Fit**, a fit-to-pane view of the whole render. Fit
never enlarges past 1:1, so a render that already fits is shown at true size;
a larger one is smoothly minified to fit, which is not pixel-exact — the footer
says so, and names the magnification. Fit is fully interactive: clicks, drags,
the wheel and the keyboard all reach the page.

Switch the toolbar's `1:1 / Fit` control to **1:1** for true magnification,
which usually overflows the pane: pan with a middle-button drag, Option+drag or
Option+wheel. From fit, **Option+click** jumps straight to 1:1 with the clicked
spot centred (plain clicks belong to the page).

The `Both / Target` control beside it hides the native pane so the target render
takes the whole window — useful for a small mobile preset that would otherwise
sit in half a window, and for agent captures. The native pane stays loaded while
hidden, so the URL bar, back/forward and link clicks keep working exactly as
they do side by side.

### Tabs

The strip above the URL bar holds several independent sessions at once. A tab is
its own URL, its own screen preset and panel profile, its own view mode and pan,
and its own page state — so the same page on a 1366×768 laptop and on a budget
Android sit in two tabs and you flip between them without either one reloading.

`Cmd+T` opens a tab, `Cmd+W` closes one, `Cmd+1`–`Cmd+8` select by position and
`Cmd+9` selects the last. Closing the last tab leaves a fresh blank one rather
than closing the window. Tabs come back on relaunch — their URLs, their screens
and which one was in front.

Every tab is two Chromium renderers (a native pane and an offscreen 1x surface),
so the count is capped: 12 by default, settable from 2 to 32 in Settings. At the
cap the new-tab button dims and says why. Background tabs stay loaded and keep
their scroll position, but stop rasterising until you return to them — the cost
of a background tab is memory, not GPU.

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

# Tap targets and text measured in millimetres on the chosen screen — a 24 CSS px
# control is 6.6 mm on a 24" 1080p and 4.5 mm on a 6.5" phone, and only one of
# those is a thumb's worth. Findings under 7 mm / 2 mm (provisional, tunable):
npx -y getobsrv audit http://localhost:5173 --preset android-65

# The elements a 1x screen and a cheap panel break, named: edges under a device
# pixel, light text too small for its weight, contrast that fails as stated or
# only once the panel lifts the blacks, images upscaled or oversized. Each finding
# carries a page rect and one sentence with the figures (docs/lint.md).
npx -y getobsrv lint http://localhost:5173 --preset 1080p-24 --profile budget-tn

# All of the above on one self-contained HTML page — two laptops/desktops and two
# phones by default: each render, the audit in millimetres, the 1x-vs-2x diff.
# The thing to attach to a PR.
npx -y getobsrv report http://localhost:5173 --out obsrv-report.html

# The page as a user at 150% sees it: browser zoom as reflow, on any command.
# The PNG stays the screen's size; the page lays out in two thirds of it at
# 1.5x the density, and the audit's millimetres grow to match.
npx -y getobsrv snap http://localhost:5173 --preset laptop-768 --text-scale 1.5 --out zoomed.png

# How the page feels there: Chrome DevTools' network and CPU presets, and the time
# to paint-quiet in the JSON (settledMs). Compare against --throttle none.
npx -y getobsrv snap http://localhost:5173 --preset android-65 --throttle budget-phone --out slow.png

# One element, measured: font in millimetres on that screen, colours, and contrast
# as stated and on the panel, against the WCAG threshold for text that size.
npx -y getobsrv inspect http://localhost:5173 --preset android-65 --profile budget-tn --selector '#cta'
```

`npx -y getobsrv --help` (or `node bin/obsrv.js --help` in a checkout) lists every preset, profile and flag. Diff findings
are informational (exit 0); CI thresholds are the caller's job. A ready-made
Claude Code skill that wraps the loop (snap matrix → read the PNGs → diff →
fix → re-snap) lives at [skills/obsrv-screens/SKILL.md](skills/obsrv-screens/SKILL.md);
`obsrv install-skill` copies it into `~/.claude/skills/` so agents find it.

### MCP server

The same CLI is also wrapped as an MCP server (stdio, stateless) so MCP
clients get the tools natively: `obsrv_snap` (render a URL at a preset's true
raster density — the PNG comes back as an inline image up to 1.5 MiB),
`obsrv_diff` (the 1x-vs-2x metrics as structured output), `obsrv_audit` and
`obsrv_inspect` (millimetres and contrast on a chosen screen), `obsrv_lint`
(the elements a 1x screen and a cheap panel break, named), `obsrv_report`
(a whole matrix of screens as one HTML page) and `obsrv_presets` (every
preset and panel profile, no render).

If the desktop app is open with the toolbar's **Agent control** toggle on,
`obsrv_snap` drives the *visible* window instead: you watch the URL load and
the preset flip, and the agent gets back a capture of the app exactly as you
see it (plus `obsrv_drive` to flip URL/preset/profile/panes directly — `panes:
'target'` gives the target render the whole window, which is usually what you
want before a capture). Agents can
also scroll, click, pan and highlight while you watch — a drive session works
as a guided demo. A `scroll` reports the offset it actually reached
(`scrolled` / `scroller`), finds the inner scroll container on pages whose
root cannot scroll, and takes a `scrollSelector` when you need to name the
container yourself. `obsrv_inspect`, `obsrv_audit` and `obsrv_lint` follow the
app the same way: they measure the page in front, on the screen, text scale
and panel in force, after whatever the drive did to it; `obsrv_report` is the exception and stays
headless, being a batch over a matrix of screens. With no app running,
everything falls back to the headless render automatically.

To photograph a scrolled or panned state, pass `capture: 'window' | 'pane'` to
`obsrv_drive`: it captures after its commands run, and nothing in that tool
navigates unless you pass `url`, so the scroll survives the shutter. A live
`obsrv_snap` only navigates when the app is showing a *different* URL — its
`navigated` field says which happened — and navigating is a fresh load, which
starts at the top of the page.

**Tabs and the agent.** `obsrv_drive` and a live `obsrv_snap` act on the tab
that is in front, resolved per command rather than fixed when the drive starts —
a command that quietly succeeded on a tab you could not see would not surface
until the drive ended. Both report `tabId` and `tabIndex`, so an agent that
cares can compare them across calls and notice you switched tabs under it. While
Agent control is on, the driven tab carries a neutral rule on its leading edge
that brightens for ~3 s on each command, so it is visible which session is being
driven. An agent cannot open, close or switch tabs; that stays yours.

A headless `snap` returns `settled: true` when the page went paint-quiet and
every pixel painted. `settled: false` is still a usable capture, not a
failure — a page that kept animating, or one whose repaint never completed,
comes back as-is (exit code 0) with a warning saying what was missing and an
`unsettledReason`: `animating` (captured after ~2 s of steady painting;
waiting longer would not help), `timeout` (still painting at the budget) or
`uncovered` (part of the frame never painted). Only a render that painted
nothing at all is an error.

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

Obsrv checks GitHub for a newer release once a day and, when there is one, shows
it in the toolbar; clicking opens the release page. It is a single
unauthenticated request carrying no identifiers, and Settings → Updates turns it
off.

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
  limitation).
- Inner-scroller *reporting* is one-way. An agent `scroll` finds the page's real scroll
  host — the app-shell pattern (`html, body { overflow: hidden }` with an inner
  `overflow-y: auto` container) is handled, and the result reports the offset actually
  reached — but scrolling a nested container **by hand** in the native pane is not
  mirrored to the target: element scroll events don't bubble to `window`, so the report
  side never sees them. Dragging the page itself still syncs both ways.
- Scroll targeting stops at the light DOM of the top-level document. A scroller inside a
  shadow root or an iframe can't be found automatically *or* named with `scrollSelector`
  (`document.querySelector` doesn't cross either boundary), so a web-component app that
  hides its scroller in a shadow root has no escape hatch.
- Frame delivery has no renderer-side backpressure mailbox (see plan header); at 30 fps
  with dirty rects it has not been needed.
- Tabs are a first cut. They cannot be reordered, dragged out into another window, or
  reopened after closing (no `Cmd+Shift+T`), and there is no tab overflow menu — a strip
  longer than the window scrolls. An agent can only reach the tab in front: there is no
  way to name another tab in `obsrv_drive`, and no way for an agent to open, close or
  switch tabs at all. The URL bar's visited-URL suggestions are one window-wide list
  rather than one per tab (back/forward *are* per tab), and a restored tab comes back at
  the top of its page — the scroll position is not persisted.
