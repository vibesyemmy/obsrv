# A4: install, use, uninstall — what remains

Run 2026-09-14 by Rook. All three surfaces: the npm CLI, the MCP server, and
the desktop app.

**The headline, and it is the app half: deleting Obsrv.app removes nothing.**
The whole profile survives — including `history.json`, the list of addresses
visited in the app. See *The desktop app* below.

Nothing under Opeyemi's own HOME was installed to, written to, or removed. The
cycle ran in a disposable home, and the real profile was counted before and
after as evidence rather than as an assurance:

| Path | Before | After |
| --- | --- | --- |
| `~/Library/Application Support/Obsrv` | 22,251 entries | 22,251 entries |
| `~/Library/Logs/Obsrv` | 2 | 2 |
| `~/.obsrv` | absent | absent |
| `~/.obsrv-dev` | 3,675 | 3,675 |
| `~/.claude/skills/obsrv-screens` | 1 | 1 |

## The criterion has been pointing at a path nothing writes

`docs/readiness.md` and the board card both said the app's state lives in
`~/.obsrv`. **There is no `~/.obsrv`, and nothing in the source writes one.**
On this machine, which has run Obsrv for weeks, it does not exist.

What exists instead:

- `app.getPath('userData')` → `~/Library/Application Support/Obsrv` —
  `settings.json`, `history.json`, `tabs.json`, `control.json` (`src/main/ipc.ts`)
- `app.getPath('logs')` → `~/Library/Logs/Obsrv` — `obsrv.log` (`src/main/log.ts`)
- `~/.obsrv-dev` — the dev lane's own profile (`scripts/devLane.js`), not the app's
- `~/.claude/skills/obsrv-screens` — `obsrv install-skill`'s target

A check that looks in `~/.obsrv` reports "nothing remains" whatever the truth
is. That is the empty list fitting two facts, sitting inside the check itself.

## First: `HOME` does not isolate Electron on macOS

Measured before installing anything, because a reading from a contaminated home
is indistinguishable from a clean one.

With `HOME=/tmp/a4-home-…`, Electron 43.7.0 on macOS 25.5:

```
env_HOME    /tmp/a4-home-nbDA7k      <- what was asked for
os_homedir  /tmp/a4-home-nbDA7k      <- Node agrees
home        /Users/opeyemiajagbe     <- Electron does not
userData    /Users/opeyemiajagbe/Library/Application Support/Electron
appData     /Users/opeyemiajagbe/Library/Application Support
logs        /Users/opeyemiajagbe/Library/Logs/Electron
cache       /Users/opeyemiajagbe/Library/Caches
```

**`HOME` alone is a false sandbox**: every Node-level check reports the fake
path while Chromium writes into the real profile. The failure is silent and
looks exactly like success.

Two levers do work, and they cover different paths:

| Lever | Moves | Leaves alone |
| --- | --- | --- |
| `--user-data-dir=<dir>` | `userData`, `sessionData`, `crashDumps` | **`logs`**, `appData`, `cache` |
| `CFFIXED_USER_HOME=<dir>` | `home`, `userData`, `appData`, `logs`, `cache` | `temp` |

Neither moves `app.getPath('temp')`, which stays at the real per-user
`/var/folders/…/T/`. Node's `os.tmpdir()` does honour `TMPDIR`; Electron's
`getPath('temp')` does not.

**This outranks the card.** Any isolation in this project that relies on `HOME`
is not isolating Electron. Two consequences worth checking separately:

- The dev lane passes `--user-data-dir=~/.obsrv-dev/profile`
  (`scripts/devLane.js:126`), so its profile is genuinely separate — but
  `--user-data-dir` does not move `logs`, so **the dev app and the installed app
  write the same `~/Library/Logs/Obsrv/obsrv.log`** unless `OBSRV_TEST=1`, which
  redirects it under userData (`src/main/log.ts:21`). Not a defect on its own;
  it means a log line cannot be attributed to one of the two.
- The isolation used here (`CFFIXED_USER_HOME` + `TMPDIR` + a disposable npm
  prefix) is the recipe anything else in this repo should copy.

## The cycle

`npm install -g getobsrv` (0.60.0 from the registry), `obsrv --version`, one real
`snap` of a local page at `laptop-768`, one MCP `initialize` handshake,
`obsrv install-skill`, then `npm rm -g getobsrv`.

| Phase | Entries in home | Size |
| --- | --- | --- |
| 0 baseline | 2 | 0 KB |
| 1 after install | 6,977 | 133 MB |
| 2 after one use | 7,578 | 559 MB |
| 3 after uninstall | 1,792 | 209 MB |

The use phase is real, not simulated: the snap wrote a 12,184-byte PNG, and the
MCP server answered the handshake with
`{"serverInfo":{"name":"obsrv-mcp-server","version":"0.60.0"}}`.

## What remains after `npm rm -g getobsrv`

| Path | Size | Whose |
| --- | --- | --- |
| `~/Library/Caches/electron/<sha>/electron-v43.7.0-darwin-arm64.zip` | **128 MB** | ours, in effect |
| `~/.npm/_cacache` | 78 MB | npm's |
| `~/.claude/skills/obsrv-screens/SKILL.md` | 20 KB | ours, by request |
| `~/Library/Application Support/CrashReporter` | 0 | Electron's |
| `<prefix>/lib/node_modules`, `<prefix>/bin` | 0 | npm's, empty |

