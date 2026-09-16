---
title: "control.json survives a crash and then survives the uninstall"
column: done
owner: "Rook"
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

## READ BEFORE BUILDING: the fix this card proposes already exists — 2026-09-17

Checked by Rook before writing the sweep, and it stopped a redundant change.

**Every startup path already removes a stale file**, and has since before this card was filed. The
app writes its stance at boot either way (`src/main/ipc.ts:2114`):

    if (settings.agentControl) applyAgentControl(true)   →  control.start()
    else                      control.writeDisabled()

and **both begin by deleting whatever is there**:

    controlServer.ts:243   rmSync(this.file, { force: true })   // in start()
    controlServer.ts:260   rmSync(this.file, { force: true })   // in writeDisabled()

The removal is there for a different stated reason — `mode: 0600` only applies at creation, so a
fresh write needs a fresh file — but it does exactly what this card asked for, on every launch,
whether or not agent control is on.

**And the unconditional delete is safe**, which was the other thing worth checking before proposing
a conditional one. `app.requestSingleInstanceLock()` is keyed on the userData path and **the loser
exits before it has a window** (`src/main/index.ts:173`), so only one process ever reaches the write
for a given profile. The harness's throwaway profiles and the CLI's temp profile never contend.

### What is actually left, which is not this card's

**The window is a crash until the next launch** — not "indefinitely". A crashed run's file survives
exactly until Obsrv next starts on that profile, at which point it is replaced.

So the remaining case is the one this card's own last line already points at: **a crash followed by
an uninstall, with no launch in between.** That is `bug-history-survives-uninstall`, and a token
sitting in a deleted app's leftovers is a removal question rather than a startup one.

### What I did not build, and why

I had written a shared `ownerIsGone` — `kill(pid, 0)` plus a boot-time check, with seven tests — to
make the delete conditional rather than unconditional. **I deleted it rather than shipping it.** It
guards a failure the single-instance lock makes unreachable, and it would have introduced a second
definition of "this owner is gone" beside `src/mcp/control.ts`'s — the drift `#127` was reopened to
fix. An unnecessary check that duplicates an existing judgement is a cost, not a safeguard.

**Proposed: close this as already fixed**, with the uninstall case tracked where it belongs. Left to
Henry rather than done unilaterally, because the card records a measurement of mine and someone else
should agree the thing I measured is no longer there.

## Agreed already fixed, 2026-09-17, by Henry — read against `main` (`5a1b6aa`), not taken on description

- **Both boot writes replace the file unconditionally.** `ControlServer.start()` does
  `rmSync(this.file, { force: true })` before its `writeFileSync`, and its own comment names the case:
  *"a stale file (a crashed run) is removed first"*. `writeDisabled()` does the same. Boot calls exactly
  one of them either way: `if (settings.agentControl) applyAgentControl(true) else control.writeDisabled()`.
- **Nothing contends for the delete.** The single-instance lock is keyed on the userData path, and the
  loser exits before `registerIpc` writes anything.
- **The residue is as Rook states it:** a crash leaves the file only until that profile's next launch,
  or for good if the app is uninstalled before then. The uninstall case belongs to
  `bug-history-survives-uninstall`, not here.
- **One limit, not a reason to reopen:** no e2e plants a stale file and checks it is replaced. The
  guarantee comes from construction (an unconditional replace on every boot write). If that write ever
  becomes conditional, this card's question comes back.
