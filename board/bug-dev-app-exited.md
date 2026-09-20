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
