---
title: "Two first-run views only a desk can show: a browser-downloaded DMG, and an MCP call launching the app"
column: backlog
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

