# A separate, honestly-scoped WebKit headless capture

*Design, 2026-11-06.*

## The problem

Every capture Obsrv takes today — live or headless — runs through Electron,
which only embeds Chromium (`app.whenReady()` in `src/cli/main.ts:1688`
drives the headless CLI path the same as the live app; there is no WebKit
variant of Electron to swap to). A user asking "does my site look different
in Safari" has no way to find out from Obsrv; the whole tool answers only for
Chromium's rendering, Chromium's font hinting, Chromium's layout engine.

Three of Obsrv's signature capture features are Chromium-specific at the
protocol level, not by omission:

- **`settledMs`** (`captureQuiescent`, `src/main/targetSource.ts`) is built on
  Electron's native `'paint'` event (`wc.on('paint', ...)`,
  `targetSource.ts:493`), which streams every raster Chromium produces.
  Playwright's WebKit automation exposes no equivalent event.
- **`--throttle`** (network and CPU) is literal Chrome DevTools Protocol:
  `dbg.sendCommand('Network.emulateNetworkConditions', ...)` and
  `dbg.sendCommand('Emulation.setCPUThrottlingRate', ...)`
  (`targetSource.ts:1039`, `:1044`). WebKit does not speak CDP; there is no
  equivalent, degraded or otherwise, for CPU throttling specifically.
- Precise density emulation uses raw CDP
  `Emulation.setDeviceMetricsOverride`, called out in the code as
  specifically measured against real behaviour (`targetSource.ts:185`).

So a WebKit capture path is not "the same thing on a different engine" — it
is a second, thinner tool that cannot promise what the Chromium path
promises. The risk this design is written to avoid is shipping it as if it
could.

## Decision

Add `obsrv snap --engine webkit` as a second, explicitly separate capture
path — headless only, built on Playwright's own `webkit` browser, never
touching `TargetSource` (Electron-specific) at all. It ships labelled as
what it is: a basic screenshot engine, not a second Obsrv.

## Non-goals (this phase, and some permanently)

- **Live mode in WebKit.** Electron only embeds Chromium. Not "hard" —
  impossible without replacing the application shell. Permanently out of
  scope for this project.
- **`--throttle` with `--engine webkit`.** No CDP, no equivalent. The
  combination is refused with a clear error, not silently ignored — a
  throttle flag that does nothing is exactly the "wrong answer the caller
  cannot detect" class `docs/release-gate.md` exists to catch.
- **`settledMs` parity.** A webkit capture reports `settledMs: null` (the
  field is already nullable in the existing contract — see `runSnap`'s own
  `r.settledMs === null ? 'not settled' : ...` handling in
  `src/cli/main.ts`) with a warning naming why: no paint-event stream to
  measure against, captured after a fixed wait instead.
- **Onion skin, vision-deficiency shaders.** Live-app-only WebGL features.
  Out of scope for any headless engine, Chromium included — not specific to
  this change.
- **`obsrv_snap` (MCP).** CLI only, this phase. MCP exposure is a later,
  separate phase once the capture path has seen real use (Opeyemi's call,
  2026-11-06 — smaller first slice over both-at-once).
- **`obsrv audit` / `obsrv lint` / `obsrv report` with webkit.** Phase 2+,
  gated on verifying `shared/audit.ts` and `shared/lint.ts`'s DOM-walking
  scripts don't call anything Chromium-only (unverified; they read as plain
  DOM/CSSOM today, which is not the same as confirmed).
- **Mobile and tablet presets.** Every phone/tablet preset
  (`src/shared/presets.ts:86-100`) drives a dedicated mobile UA and CDP
  mobile-viewport emulation on the Chromium path
  (`targetSource.ts:491,758-770`) that §2's `browser.newContext` does not
  reproduce — Playwright has its own device-descriptor mechanism
  (`playwright.devices['iPhone 14']`), but mapping Obsrv's preset table onto
  it is its own fidelity question, not a given. `--engine webkit` with a
  mobile or tablet preset is refused in phase 1, same pattern as
  `--throttle`, rather than silently rendering desktop Safari at a narrow
  width.
- **`--full-page` / `--tiled`.** A substantial scrolling, banding and
  stuck-chrome-detection feature (`src/cli/main.ts:397-701`), not a single
  `page.screenshot()`. Phase 1 is one viewport, full stop; `--engine webkit
  --full-page` is refused, not silently given a single, un-stitched surface.

## 1. Where it lives

