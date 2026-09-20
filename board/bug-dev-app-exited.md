---
title: "A dev app exited between 18:42 and 19:13 with no explicit stop"
column: doing
waiting: ""
owner: "Kenya"
kind: bug
order: 30
---

Observed by Kenya 2026-09-14. **Titled for what was seen rather than for a mechanism, at Kenya's insistence — it declined to let this be filed as "the lane reaps idle apps" because the code says otherwise and that would have been a second claim inferred from mechanism within the hour.** Nobody knows why this app exited. That is the card.

TIMELINE, local time:

- ~17:55 — Kenya deliberately killed pid 65770
- then     relaunched with `--no-build`, got pid 2299
- 18:42:47 — the shared log's last write (`window hidden; target rasterisation paused` / `window shown; … resumed`, repeatedly)
- 19:13 — pid 2299 gone, noticed incidentally while checking something else

So it died inside that half hour, after logging normally.

WHY THIS IS SURPRISING RATHER THAN EXPECTED, verified in the source rather than taken from the report:

- `scripts/lane.js:59` spawns the app `detached: true, stdio: 'ignore'` and calls `.unref()`. It is in its own process group and should outlive the shell that launched it.
- Nothing in `scripts/lane.js`, `scripts/devLane.js` or `src/main/controlServer.ts` reaps an idle app. The only kills are the explicit stop path — `devLane.js:157` SIGTERM, `devLane.js:167` SIGKILL after a grace. The `process.kill(pid, 0)` at `devLane.js:133` is a liveness probe, not a kill.

A LEAD, TO BE HELD LOOSELY: the last lines are occlusion transitions — the same macOS desk state the visibility and log specs skip over. That is a place to look, not a cause, and Kenya flagged it as exactly the kind of lead someone will harden into an explanation if it is written down carelessly.

WHAT CANNOT BE SAID: whether it crashed, was killed from outside the lane, or exited cleanly. The lane app writes to the shared `~/Library/Logs/Obsrv/obsrv.log` with no field naming its writer, so its own exit line — if it wrote one — is indistinguishable from the installed app's.

**Which makes this card blocked on `bug-log-attribution` in practice.** Investigating it means reading a log that cannot say which process produced a line. Stamping the line should land first, or whoever takes this spends the effort and comes back with the same two-facts absence.

COST TO REPRODUCE: a relaunch and an idle half hour, spent watching a process rather than driving anything. Kenya will take it if Opeyemi wants it chased; otherwise it sits here with the timeline intact.

Bears on documentation: nobody should write "the dev app stays up" in `docs/` until this is understood. It is the kind of sentence that becomes a support answer.

## CLAIMED BY KENYA 2026-09-20

Reassigned from Rook (away), per Opeyemi's word (room #775), routed by Wren (#778). `bug-log-attribution`
merged at `6f19f9b`, which was this card's own stated blocker — checked what it actually shipped rather
than assuming "unblocked" means "answerable now":

**What the stamp does NOT do for this specific sighting.** It tags lines written *after* `6f19f9b`
(2026-09-15) with `app#pid` / `lane:<mark>#pid` / `dev:<mark>#pid`. The original death (18:42–19:13 on
09-14) predates it by a day — there is no retroactive attribution for the log lines that already
existed then. So "unblocked" means the NEXT recurrence is attributable, not that the 09-14 log can now
be re-read for an answer it never carried.

**So the actual next step is reproduction, not archaeology.** Relaunch under the dev lane (stamped now),
leave it idle through an occlusion transition or two (the one held-loosely lead on the card), and watch
whether it happens again — this time with a log line that can say which process wrote what, if anything,
around the moment it dies. Cost to reproduce is what the card already said: a relaunch and an idle
stretch, watching rather than driving.

## A SECOND SIGHTING, THIS ONE ATTRIBUTABLE, 2026-09-20 by Kenya

Reproduction fired on the first attempt: relaunched under the dev lane at 05:47:52Z (pid 73184), left it
idle, and it died at 07:19:27Z — with the stamp `bug-log-attribution` shipped, so this is the first
sighting the log itself can speak about.

**MEASURED: this is not a crash.** `#pid`-attributed lines around the death:

    07:19:23.081Z window shown; target rasterisation resumed
    07:19:27.345Z closing: main window; sessions going down
    07:19:27.357Z closed: sessions down
    07:19:27.374Z quitting
    07:19:27.374Z exiting

That is a complete, ordinary shutdown — checked against a dozen other stops in the same log going back
to 09-17, and every one of them has exactly this shape (`closing → closed → quitting → exiting`). A
crash truncates; this didn't. `~/Library/Logs/DiagnosticReports/` has nothing from this pid or window —
the three `.ips` files present are all dated 09-17, unrelated. **So whatever killed this instance asked
it to quit, and it complied.** The 09-14 sighting cannot inherit this answer (no attribution existed
then), but it changes what is worth suspecting there too: an ordinary, cooperative stop looks nothing
like what a crash would leave, and this shape is now the one to check for first on any future sighting.

**Not established: which caller.** `stopApp()` — the only function that produces this exact SIGTERM-then-
grace sequence — has exactly two call sites in the source: `scripts/lane.js`'s own CLI relaunch (someone
running `npm run lane` again), and `src/mcp/control.ts`'s `relaunchStaleDevApp()`, fired from inside a
live `obsrv-dev` MCP tool call when the running app is older than the checkout serving that call.
Checked both against the file timestamps, after the fact:
- the lane's pointer and build stamps (`node scripts/lane.js --status`) are unchanged since the 05:47:52
  launch — rules out a fresh `npm run lane` against this same worktree;
- the main checkout's own build (`out/main/index.js`, 2026-09-19 14:53 WAT) **predates** this app's
  start — so a live call served from the main checkout would not have judged it stale by that
  comparison either.

Five other sessions' `dev-mcp` proxy children were running at the time of death, all still rooted at the
main checkout rather than this worktree (`ps aux` at the moment of investigation) — present, and each
one *capable* of triggering the relaunch-on-move path the moment any of them made a live call, but
nothing here proves one did, and the mtime check above argues against the most obvious version of that
story. The proxy keeps no log of which call triggered what. **This is the honest state: a real,
attributable, non-crash death, with the mechanism narrowed to two candidates and neither confirmed.**

**Also checked, and worth recording as ordinary rather than a clue:** at 07:15:33.930Z the window went
`hidden` — occluded by an unrelated, deliberately-run reproduction (a different Electron instance,
launched for a separate desk-focus check, briefly became frontmost). It resumed (`shown`) at 07:19:23,
four seconds before the quit. Nothing here says the occlusion caused the stop; it is offered because the
card's own held-loosely lead was occlusion, and this is what an occlusion transition actually looked like
this time — brief, attributed, and not obviously connected to what followed it.

**Asked Opeyemi directly** whether he saw an unexpected Obsrv window and closed it around 08:19:23 WAT
(the four-second window between resuming and quitting) — the simplest explanation available, and one no
log can confirm or rule out. Answer pending; recorded here either way rather than left to memory.
