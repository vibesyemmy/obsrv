# Obsrv — Update check

**Date:** 2026-08-26
**Status:** Approved (brainstorm complete)
**Affects:** `src/shared`, `src/main`, `src/renderer`, `.github/workflows/ci.yml`, README

## 1. Problem

Obsrv ships as an unsigned macOS DMG. A user who installed 0.4.0 has no way to
learn that 0.6.0 exists: the app never mentions its own version outside the
control server's `status`, and nothing tells them to look.

Two facts constrain the answer.

**The app is unsigned.** `electron-builder.yml` sets `notarize: false` and CI
builds with `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`; users clear the quarantine
flag by hand. Squirrel.Mac refuses to apply an update to an unsigned bundle, so
`electron-updater`'s download-and-install path cannot work today. It would fail
at install rather than at download — late, and confusingly.

**There is nothing to link to.** The CI `dmg` job uploads 30-day
`actions/upload-artifact` artefacts, which only signed-in users can fetch from
the Actions run page. README tells people to "Grab the DMG from Releases". That
link is already pointing at nothing.

## 2. Goal

The app notices a newer release and offers one click to the page that has it.
The user installs the DMG themselves, as they do today.

Success:

- A 0.6.0 app with 0.7.0 released shows `v0.7.0 ↓` in the toolbar within a
  second or two of launch, and clicking it opens the release page.
- An app on the newest version shows nothing in the toolbar.
- No network failure ever produces a dialog, a delay at launch, or a toolbar
  state.
- `obsrv` and `obsrv-mcp` make no network call of any kind.

## 3. Scope

### In

- A once-daily check on launch against the GitHub Releases API.
- A toolbar affordance shown only when an update exists.
- A Settings block: automatic-check toggle (default on), current version,
  last-checked time, and a manual "Check now".
- CI publishing real GitHub Releases with the DMGs attached on `v*` tags.

### Out

- Downloading or installing anything. That is auto-update, and it is gated on
  code signing (§10).
- The `getobsrv` npm channel. `npx` always resolves the latest, and the MCP
  server speaks a stdio protocol where a stray byte on stdout is a bug.
- In-app release notes or a changelog viewer.
- Update checks anywhere except the desktop GUI.

## 4. Architecture

Pure logic in `src/shared/update.ts`, node-testable without Electron. Only the
HTTP call and the scheduling live in main — the same split `control.ts` and
`controlServer.ts` already use.

| Unit | Does | Interface | Depends on |
|---|---|---|---|
| `shared/update.ts` | Version compare, response parsing, URL allowlist, constants | `isNewer()`, `readRelease()`, `isReleaseUrl()` | pure TS |
| `main/updateCheck.ts` | One HTTP GET, bounded | `checkForUpdate(current, now)` | Electron `net`, `shared/update` |
| `main/ipc.ts` | Runs the check at boot, pushes the result, owns the URL | `IPC.updateStatus`, `IPC.checkUpdate`, `IPC.openRelease` | above |
| `renderer/state/store.ts` | Holds `update` | `setUpdate()` | — |
| `components/Toolbar.tsx` | The affordance, when there is one | — | store |
| `components/SettingsPanel.tsx` | Toggle, version, last checked, manual check | — | store |

### 4.1 Types

Added to `src/shared/types.ts`:

```ts
export type UpdateStatus = 'current' | 'available' | 'error'

export interface UpdateState {
  status: UpdateStatus
  /** Release version without a leading `v`. Present only when available. */
  latest?: string
  /** Epoch ms of the last completed attempt, success or failure. */
  checkedAt: number
}
```

The release **URL is deliberately absent** from this type. See §9.

### 4.2 `shared/update.ts`

```ts
export const RELEASES_API = 'https://api.github.com/repos/vibesyemmy/obsrv/releases/latest'
export const RELEASE_URL_PREFIX = 'https://github.com/vibesyemmy/obsrv/releases/'
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
export const CHECK_TIMEOUT_MS = 5_000

/** Is `latest` a higher version than `current`? Tolerates a leading `v`. */
export function isNewer(latest: string, current: string): boolean

/** The API body → an UpdateState plus the URL to open. Null when unusable. */
export function readRelease(
  body: string,
  current: string,
  now: number,
): { state: UpdateState; url: string } | null

/** Is this a URL we are willing to hand to the OS? */
export function isReleaseUrl(url: string): boolean

/** Has enough time passed since the last attempt? */
export function isCheckDue(lastUpdateCheck: number, now: number): boolean

/** `checkedAt` as "2 hours ago" / "just now" / "never". */
export function formatAge(checkedAt: number, now: number): string
```

