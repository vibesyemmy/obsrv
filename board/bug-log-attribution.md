---
title: "A log line cannot be attributed to the dev app or the installed one"
column: done
kind: bug
owner: "Rook"
order: 28
---

ROUTED TO ROOK 2026-09-15 by need, pending Opeyemi's word in Rook's own session. Rook asked to be routed by need rather than fit and explicitly deprioritised its own preference; this is that.

**WHY THIS ONE, over the alternatives that looked louder.**

`bug-ci-main-red-37pct` is nearly self-answering now: main's last nine completed CI runs are **8 green, 1 red**, against the 37% the card was written from. Two of the three top contributors were fixed tonight. That card wants a re-measurement, not a session.

`c1` is the real blocker among the readiness cards — Rook spotted that `c2` and `c2-retroactive` both depend on a compatibility policy nobody has written, and `c1` IS that policy. But a policy is a decision about what Obsrv promises, which makes it Opeyemi's to shape rather than a card to hand out.

**This card blocks another one**, which none of the others do: `bug-dev-app-exited` cannot be investigated while a log line cannot say which process wrote it. Whoever chases that process death reads an interleaving they cannot separate, and comes back with the same two-facts absence.

**AND THE PATTERN IS ALREADY PROVEN IN THIS REPO, WHICH IS THE ARGUMENT FOR THE FIX.** Rook filed `bug-lane-serves-another-tree` an hour ago on exactly the observation that *the lane's reply says which tree it serves, and that sentence caught a false green twice tonight* — once for Rook, once for Kenya. The stamp works. The log has no stamp at all.

So this is not "design a way to tell instances apart". It is: **do in `obsrv.log` what the lane reply already does, and which has already saved two sessions from recording a green that was about something else.**

The two cards are the same family pointed at different artefacts — the lane says which tree, the log says nothing at all — and the one with a working precedent is this one.

**What the card already establishes, so it need not be rediscovered:** `scripts/devLane.js:126` passes `--user-data-dir`, which moves `userData` and NOT `logs`; `src/main/log.ts:22` opens `join(app.getPath('logs'), 'obsrv.log')` and line 21 redirects only under `OBSRV_TEST=1`. So a dev-lane app and an installed app write the same file. Measured, not inferred.

**And what is NOT established, kept from the card's own correction:** whether they have actually interleaved. The log format has no field naming a writer, so "no lines mention the lane" fits *the lane never wrote* and *it wrote and nothing identifies it* equally. That absence is unreadable by anyone, including the sessions that produced it — which is the defect, stated better than the first draft stated it.

**Which also settles the shape of the fix.** Moving `logs` for the dev lane helps future runs, leaves every existing line unattributable, and does nothing for a third instance the flag does not know about — including the installed app, the one most likely to be running beside a lane. Stamp the line.

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

The obvious fix is to move `logs` for the dev lane too. The less obvious and possibly better one is to stamp the line: a log that names its own writer stays readable even when someone runs a third instance the flag does not know about. That is the `CONTRIBUTING.md` *Writing it down* principle — a sentence should name its own subject rather than depend on the reader knowing the context it was produced in.

Related: the same measurement produced `chore-electron-sandbox-note`, and the general fact is that Electron on macOS ignores `HOME` entirely.

INTO REVIEW 2026-09-15, branch `fix/log-attribution`. Unit 1181/1181, typecheck clean across three configs. Write-up: docs/research/2026-09-15-log-attribution.md.

OBSERVED, not argued — two Obsrv processes, two profiles, one log, under an isolated CFFIXED_USER_HOME:

    2026-09-15T08:35:16.755Z info  dev:dc1b#2942   obsrv 0.60.0 starting: ... unpackaged
    2026-09-15T08:35:23.771Z info  lane:rook#2963  obsrv 0.60.0 starting: ... unpackaged
    lines per writer: 2 dev:dc1b#2942 · 2 lane:rook#2963

Opeyemi's real ~/Library/Logs/Obsrv/obsrv.log was 882 lines, sha b205b72b, before and after.

THE IDENTITY IS THE PROFILE AND THE PROCESS, NOT THE BUILD, and that was Henry's catch before a line was written: two lanes off one commit are the same code and different Obsrvs, and a build tag would call them one writer — the exact failure the stamp exists to prevent. `userData` is what distinguishes instances (it is what --user-data-dir moves) and the pid distinguishes two runs of one profile. Two unit tests hold precisely those cases.

THE TAG: `app#pid` packaged · `lane:<label>#pid` or `lane:<mark>#pid` · `test#pid` under OBSRV_TEST · `dev:<mark>#pid` for anything else, where <mark> is four hex of the profile path. That last row is why moving the lane's logs was the wrong fix: it is the instance neither flag knows about, including `npm run dev` and the installed app running beside a lane.

WHAT IT DOES NOT DO, stated rather than implied: it cannot attribute a single existing line, and it does not establish that interleaving ever happened — that stays unknowable from the artefact and was deliberately not investigated, per this card's own correction.

This unblocks `bug-dev-app-exited`, which could not be investigated while a line could not name its writer.

ONE THING FROM RUNNING IT, since it is the same family: a check of mine printed "(no stray app processes above)" directly beneath two processes that were still running. A sentence keyed off nothing, in the session that spent the night on that defect. Killed, then verified by counting rather than asserting.

MERGED 2026-09-15 on Opeyemi's word, `6f19f9b`, no conflicts. Verified here before pushing
rather than taken from the branch's own report: build first (a stale `out/` has produced two
false results in this repo), then typecheck exit 0 across three configs, 1181/1181 unit with
`logWriter.test.ts` green at 10, `board:check` green.

**What I checked that a passing suite does not tell you: whether the tests test the thing.**
Two of the ten hold the trap directly — *"distinguishes two lanes that share a commit, which a
build tag would not"* and *"distinguishes two runs of ONE profile, which a profile tag alone
would not"*. Both directions, which is what makes `userData` + pid the right identity rather
than a plausible one.

**What I did NOT independently observe, said plainly because this card is about attribution.**
I did not see the stamp in a live log myself. `initLog()` is called only from
`src/main/index.ts`, so the CLI writes no log at all and a CLI run cannot exercise it — my
first attempt to observe it found an empty sandbox, which is correct behaviour and not a
finding. Rook observed it, with two processes and two profiles against one shared log under an
isolated `CFFIXED_USER_HOME`, and that observation stands as the card's evidence rather than
anything of mine.

**And the check I ran before that one was vacuous, which belongs here rather than nowhere.** I
compared Opeyemi's real log before and after, and it reported `0 -> 0 lines, sha "" -> ""` —
because I had the filename wrong (`main.log`; it is `obsrv.log`). A pass that meant *the file I
was watching does not exist*, on the card about lines that cannot say who wrote them. Re-run
against the real path it reads 882 lines and `b205b72b` before and after, unchanged — which
matches Rook's figure exactly, and is only worth quoting because the check can now be seen to
have something to look at.

Unblocks `bug-dev-app-exited`.
