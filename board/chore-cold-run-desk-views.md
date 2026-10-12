---
title: "Two first-run views only a desk can show: a browser-downloaded DMG, and an MCP call launching the app"
column: backlog
waiting: "Opeyemi: say when to run the LAUNCH half of view 2 (Obsrv quit first, so the call launches it); the running-app half was run 2026-10-12"
kind: chore
criterion: A3
order: 81
---

FILED BY HENRY 2026-09-17, closing `a3`. It holds that card's leftover, filed under the sweep's rule
that leftovers become cards and are never folded in quietly. **It needs Opeyemi's desk**, so it goes on
his batched question list and is not a task for an agent.

**What `a3` showed cold, on runners** (0.60.0 by hand, then the 0.61.0 RC 6/6 in `35175793982`): the CLI,
the MCP server and the app each came up correctly from published artifacts on a machine that had never
run Obsrv.

**What a runner cannot show:**

1. **A DMG downloaded in a browser.** `gh release download` sets no quarantine flag, so the "damaged app"
   dialog the README warns about never appeared on a runner. `codesign` reports the app ad-hoc signed,
   with "code has no resources but signature indicates they must be present". **What to record on a
   desk:** download `v0.61.0`'s DMG in Safari or Chrome, open it, and write down the exact dialog text
   and the steps a stranger would need to get past it. Then check that the README's instructions match
   what appeared, word for word.

2. **An MCP call that launches the app.** On a runner the live-first launch has no desk to put a window
   on. **What to record:** from a fresh Claude Code session with the plugin, make an `obsrv_snap` call
   with Obsrv not running. Record what appears on screen, whether the consent bar shows, whether focus
   moves, and what the reply says.

**Also look for** the six `Electron Helper … XPC error for connection com.apple.backupd.sandbox.xpc`
lines that every CLI run printed on a runner. If a desk prints them too, they are Obsrv's to explain; if
not, they are the runner's.

**Desk rule:** view 2 launches the app and takes the desk by design, so it runs only when Opeyemi chooses
to run it.

## VIEW 1 RUN ON THE DESK BY OPEYEMI, 2026-09-30 — and the README's command was wrong in the blunt direction

He downloaded `Obsrv-0.63.1-arm64.dmg` **from the GitHub release page in a browser**, which is the step
`gh release download` cannot stand in for, and installed it.

**What appeared:** the "damaged" dialog, exactly as the README warns. So the quarantine path is real on a
desk and the runner's silence was the runner's, not the product's — which is what this view existed to
find out.

**What he had to run to get past it:**

```
xattr -dr com.apple.quarantine /Applications/Obsrv.app
```

**What the README told him to run**, in two places (Quickstart and Install):

```
xattr -cr /Applications/Obsrv.app
```

**Both work, and the README's is the blunter of the two.** `-c` clears **every** extended attribute on
the bundle, recursively; `-d com.apple.quarantine` deletes the one attribute that causes the dialog.
Telling a stranger to strip all metadata from something in `/Applications` when one named attribute is
the problem is more than the situation asks for, and the narrower command is the one the wild actually
produced. **Changed to the targeted form in both places.**

**View 1 is closed.** View 2 — an MCP call launching the app from a fresh session, with the consent bar,
the focus behaviour and the reply recorded — still needs his desk and is still not an agent's task.

**Still open from the original card and not answered here:** whether a desk prints the six
`Electron Helper … XPC error for connection com.apple.backupd.sandbox.xpc` lines every CLI run showed on
the runners. Nobody looked while he was installing, and inventing an answer for it would defeat the
point of the view.

## VIEW 2, THE RUNNING-APP HALF, RUN 2026-10-12 ON OPEYEMI'S WORD; the launch half is still unobserved

**How it ran, and why only half.** Opeyemi said "Run cold-run view 2 now" in the Resolver session. Resolver's
first `obsrv_snap` call, with Obsrv not running, was **refused by the session's permission classifier** as
"Irreversible Local Destruction": a launch on the real profile rewrites `tabs.json` and `history.json`. Nothing
ran. Opeyemi then launched the installed app themselves ("I have launched the app"; pid 15446, up 1 m 35 s at
22:57:05Z) and repeated the instruction. So this records **an MCP call driving an already-running app**, not one
launching it. Before anything ran, Resolver backed up `tabs.json` and `history.json` (md5 `1bb02408…`,
`58da21f1…`).

**The call:** `obsrv_snap { url: "https://example.com" }` from the Resolver session, default `mode: auto`. The
MCP was the published `getobsrv@0.63.1`, the pinned release; its schema still lists `orientation`. The installed
app is 0.63.1.

**What the reply said:**
- `mode: "live"`, `navigated: true`, `settled: true`, `warnings: []`.
- No `launched` field, which fits an app that was already running.
- **`preset: "sxga-19"`** (1280×1024): the preset the app was already on. No preset was passed, and the tool's
  description says the default is `1080p-24`. In live mode the app's own preset was kept. Recorded as observed,
  not judged.
- `orientation: "portrait"` is still in the reply; 0.64.0 removes it.

**What appeared on screen** (the returned window capture): tab 1 navigated to `https://example.com/`, the
toolbar carries an amber **AGENT** badge at top right, and **no consent bar is visible**.

**Focus:** Claude was frontmost at 22:57:05Z. A watcher polling `lsappinfo front` every 100 ms, started in the
same instant as the call, read Obsrv frontmost on its first sample (22:57:11Z), and Obsrv stayed there through
22:57:25Z. **This cannot say the call fronted the app**, because the watcher had no sample from before the call.

**The profile:** `history.json` changed when the app launched, before the call. After the call `tabs.json`
(370 → 349 bytes) and `history.json` both changed, as tab 1 was replaced by example.com. The pre-launch backups
exist.

**Still not observed:** the launch half (Obsrv not running, so the call launches it): whether a consent bar
appears on a launch, and whether a launch takes focus. It needs Opeyemi to quit Obsrv first, and either run the
call themselves or allow it in the Resolver session. The six `Electron Helper … XPC error` lines on a desk CLI
run are still unexamined.

