---
title: "control.json survives a crash and then survives the uninstall"
column: backlog
kind: bug
order: 33
---

Measured by Rook 2026-09-14, and the way it was measured is the part worth copying.

Rook's first packaged-app run threw before `close()` and left a `control.json`; the clean run did not. **Two runs differing in one thing is a hypothesis, not a finding**, so it ran both deliberately with agent control on: a clean quit removes the file, `SIGKILL` leaves it — port, token, pid, mode `0600`.

Not a functional defect on its own. Discovery already treats a dead pid as no app (see `single-instance`), so a stale file does not mislead the MCP server or another instance.

The cost is that it is a **token on disk with no owner**, and it then survives deleting the app along with everything else in `bug-history-survives-uninstall`. A loopback token is low-value — it is bound to a port nothing is listening on — but "low-value credential left behind indefinitely after the program that made it is gone" is the sort of sentence that is easier to fix than to defend.

Cheapest fix is a sweep at startup rather than a handler at exit: a crash is by definition the case where the exit path did not run, so anything that relies on shutdown cannot close this. The app already knows how to judge a dead pid; the same check can delete rather than only ignore.

Related: `a4` for the full inventory, and `bug-history-survives-uninstall` for the removal question this feeds into.
