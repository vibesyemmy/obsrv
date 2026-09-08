# Live-first agent drive

*Design, 2026-09-07. Follows the tabs spec (2026-08-28) and the live-drive
section of the v1 design (§14).*

## The problem

Obsrv has two execution models and the agent picks per call. The headless
renderer is exact, parallel and the only way to take full-page bands or a
matrix report. The live app is the thing the user installed to *watch*. Today
`mode: "auto"` on `snap`, `audit`, `lint` and `inspect` drives the live app
only when it is already open with the Agent-control toggle on; otherwise it
falls back to headless with no visible sign. `report` and `diff` are headless
by design. An agent reviewing a page therefore tends to run headless captures
while the user's Obsrv window sits closed or idle — and even when live, it has
no way to open a tab per screen, and no vocabulary for "scroll one screenful."

Claude-in-Chrome has one model: there is a browser, the agent acts in it, the
user watches. Live is not a mode; it is the only thing that exists. That is the
experience this design gives Obsrv, without giving up what headless is for.

## Decisions already taken

- **Live is the default.** When the app is not running, the MCP server
  launches it. Installing the desktop app is the consent; nobody confirms
  before a Chrome tab opens either.
- **`report` is an artefact, not a show.** It stays headless. So does `diff`,
  and so does anything only headless can do.
- **Asking the user happens in the app, not in the tool.** An MCP tool cannot
  prompt; it returns to the agent, and under friction agents choose "proceed."
  The one state where a question is both possible and warranted — the app is
  open, the user is there, control is off — is asked by the app itself.

## Non-goals

- Windows launch paths. There is no Windows build.
- Driving a tab the user is not looking at. Every drive command activates its
  tab first; a background drive contradicts the purpose.
- Changing what `report` produces or how.
- MCP elicitation. Client support is uneven; nothing here depends on it.

## 1. The model

A tool call resolves to **live** unless one of four reasons says not to try,
and the result names which:

| reason | how it is known | result field |
|---|---|---|
| the caller asked | `mode: "headless"` | `mode: "headless"`, `why: "requested"` |
| headless-only operation | `fullPage`, custom `width`/`height`, `obsrv_report`, `obsrv_diff` | `why: "headless-only"` |
| no display | `OBSRV_HEADLESS=1`; `SSH_CONNECTION` set; Linux with no `DISPLAY`/`WAYLAND_DISPLAY`; `OBSRV_TEST=1` | `why: "no-display"` |
| the user declined | `control.json` says `enabled: false` (§2) | `why: "declined"` |

There is one more outcome, which is a failure rather than a reason: a launch
was tried and the app did not come up within the bound (§2a) —
`why: "launch-timeout"`, with a note saying how long it waited.

"The app happened not to be open" is no longer a reason. `mode: "live"` (the
explicit form) still errors when live is impossible, naming the reason.

`OBSRV_TEST=1` is in the no-display list on purpose: the e2e harness launches
its own app with `OBSRV_CONTROL_FILE` pointing at a throwaway profile, and a
launch from inside a test would spawn a second real Obsrv against the
developer's profile. Under the harness, the MCP never launches.

## 2. Launch and consent

Four states, one file. `control.json` in the app's userData dir is today
`{ port, token, pid, startedAt }` and exists only while the control server
listens. It becomes the single record of the app's stance — and it must
distinguish *why* control is off, because only one reason may ever stop the
MCP from trying again:

```
{ port, token, pid, startedAt, enabled: true }                // server listening
{ pid, startedAt, enabled: false }                            // running, control off, nobody has asked
{ pid, startedAt, enabled: false, declined: true }            // running, control off, the user said "Not now"
```

The file is written whenever the app runs, removed on quit. `enabled: false`
carries no port or token — there is nothing to call. A file whose `pid` is
dead, or whose `startedAt` predates the machine's last boot (the cheapest
sound proxy available for "this pid has since been recycled onto an
unrelated process" — see `discover()`'s doc comment in `src/mcp/control.ts`),
is treated as absent.

The plain `enabled: false` shape is what boot writes by default, and what the
chip's Stop and the settings toggle write when the user turns control off
without ever being asked a question — none of those routes may write
`declined`. Only an actual "Not now" answer to the consent bar does (§2c);
that is the sole state §2d's stand-down applies to. Getting this wrong is
exactly the bug the final whole-branch review found: if every "control is
off" write looked like a genuine decline, §2's own §2d would make §2c's
consent bar unreachable by construction, since `ensureLive` would never even
attempt the launch that raises it. See
`.superpowers/sdd/2026-09-07-live-first-agent-drive/progress.md` for the
ruling.

