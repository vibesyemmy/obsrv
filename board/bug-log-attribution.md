---
title: "A log line cannot be attributed to the dev app or the installed one"
column: next
kind: bug
order: 28
---

Found by Rook 2026-09-14 while measuring A4's isolation, and confirmed here with a direct Electron probe.

`scripts/devLane.js:126` passes `--user-data-dir`, so the dev profile is genuinely separate from the installed app's. But that flag does NOT move `logs`. Measured:

    --user-data-dir     moves userData, sessionData, crashDumps — NOT appData, logs, cache
    CFFIXED_USER_HOME   moves home, userData, appData, logs, cache — NOT temp

So the dev app and the installed app both write `~/Library/Logs/Obsrv/obsrv.log` unless `OBSRV_TEST=1`.

Not a defect on its own — nothing is lost or corrupted. The cost is that **a line in that log does not say which of the two wrote it**, and this project has had two Obsrvs running side by side all day. Anyone debugging from the log while a dev build exists is reading an interleaving they cannot separate, and the log is what `docs/limitations.md` and the issue template both point people at.

The obvious fix is to move `logs` for the dev lane too. The less obvious and possibly better one is to stamp the line: a log that names its own writer stays readable even when someone runs a third instance the flag does not know about. That is the [[read-the-output-not-the-code]] principle — a sentence should name its own subject rather than depend on the reader knowing the context it was produced in.

Related: the same measurement produced `chore-electron-sandbox-note`, and the general fact is that Electron on macOS ignores `HOME` entirely.