`isCheckDue` and `formatAge` are pure and live here rather than in main so both
are unit-tested without Electron; `formatAge` is the only place the Settings
block's wording is decided.

Version comparison is numeric segment by segment after stripping a leading `v`.
A version carrying a prerelease suffix (`1.0.0-rc.1`) sorts *below* the same
version without one, so a prerelease never presents itself as an upgrade over a
stable release of the same number. `/releases/latest` already excludes
prereleases; this is belt-and-braces for a tag pushed by hand.

## 5. Data flow

```
app ready
  └─ settings.updateCheck && isCheckDue(settings.lastUpdateCheck, now)
       └─ checkForUpdate(app version, now)          [main, 5s bound]
            ├─ ok    → readRelease(body)  → { state, url }
            └─ fail  → { status: 'error', checkedAt: now }
       └─ persist settings.lastUpdateCheck = now
       └─ remember `url` in main-process memory only
       └─ win.webContents.send(IPC.updateStatus, state)
            └─ store.setUpdate(state)
                 ├─ Toolbar: renders when status === 'available'
                 └─ SettingsPanel: renders every status
```

The check is fired **after** the window is created and never awaited by boot, so
a slow or hung network cannot delay the first paint.

`IPC.checkUpdate` runs the same path ignoring `isCheckDue`, for the Settings
button. `IPC.openRelease` takes no argument and opens the URL main remembered.

## 6. Settings

`Settings` gains two fields:

```ts
updateCheck: boolean      // default true
lastUpdateCheck: number   // epoch ms, default 0
```

`loadSettings` must treat a file written by an older build — one with neither
field — as valid and fill both from `DEFAULT_SETTINGS`. Missing keys are
defaulted, never a reason to discard the file. Existing validation (a positive
diagonal and nits) is unchanged.

`lastUpdateCheck` is written on every completed attempt including failures, so
an offline machine retries once a day rather than on every launch.

## 7. UI

Governed by `2026-08-23-obsrv-ui-style.md`. An update is neither a warning nor
an error, so it uses **no colour**: `--text-0` on `--chrome-2`, the version in
the mono face with tabular figures, the same 1px border every other toolbar
control wears.

**Toolbar** — rendered only when `status === 'available'`, immediately left of
the surround control:

```
v0.7.0 ↓
```