### 2a. Not running → launch

`discoverControl()` finds no file, or a dead pid. The MCP launches the app:

1. **Resolution order.** `/Applications/Obsrv.app` (then `~/Applications`);
   else the npm package's own Electron binary (`bin/electronPath.js`) with
   the GUI entry `out/main/index.js`. The DMG is preferred when present:
   Dock icon, update check, the user's own install.
2. **Environment.** `OBSRV_AGENT_CONTROL=1`, which already force-enables
   control for one session without touching the saved setting. For the DMG:
   `open -a Obsrv --env OBSRV_AGENT_CONTROL=1` if the platform's `open`
   supports `--env` (macOS 14 does); otherwise spawn the bundle's binary
   directly (`Obsrv.app/Contents/MacOS/Obsrv`) with the env set. **This is a
   risk to measure, not assume** (§8).
3. **Detached.** The child is unref'd; the MCP process outliving or dying
   before the app must not take it down, and vice versa.
4. **Wait.** Poll `control.json` until it exists with a live pid and
   `enabled: true`, then `status` answers. Bound: `LAUNCH_TIMEOUT_MS = 12_000`.
   On timeout, fall back to headless with `why: "launch-timeout"` and a
   `note`; never a hard error in `auto`.
5. **Tell the agent.** The first result after a launch carries
   `launched: true`, so the agent can say "I opened Obsrv" once.

The launched instance shows the existing AGENT chip lit. The chip gains a
**Stop** affordance (one click, no dialog): it persists `agentControl: false`
— the same write the Settings toggle makes, not a session-scoped one — and
stops the server, writing the plain `enabled: false` stance rather than
`declined` (§2), so a later launch attempt still knocks instead of being
silently refused. A user clicking a button labelled Stop is making a durable
choice, unlike *Allow for this session* below, which is deliberately
scoped to the session; that is the user's off switch, always visible while an
agent is driving.

### 2b. Running, control on → drive

As today. Nothing changes.

### 2c. Running, control off → the app asks

The MCP launches as in 2a. The launch hits the single-instance lock and exits
at once; the running app receives `second-instance`. Today that handler counts
and focuses. It now also, when control is off and no prompt is already
showing, shows a **consent bar** under the toolbar:

> An agent wants to drive Obsrv. **Allow for this session** · **Not now**

- *Allow* → control on for the session (same path as `OBSRV_AGENT_CONTROL=1`,
  saved setting untouched), file rewritten `enabled: true` with port and
  token. The waiting MCP sees it and proceeds.
- *Not now* → file rewritten `enabled: false, declined: true`; the bar
  dismisses. The MCP sees the `declined` marker and goes headless with
  `why: "declined"`.
- *No answer* within `LAUNCH_TIMEOUT_MS` → the MCP goes headless with
  `why: "launch-timeout"` and a note that Obsrv asked and has not heard back
  yet; the bar stays, so a later answer still takes effect for the next call.

The consent bar is the only new UI. It is non-modal, it does not steal focus
from the page, and its copy names that an *agent* is asking — not Obsrv.

### 2d. Declined → stay declined

Only once the file says `enabled: false, declined: true` for a live pid does
the MCP stop trying: it does not launch, does not re-trigger `second-instance`,
and does not re-ask. Every `auto` call goes headless with `why: "declined"`
and a note: *the user turned agent control off in Obsrv; ask them to enable it
if you need the live app.*

A plain `enabled: false` with no `declined` marker — the state boot writes by
default, and that Stop and the settings toggle write (§2a) — is not this
state. The MCP treats it exactly like "not running" (§2a): it launches, which
is what lets §2c's knock happen at all. Conflating the two was the bug: it
made every "control is off" write look declined, so the consent bar could
never be reached except by a human double-launching Obsrv by hand. The
declined state itself ends when the user enables control (chip or settings)
or quits the app.

## 3. Tabs as an agent surface

`TabManager` already has `add`, `activate`, `close`, `active`, `snapshot` and
a `maxTabs` setting (default 12, bounds 2–32). The control protocol exposes
them; nothing new is built in the manager.

