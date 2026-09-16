---
title: "control.json survives a crash and then survives the uninstall"
column: doing
owner: "Rook"
waiting: ""
kind: bug
order: 33
---

Measured by Rook 2026-09-14, and the way it was measured is the part worth copying.

Rook's first packaged-app run threw before `close()` and left a `control.json`; the clean run did not. **Two runs differing in one thing is a hypothesis, not a finding**, so it ran both deliberately with agent control on: a clean quit removes the file, `SIGKILL` leaves it — port, token, pid, mode `0600`.

Not a functional defect on its own. Discovery already treats a dead pid as no app (see `single-instance`), so a stale file does not mislead the MCP server or another instance.

The cost is that it is a **token on disk with no owner**, and it then survives deleting the app along with everything else in `bug-history-survives-uninstall`. A loopback token is low-value — it is bound to a port nothing is listening on — but "low-value credential left behind indefinitely after the program that made it is gone" is the sort of sentence that is easier to fix than to defend.

Cheapest fix is a sweep at startup rather than a handler at exit: a crash is by definition the case where the exit path did not run, so anything that relies on shutdown cannot close this. The app already knows how to judge a dead pid; the same check can delete rather than only ignore.

Related: `a4` for the full inventory, and `bug-history-survives-uninstall` for the removal question this feeds into.

## Claimed by Rook 2026-09-16, assigned by Wren

Mine by fit — I measured it on 09-14, and the card's own note about *how* it was measured ("two runs
differing in one thing is a hypothesis, not a finding") is the part I want to keep honouring here.

### Where the judgement already lives, and why that is the design question

`src/mcp/control.ts:172` already decides this, and carefully: `process.kill(pid, 0)`, treating
`ESRCH` as gone and `EPERM` as alive-but-someone-else's, **plus** a boot-time plausibility check,
because `kill(pid, 0)` proves only that *something* holds that pid — a crashed run's stamp can
outlive it until the OS recycles the number onto an unrelated process. Its own comment records the
residual gap it does not close: a pid recycled **within** the same boot session.

**But that copy belongs to the reader, not the writer.** It is in `src/mcp/`, and the file is written
by the app in `src/main/` (`ipc.ts:1517`). So the choice is:

1. **Share the judgement** — move it to `src/shared/control.ts`, where both sides already import
   `CONTROL_FILE_NAME` from, and have the app's startup sweep use the same function the MCP reader
   uses. One definition of "this file's owner is gone".
2. **Write a second one** in `src/main/`, which would be quicker and is how "declared" came to mean
   two things in `#127` — the exact drift that card was reopened to fix.

**Taking (1)**, and saying so before writing, because the second is the tempting one at the moment of
writing it.

### What the sweep must not become

A sweep that deletes on *any* unreadable or unexpected file would also delete a **live** app's
control file the moment its format changes — turning a forward-compatibility problem into a
denial of service against the running instance. Deleting is only correct for a file whose owner is
provably gone. Unparseable is **not** provably gone, and must be left alone.

### Controls, including the one that stops this being theatre

- a planted `control.json` with a **dead** pid is gone after launch;
- one with a **live** pid survives;
- an **unparseable** one survives — deleting is for provable absence, not for confusion;
- **the vacuity arm:** a sweep that never runs must not read as "nothing stale". The test has to fail
  when the sweep is removed, or it is asserting that a file it never created is absent. This is the
  arm that would have been skipped, so it is written down first.