`title` gives the full sentence ("Obsrv 0.7.0 is available — opens the download
page"). Zero footprint in every other state, which keeps an already-crowded
toolbar honest.

**Settings drawer** — a "Version" block, always present:

```
Version            0.6.0
Latest             0.7.0 · Download
Last checked       2 hours ago
[x] Check for updates automatically
                   [ Check now ]
```

`status: 'current'` shows "Up to date". `status: 'error'` shows "Couldn't
check", with the last-checked time still visible. Nothing about a failed check
reaches the toolbar.

## 8. Error handling

| Condition | Behaviour |
|---|---|
| Offline, DNS failure, connection refused | `status: 'error'`; Settings says "Couldn't check"; toolbar unchanged |
| Timeout past 5 s | Request aborted, same as above |
| HTTP 403 (rate limited) or any non-200 | Same as above |
| Body is not JSON, or has no usable `tag_name` | Same as above |
| `tag_name` present but not newer | `status: 'current'` |
| `html_url` fails `isReleaseUrl` | Treated as unusable → `status: 'error'` |
| Check disabled in Settings | No request; toolbar and Settings show the last known state |

No case retries within a session, shows a dialog, or blocks anything.

## 9. Security

The API response is data from outside the app, and one field of it would
otherwise reach `shell.openExternal` — which hands a string to the OS to open
with whatever handler matches.

Two guards:

1. **`isReleaseUrl`** requires the URL to start with
   `https://github.com/vibesyemmy/obsrv/releases/`, checked on the parsed URL's
   `protocol`, `host` and `pathname` rather than by string prefix, so a
   lookalike host cannot pass.
2. **The URL never crosses IPC.** The renderer's `openRelease` call carries no
   argument; main opens the string it validated and stored. The renderer
   therefore cannot ask the OS to open anything, whatever a compromised page or
   a bug in the store might contain.

The request sends no identifiers: no telemetry, no machine id, no query
parameters. It is a plain unauthenticated GET.

## 10. Relationship to auto-update

Everything here is the front half of auto-update. When signing lands — a
Developer ID certificate, `notarize: true`, and `latest-mac.yml` published
beside the DMGs — `electron-updater` replaces `checkForUpdate` and the toolbar
button changes from "opens a page" to "downloads and installs". The Settings
block, the toggle, the throttle and the store shape all survive unchanged.

Notarisation would also remove the `xattr -cr` step, which is the other half of
why updating is currently painful.

## 11. Release pipeline

The `dmg` job in `.github/workflows/ci.yml` changes from uploading artefacts to
publishing a release:

- Trigger stays `startsWith(github.ref, 'refs/tags/v')`.
- Add `permissions: contents: write`.
- Replace `actions/upload-artifact` with `softprops/action-gh-release@v2`,
  attaching `dist/*.dmg` and `dist/*.blockmap`. Blockmaps are useless to a
  check-only client and are attached anyway, because `electron-updater` wants
  them later and adding them now costs nothing.
- The release is created from the tag, so the tag name is the version the API
  reports.

README's install section stops being a broken promise, and gains a line saying
the app checks for updates once a day and how to turn that off.

## 12. Testing

**Unit (`tests/unit/update.test.ts`, node):**

- `isNewer`: patch, minor and major bumps; equal versions; `v` prefixes on
  either side; `1.0.0-rc.1` losing to `1.0.0`; ragged segment counts (`1.2` vs
  `1.2.0`); garbage input returning false rather than throwing.
- `readRelease`: a real-shaped GitHub payload; a payload whose `tag_name` is
  older; malformed JSON; missing `tag_name`; an `html_url` on another host.
- `isReleaseUrl`: the real prefix passes; `http://`, a lookalike host
  (`github.com.evil.test`), a path outside `/releases/`, and a `file://` URL all
  fail.
- `isCheckDue`: never checked (`0`); checked a minute ago; checked 25 hours ago;
  a `lastUpdateCheck` in the future (a clock moved backwards) treated as due
  rather than locking the check out forever.
- `formatAge`: "never" at `0`, "just now" under a minute, then minutes, hours
  and days, singular and plural.

**Unit (`tests/unit/settings.test.ts`, extended):** a settings file written
before this feature loads with `updateCheck: true` and `lastUpdateCheck: 0`
rather than being discarded.

**E2E (`tests/e2e/update.spec.ts`):** no test touches the network. The spec
pushes a state straight down the real channel from the existing test hook —
`__obsrv.win.webContents.send(IPC.updateStatus, state)` — so the renderer path
under test is the production one and only the HTTP call is skipped. It asserts:
the toolbar button appears for `available` and is absent for `current` and
`error`; the Settings block renders all three; the toggle round-trips through
main and survives a renderer reload; and `openRelease` is refused when main has
no stored URL, so a click can never open something unvalidated.

**Build guard (`tests/unit/cliBundle.test.ts`):** the built CLI and MCP bundles
contain neither `RELEASES_API` nor `api.github.com`. A structural assertion that
the headless paths cannot check for updates, which no runtime test would catch
as reliably.

## 13. Risks

- **GitHub rate limiting** is 60/hr per IP unauthenticated. At once daily this
  is unreachable for an individual, but an office behind one NAT could in
  principle share the budget. The failure mode is a silent `error` state, which
  is acceptable — and the daily throttle means a user sees it at most once a day.
- **Distribution is pinned to GitHub.** Moving off it means changing
  `RELEASES_API` and `RELEASE_URL_PREFIX` together; they are constants in one
  file for that reason.
- **A tag without a release** (pushed before CI finishes, or a failed job)
  leaves `/releases/latest` on the previous version. The app reports what the
  API says; it does not read tags.