A new module, `src/cli/renderWebkit.ts`, parallel to `render()` in
`src/cli/main.ts` — not a branch inside it. `runSnap` picks one or the
other by `cmd.engine` before anything engine-specific runs. `TargetSource`
is untouched; nothing about the Chromium path's code path changes.

## 2. The capture

```
browser = playwright.webkit.launch({ headless: true })
context = browser.newContext({ viewport: { width, height }, deviceScaleFactor })
page = context.newPage()
await page.goto(url, { waitUntil: 'load', timeout: options.timeoutMs })
await page.waitForTimeout(WEBKIT_SETTLE_MS)   // see Risks — value not yet measured
png = await page.screenshot()                 // Playwright returns an already-encoded PNG buffer
rgba = decodePng(png)                         // tests/e2e/helpers/decodePng.ts does this today; reuse, don't rewrite
img = applyPanelProfile(rgba, profile)         // same function the Chromium path already calls — pure pixel bytes in, engine-agnostic
```

`applyPanelProfile` is reused as-is: it operates on decoded RGBA bytes after
capture, with no dependency on how they were produced. `decodePng` already
exists as an e2e test helper (used to verify captured output elsewhere) and
needs only to move somewhere both production code and tests can import it
from, or be duplicated as a small, separately-tested utility if moving it
changes its guarantees — a call the implementer makes once they're looking at
both call sites.

## 3. The flag

`--engine chromium|webkit`, default `chromium`. `--engine webkit --throttle
<anything>` is a parse-time refusal (`ArgError`, same class as any other
invalid flag combination today), not a warning.

## 4. What the result says

The JSON output gains `engine: "webkit"` — present only when non-default,
matching how `textScale` is only present when it's not `1` elsewhere in this
same object. On a webkit capture: `settledMs: null`, and `warnings` gains a
line naming why (no paint-event stream; captured after a fixed wait).
`throttle` is simply absent, as it already is for any capture that didn't
ask for one.

## 5. Getting `playwright` to a real install at all

**Settled here, as the builder's call, because it's a mechanism decision
that doesn't change what phase 1 delivers.** `playwright` is currently
`devDependencies`-only (`package.json:58`); a real `npm install -g getobsrv`
or `npx getobsrv` never installs it, and `bin/obsrv.js` always spawns the
real Electron binary and runs `out/main/cli.js` inside it regardless of
`--engine` (`bin/obsrv.js:83-108`) — so `renderWebkit.ts` requiring
`playwright` would resolve against nothing outside a repo checkout. This
passes every test and CI run (`devDependencies` are installed there) and
only breaks for a real published install — exactly the shape of gap this
project has been burned by before (the `prepack`/electron-dep.js swap
exists for the identical reason, one dependency over).

- **`playwright-core`, not `playwright`, moves to `dependencies`.**
  `playwright-core` is the automation API without the `playwright` package's
  own browser-management CLI sugar — we're already building our own
  download/lock/sentinel mechanism (§6), so we don't want a second one
  fighting it.
- **`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` at `npm install` time** (a real,
  documented Playwright env var, set in `.npmrc` or the postinstall
  environment), so installing the package never eagerly fetches any browser
  binary — only an explicit `--engine webkit` call triggers §6's download.
  This is the detail that keeps "lazy, first-use download" actually lazy
  once `playwright-core` is a real dependency instead of a dev-only one.
- **Exactly how `playwright-core` exposes its own browser-fetcher
  internals** (the piece §6's download mechanism calls into) is not nailed
  down here — read `playwright-core`'s own registry/install code when
  building this, rather than guessing its shape now.

## 6. The binary: download on first use

Modelled directly on `bin/electronPath.js`'s existing pattern for Electron
itself, because the shape of the problem is identical: a large binary
(Playwright's WebKit build; Electron's own download is ~120 MB and WebKit is
comparable) that most installs will never touch, fetched lazily rather than
bundled.

Three lessons from that file apply unchanged, and are worth repeating here
so the implementer doesn't rediscover them the hard way:

1. **The installer's own progress output pollutes stdout.** Obsrv's CLI
   promises stdout carries nothing but machine JSON; Electron's installer
   printing `Downloading Electron binary...` to stdout broke exactly that
   promise and failed a CI JSON parse. Playwright's own browser installer
   (`playwright install webkit`) has the same shape of risk (progress
   output) and needs the same treatment: resolve the binary path ourselves,
   and when it's missing, run the installer as a detached child whose
   output goes to its own log file, never to our stdout — behind one
   human-readable line saying a download is happening.
2. **Concurrent sessions race the same download.** Every MCP server
   resolving the same install location can start a download at once (measured:
   several Claude sessions starting together after a plugin update). The
   existing fix is an atomic `mkdir` lock holding the owner's pid, with a
   stale-lock takeover when the holder is dead. The same lock shape applies
   here.
3. **An orphaned download must survive the process that started it.** A
   server killed mid-download previously left a dead installer that never
   extracted, so every later call started over. The fix was a detached
   installer and a sentinel file (`path.txt`) the caller polls for, rather
   than tracking the child's lifetime directly. Same shape here, watching
   for whatever Playwright's own installer writes to mark completion (or an
   explicit sentinel this code writes itself after a successful run, if
   Playwright's installer doesn't already provide one — to be confirmed
   when building this).

