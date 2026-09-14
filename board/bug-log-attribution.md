---
title: "A log line cannot be attributed to the dev app or the installed one"
column: next
kind: bug
order: 28
---

CORRECTED 2026-09-14, an hour after filing, because the card asserted more than had been measured. Kenya caught it and the objection lands on this card's own principle.

WHAT IS MEASURED (mechanism, confirmed in the source and by probe):
- src/main/log.ts:22 opens `join(app.getPath('logs'), 'obsrv.log')`; line 21 redirects logs into userData ONLY when OBSRV_TEST=1.
- scripts/devLane.js:126 passes `--user-data-dir` and line 127 sets OBSRV_AGENT_CONTROL, OBSRV_DEV_LANE and OBSRV_DEV_LANE_LABEL — NOT OBSRV_TEST.
- An Electron probe confirms `--user-data-dir` moves userData and leaves `getPath('logs')` in the real profile.

So a dev-lane app writes to the shared ~/Library/Logs/Obsrv/obsrv.log. That much is established.

WHAT WAS NOT MEASURED, and what the first version of this card wrongly stated as fact: that the two HAVE been interleaving. Kenya checked — /tmp/kenya-lane/profile has no logs directory, and the live log contains zero lines mentioning its lane label or worktree path.

AND THAT ABSENCE PROVES NOTHING, which is the whole point of the card and which I had to be shown on my own card. The log format has NO LANE FIELD. So "no lines mention the lane" fits two facts: the lane's app never wrote, or it wrote and nothing in a line identifies a writer. Kenya searched for a marker the format cannot carry. The second is likelier precisely because the format has no way to carry the first.

ONE DETAIL OF KENYA'S READ CORRECTED, since it slightly weakened its own conclusion: the log's last line is timestamped 17:42:47.152Z and the file's mtime is 18:42:47. Those are the SAME INSTANT — this machine is WAT (UTC+1), log lines are UTC, mtime is local. Kenya read them as an hour apart and concluded the log's entries predate most of its lane work. They do not; that line is the last write.

SO THE CARD STANDS AND ITS FIX MATTERS MORE, NOT LESS. Whether interleaving happened today is not merely unknown — it is unknowable from the artefact, by anyone, including the two sessions that produced it. That is the defect, stated better than the first draft stated it.

Which also settles the fix. Moving `logs` for the dev lane would help future runs and would still leave every existing line unattributable, and would do nothing for a third instance the flag does not know about. STAMP THE LINE. A log that names its own writer stays readable however many Obsrvs exist, and is the only version of this fix that makes the existing question answerable going forward.

Found by Rook 2026-09-14 while measuring A4's isolation, and confirmed here with a direct Electron probe.

`scripts/devLane.js:126` passes `--user-data-dir`, so the dev profile is genuinely separate from the installed app's. But that flag does NOT move `logs`. Measured:

    --user-data-dir     moves userData, sessionData, crashDumps — NOT appData, logs, cache
    CFFIXED_USER_HOME   moves home, userData, appData, logs, cache — NOT temp

So the dev app and the installed app both write `~/Library/Logs/Obsrv/obsrv.log` unless `OBSRV_TEST=1`.

Not a defect on its own — nothing is lost or corrupted. The cost is that **a line in that log does not say which of the two wrote it**, and this project has had two Obsrvs running side by side all day. Anyone debugging from the log while a dev build exists is reading an interleaving they cannot separate, and the log is what `docs/limitations.md` and the issue template both point people at.

The obvious fix is to move `logs` for the dev lane too. The less obvious and possibly better one is to stamp the line: a log that names its own writer stays readable even when someone runs a third instance the flag does not know about. That is the [[read-the-output-not-the-code]] principle — a sentence should name its own subject rather than depend on the reader knowing the context it was produced in.

Related: the same measurement produced `chore-electron-sandbox-note`, and the general fact is that Electron on macOS ignores `HOME` entirely.
