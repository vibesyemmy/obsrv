# A4: install, use, uninstall — what remains

Run 2026-09-14 by Rook. Surfaces: the npm CLI and the MCP server. The desktop
app is **not** covered here and is where the app's own state lives, so A4 is not
fully answered by this page — see *Not measured* at the end.

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

## Not measured

The desktop app. It is where `settings.json`, `history.json`, `tabs.json`,
`control.json` and `obsrv.log` are written, and it needs a DMG built, mounted,
run and removed under `CFFIXED_USER_HOME`. Scope decision, deferred.

One number worth having before that work: on this machine the real
`~/Library/Application Support/Obsrv` is **1.3 GB**, of which 936 MB is
`Cache` and 338 MB `Code Cache` — Chromium's HTTP and compiled-code caches for
every page ever rendered in the app. That is the app's own profile, untouched by
this run, and nothing prunes it. Whether that belongs to A4 (what removal leaves)
or to a card of its own is a judgement for whoever takes the app half.
