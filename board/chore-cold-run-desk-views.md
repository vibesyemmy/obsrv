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