New control commands, all validated in `shared/control.ts` like the rest:

| command | payload | reply |
|---|---|---|
| `tabs` | — | `{ tabs: [{ id, url, title, presetId, active }], maxTabs }` |
| `openTab` | `{ url?, preset? }` | `{ id }`; error when at `maxTabs` |
| `activateTab` | `{ id }` | `{ id }`; error when unknown |
| `closeTab` | `{ id }` | `{ closed: id, active: id }`; error when unknown or it is the last tab |

`status` gains `tabs` (the same list) so one call answers "what is open."

`obsrv_drive` gains two inputs and one output:

- `tab: string` — a tab id from `status`/`tabs`, or `"new"`. Runs **first**,
  before `focus`: `"new"` opens a tab (with `url` and `preset` if given, so
  they are not applied twice); an id activates that tab. Either way the tab
  is in front before anything else runs, so the user sees it.
- `closeTab: string` — a tab id, or `"current"`. Runs **last**, after
  `capture`, so an agent can photograph a tab and close it in one call.
- `tabs` in the result, as in `status`.

Commands still act on the active tab, as today. The order of operations in the
tool description is updated: `tab → focus → url → … → capture → closeTab`.

## 4. The review loop

Two changes make "review like Chrome" the path of least resistance.

**`scroll` gains a page form.** `scroll: { page: "next" | "prev" | "top" | "bottom" }`
scrolls by one screenful of the tab's viewport (or to an end), using the same
scroll-host detection as the offset form. The reply carries `scrolled` as now
plus `atEnd: boolean`, so an agent's loop is `scroll next → capture pane →
look → repeat until atEnd`, with no arithmetic and no knowledge of the page
height.

**The skill teaches the live loop.** `skills/obsrv-screens/SKILL.md` is
restructured around two paths, named for what they produce:

- *Review* (live): one tab per screen; `drive { tab: "new", url, preset,
  capture: "pane" }`, then `scroll { page: "next" }` + `capture: "pane"` until
  `atEnd`; `highlight` with `space: "page"` for each finding as it is
  discussed; leave the tabs open for the user. `audit`/`lint`/`inspect` in
  `auto` measure the tab in front.
- *Deliver* (headless): `report` for the artefact; `fullPage` snaps for a
  whole-page raster; `diff`.

The skill states the four headless reasons and what `launched`, `why` and
`enabled` mean, so an agent can explain what the user is seeing.

## 5. Tool descriptions

- `snap`, `audit`, `lint`, `inspect`: `mode` docs rewritten — *auto (default):
  drive the visible app, launching it if it is not running; headless only when
  asked, when the operation needs it, when there is no display, or when the
  user has turned agent control off (the result says which).*
- `drive`: `tab`, `closeTab`, `scroll.page`, `tabs` documented; the "the app
  must be open" sentence becomes "the app is launched if it is not running,
  unless the user has turned agent control off."
- `report`, `diff`: unchanged, plus one sentence: *always headless; this is an
  artefact, not a live review.*

Result shapes gain `why` (when headless) and `launched` (when a launch
happened) on every tool that has `mode`; `drive`'s status gains `tabs`.

## 6. Where the code goes

| concern | where |
|---|---|
| discovery-file shape (`enabled`), parse/validate | `src/shared/control.ts` |
| write the file always, flip `enabled`, Stop | `src/main/controlServer.ts`, `src/main/index.ts` |
| consent bar, Stop on the chip | `src/renderer/src/components/` (new `ConsentBar.tsx`; `Toolbar.tsx`) |
| `second-instance` → consent request | `src/main/index.ts` |
| tab commands | `src/main/controlServer.ts` over `src/main/tabs.ts`; payload tables in `src/shared/control.ts` |
| `scroll.page` | `src/main/controlServer.ts` (host detection is shared already) |
| launch: resolution, spawn, wait | new `src/mcp/launch.ts`; `discoverControl` in `src/mcp/control.ts` calls it |
| headless reasons, `why`, `launched` | `src/mcp/server.ts`, pure decision in `src/mcp/lib.ts` |
| skill | `skills/obsrv-screens/SKILL.md` |

The launch decision (`why`) is a pure function of `(mode, inputs, env,
discovery result)` in `lib.ts`, unit-tested exhaustively. The spawn itself is
the only impure part and is small.

## 7. Testing

- **Unit** (`tests/unit/`): `control.test.ts` for the new file shape and tab
  payloads; `mcpLib.test.ts` for the headless-reason table — every row of §1
  and every env combination; `launch.test.ts` for resolution order with a
  fake filesystem.
- **E2E** (`tests/e2e/`), all under `OBSRV_TEST=1` so nothing launches:
  - `live-drive.spec.ts`: `tab: "new"` opens and fronts; `tab: <id>`
    activates; `closeTab` refuses the last tab; `scroll.page` walks to
    `atEnd`; `status.tabs` agrees with the tab bar.
  - `consent.spec.ts` (new): with control off, a synthetic `second-instance`
    shows the bar; Allow starts the server and rewrites the file; Not now
    writes `enabled: false`; Stop on the chip does the same; a second
    `second-instance` while the bar shows does not stack a second bar.
  - `mcp.spec.ts`: with a file saying `enabled: false` for a live pid, `auto`
    is headless with `why: "declined"` and no launch is attempted (the launch
    module is stubbed to throw if called).
- **Launch itself** is covered by one *manual* checklist in the plan, run
  once per platform path (DMG, npm Electron): cold start time, the env var
  reaching the app, detachment surviving MCP exit. Not automated: it spawns a
  real GUI.

## 8. Risks — measured 2026-09-08

All five were measured on the author's Mac against the installed
`/Applications/Obsrv.app` (0.40.1) with the merged MCP server. Numbers, not
estimates; the method is Task 13 of the plan.

1. **Cold start: 1,281 ms**, against a `LAUNCH_TIMEOUT_MS` of 12,000 — a 9×
   margin on an idle machine. The bound stays as it is: it exists for a loaded
   machine, and the measurement says nothing about that case.
2. **The environment reaches the app.** `OBSRV_AGENT_CONTROL=1` was read back
   out of the launched process's own environment (`ps eww`), so spawning the
   bundle's executable directly does forward it. `open -a` was never needed.
   The discovery file came back `{port, token, pid, startedAt}` at mode 0600.
3. **Detachment holds.** The launching node process exited; the app stayed up
   and was reparented to launchd (ppid 1).
4. **A released app with control off no longer stalls.** This is the version-skew
   case: 0.40.1 writes no discovery file, so the server launches, the child loses
   the single-instance lock and exits at once. Before the child-exit guard that
   burned the full 12 s and stole window focus on *every* call. Measured after:
   **261 ms** to `why: "launch-timeout"`, with a note naming the real cause. No
   stray second instance survived.
5. **Version skew works in the direction that matters.** The merged server drove
   the released 0.40.1 app throughout: `discover()` returned `live`, `status`
   parsed, and `tabs` defaulted to `[]` for an app that predates the field.

Not measured, because the installed bundle predates them: the consent bar, the
Stop chip and the declined marker are not in 0.40.1. They are covered by
`tests/e2e/consent.spec.ts` and `tests/e2e/live-drive.spec.ts` against a real
Electron instance, and will first meet a real bundle after the next release.

## 8b. Original risk list (superseded by the measurements above)

1. **Cold start vs the bound.** Electron on a loaded machine may exceed 12 s.
   Measure on this Mac with the DMG and the npm path; set the bound from the
   number, and make the fallback note say how long it waited.
2. **`open -a` and the environment.** macOS `open` may not pass env to the
   launched app even with `--env`. If not, spawn the bundle binary directly;
   verify `OBSRV_AGENT_CONTROL` is seen by checking the chip after launch.
3. **Harness hermeticity.** Any launch under the e2e harness is a bug. The
   `OBSRV_TEST=1` guard is in the pure decision table, so the unit test that
   covers it is the fence.
4. **Two apps, one profile.** A DMG Obsrv and an npm Electron Obsrv share the
   userData path, so the single-instance lock arbitrates; the second exits.
   Verify the *running* one gets `second-instance` regardless of which binary
   the MCP chose.
5. **`enabled: false` while the server is mid-command.** Stop during a drive:
   the in-flight command completes or fails; the *next* one sees the file.
   Test that Stop does not leave a listening port behind.

## 9. Rollout

One release, minor bump. The change is additive for agents that never call
`drive`: their `auto` calls start launching the app, which is the point. The
release notes lead with that sentence and with the Stop control, so nobody is
surprised by a window and nobody wonders how to close the door.