The binary goes to Playwright's own default browser cache location
(`PLAYWRIGHT_BROWSERS_PATH`, or its platform default) — not a new,
Obsrv-specific directory.

## 7. Version and platform skew

- **First `--engine webkit` call, binary absent:** triggers the download
  (§6), prints the one progress line, then proceeds.
- **Download fails** (no network, disk full): a clear error and non-zero
  exit, with nothing left behind that a later call would mistake for a
  completed install.
- **Platform support:** Playwright publishes WebKit builds for macOS
  (x64/arm64), which is everything Obsrv's own install matrix covers today —
  stated here as the assumption it is, not verified yet. Confirm against
  Playwright's own supported-platforms list before building, since a
  mismatch here is a "ships broken on half the install base" class of
  mistake, not a nitpick.

## 8. Risks, to be measured (named now so nobody mistakes a guess for a measurement later)

1. **The settle wait.** `WEBKIT_SETTLE_MS` is a placeholder, not a measured
   constant. It needs the same treatment `WALK_DWELL_MS` got in
   `2026-09-08-walk-before-measuring-design.md` — a real number from a real
   page, not a guess carried into the default.
2. **Density fidelity.** Electron's `Emulation.setDeviceMetricsOverride` was
   specifically measured before being trusted (`targetSource.ts:185`).
   Playwright WebKit's `deviceScaleFactor` context option has had no such
   check here. Needs a comparable measurement before the webkit path's pixel
   dimensions are trusted the way the Chromium path's are.
3. **`applyPanelProfile` on WebKit output.** That function was built and
   tuned against Chromium's raw raster. Whether its output still reads
   sensibly on WebKit's (already anti-aliased, already PNG-encoded-and-
   decoded) pixels is untested, not merely unverified — the first thing to
   look at once a real capture exists, before trusting the profile
   simulation on this path at all.
4. **Is Playwright's bundled WebKit representative of real Safari?** Before
   any claim like "see how your site looks in Safari" reaches a README or a
   tool description, confirm Playwright's macOS WebKit build renders the
   same way the real browser does — not a stripped testing variant. One
   spot-check against real Safari on a page with a known rendering quirk
   (font hinting is the obvious candidate) answers this cheaply.

## 9. Testing

- **Unit:** flag parsing and the `--engine webkit` + `--throttle` refusal —
  no real browser needed for this half.
- **e2e, new file** (`tests/e2e/webkit-snap.spec.ts`): launches real
  `playwright.webkit` (not Electron's `_electron`), captures a fixture,
  decodes the PNG, and asserts non-trivial, non-identical pixel content —
  proving the path produces a genuinely different raster, not a renamed copy
  of the Chromium path's output. Same shape of check `rendering.spec.ts`
  already uses (`inkRows`-style distinct-pixel counting) for the equivalent
  Chromium guarantee.
- **CI:** add `npx playwright install webkit` beside the existing `npx
  playwright install chromium` step (`.github/workflows/ci.yml:257`).
- **Manual, before calling phase 1 done:** a real side-by-side on a handful
  of real sites, eyeballed. The whole point of this feature is "does this
  look different" — a test suite that only proves "doesn't crash" hasn't
  proven the feature delivers anything.

## 10. Phases

- **Phase 1 (this plan):** `obsrv snap --engine webkit`. No throttle, no
  `settledMs`, no MCP exposure, no audit/lint/report.
- **Phase 2 (separate plan, not written yet):** `obsrv audit` / `obsrv lint`
  with `--engine webkit`, gated on confirming the DOM-walking scripts port
  cleanly.
- **Phase 3 (separate plan, not written yet):** `obsrv_snap` (MCP) gains
  `engine`, once phase 1 has seen real use.