**The 128 MB Electron zip is the finding.** `npm rm -g getobsrv` removes the
package and leaves it, because it lives outside `node_modules` in a cache keyed
by Electron version. Nothing in Obsrv put it there — `@electron/get` did, on
first run — and nothing removes it. Uninstalling the tool leaves behind more
than the tool ever occupied. It is not mentioned in the README.

`~/.claude/skills/obsrv-screens` surviving is correct (a separate, explicit
install) but undocumented: nothing tells a user removing Obsrv that the skill is
still there, and `install-skill` has no matching removal.

## What is genuinely clean

- **No `obsrv-cli-*` directory remained anywhere** after a real render. The
  launcher's own cleanup (`bin/obsrv.js`, the plain-Node parent that outlives
  Chromium) works on a live run, not only in principle.
- **No `obsrv-mcp-*` directory remained** from the handshake.
- The npm prefix is left with empty `bin/` and `lib/node_modules/` — npm's own
  shape, no Obsrv files.

## The desktop app

`npm run dist` built an unsigned arm64 DMG from this tree at 0.60.0. Mounted
with `hdiutil`, `Obsrv.app` copied into the disposable home's `Applications`,
detached — then launched, a page loaded by typing its URL into the address
field, quit cleanly, and the bundle deleted, which is what dragging it to the
Trash does.

Isolation was verified from inside the running app rather than inferred from
the filesystem, because an empty directory and a directory nothing consulted
look identical:

```
home      /tmp/a4-app-…
userData  /tmp/a4-app-…/Library/Application Support/Obsrv
logs      /tmp/a4-app-…/Library/Logs/Obsrv
appData   /tmp/a4-app-…/Library/Application Support
cache     /tmp/a4-app-…/Library/Caches
temp      /var/folders/…/T/            <- never moves
```

The use is real, not simulated: `obsrv.log` records the start, and
`history.json` and `tabs.json` both carry the loaded URL.

| Phase | Entries (app bundle excluded) | Size |
| --- | --- | --- |
| 0 baseline | 3 | 0 KB |
| 1 after install | 4 | 298 MB (the bundle) |
| 2 after one use | 87 | 298 MB + 6 MB |
| 3 after deleting the app | **86** | **6 MB** |

**Deleting the app removed one entry: the app.** Everything it wrote stays.

### What remains, by kind

- **The addresses visited.** `history.json` — here a single line, in real use
  every URL rendered in the app. The README's *Privacy and files* section says
  history.json holds "the addresses you have visited in the app"; nothing says
  it outlives the app.
- **Chromium's per-site state** for every page rendered: `Cookies`,
  `Local Storage/leveldb`, `Session Storage`, `Trust Tokens`,
  `TransportSecurity`, `Network Persistent State`, `DIPS`, `blob_storage`,
  `Shared Dictionary`.
- **Caches**: `Cache/Cache_Data`, `Code Cache/{js,wasm,electron-preload}`,
  `GPUCache`, `DawnGraphiteCache`, `DawnWebGPUCache`.
- **Settings and session**: `settings.json` (screen diagonal, nits, agent
  control, update check, split, max tabs), `tabs.json` (the session restored on
  relaunch), `Preferences`, `Local State`, `DevToolsActivePort`.
- **The log**: `~/Library/Logs/Obsrv/obsrv.log`.

Six MB after one page. On this machine, after weeks of real use, the same
directory is **1.3 GB** — 936 MB `Cache`, 338 MB `Code Cache`. That growth is
what normal use accumulates rather than uninstall residue, and is its own card
(`bug-userdata-unbounded`); what belongs here is that **none of it is removed,
ever, by any documented step.**

### control.json survives a crash, not a quit

Measured deliberately, because two runs differing in one thing is a hypothesis
rather than a finding. With agent control on, `control.json` holds the loopback
port, the token, the pid and a start time, mode 0600:

```
clean quit  -> absent  — removed
SIGKILL     -> PRESENT — survives
```

Not a functional defect: MCP discovery treats a file whose pid is dead as no
app. But a crashed run leaves a token file in a profile that then survives the
uninstall too, and nothing sweeps it.

### Two things worth noting that are not residue

- **The locally built DMG carries no quarantine attribute** — `xattr` reports
  none, because it was not downloaded. The README's `xattr -cr` step is about
  builds fetched from Releases; anyone testing a local build will not reproduce
  the "damaged" dialog it describes.
- **electron-builder signed the app with `Restack Dev`**, an unrelated
  certificate on this machine, and reported success: `identityName=Restack Dev`.
  That is exactly the failure `docs/signing.md` step 3 warns about, reproduced
  without trying. It matters for A1, not for A4.

## What a removal would have to do

Nothing in the repo or the README removes any of the above, and there is no
uninstall command. For the record, the full list on macOS is:

```
~/Library/Application Support/Obsrv      settings, history, tabs, Chromium profile
~/Library/Logs/Obsrv                     obsrv.log
~/Library/Caches/electron/<sha>/*.zip    128 MB, only if the npm CLI was used
~/.claude/skills/obsrv-screens           only if `obsrv install-skill` was run
~/Library/Saved Application State/…      macOS window state, if any
```
