---
title: "Deleting Obsrv.app leaves your browsing history behind, undocumented"
column: next
kind: bug
order: 31
---

Measured by Rook 2026-09-14 on a real packaged build — unsigned arm64 DMG built from this tree, mounted, copied into a disposable home's Applications, launched under `CFFIXED_USER_HOME`, one page loaded by typing its URL, quit cleanly, then the bundle deleted, which is what dragging to the Trash does.

    after one page load     87 entries, 6 MB
    after deleting the app  86 entries, 6 MB

**One entry went, and it was the app.** What stays: `settings.json`, `tabs.json`, `obsrv.log`, the whole Chromium profile — Cookies, Local Storage, Session Storage, Trust Tokens, TransportSecurity, the caches — and `history.json`.

**Lead with the history, not the megabytes.** `history.json` is, in the README's own words, "the addresses you have visited in the app". A user who deletes an app they used to look at private pages has every reason to think those addresses went with it. They did not, there is no uninstall command, and no document says where to look.

The README's silence is the pointed part rather than an oversight of omission. Its *Privacy and files* section goes out of its way to say what IS cleaned up — headless CLI runs "use a throwaway Electron profile under `os.tmpdir()` and remove it on exit", and the MCP server "prunes its own, older than a day, at startup". Against that care, saying nothing about the app's own state reads as though there were nothing to say.

**Two things this card wants, and they are separable** — see `chore-uninstall-path` for the second:

1. The README says what survives deleting the app, and where it is. Cheap, and it closes the privacy gap on its own.
2. A supported way to remove it.

RELATED README ACCURACY, found in the same run and recorded here so it is not lost: a **locally built DMG carries no quarantine attribute**, so nobody testing a local build reproduces the "damaged" dialog the install instructions describe, and may conclude the instructions are wrong. Not a false statement — the instructions are right about downloaded DMGs — just silent about which builds they apply to.

Isolation for this measurement was read from INSIDE the running app (`app.getPath` for home, userData, logs, appData, cache, temp) rather than inferred from the filesystem afterwards, for the reason this project keeps relearning: a directory nothing consulted and a directory that came out empty look identical. `CFFIXED_USER_HOME` held on the real packaged app; temp never moved. Opeyemi's own profile was counted before and after at 22,251 entries, unchanged.
