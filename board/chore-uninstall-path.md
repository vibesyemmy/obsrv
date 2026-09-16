---
title: "There is no supported way to remove Obsrv's data"
column: backlog
kind: chore
order: 32
---

Split from `bug-history-survives-uninstall` deliberately: that card is a privacy gap closable by a paragraph in the README, this one is a feature, and tying them means the cheap fix waits for the expensive one.

Deleting `Obsrv.app` removes the app and nothing else — measured, 87 entries before and 86 after. There is no `obsrv uninstall`, and `npm rm -g getobsrv` leaves the 128 MB Electron zip in `~/Library/Caches/electron/` (see `a4`).

Two shapes, and the lighter one may be enough:

- **A documented path list.** Four or five lines in the README naming every directory, so someone can remove them by hand and know they got all of it. No code, no risk of deleting the wrong thing on someone's behalf.
- **An `obsrv uninstall` command.** More usable, and it takes on the job of being careful — it must not delete a profile another instance is using, must say what it is about to remove before removing it, and must handle the CLI, the app and the MCP server having different footprints.

**Prefer the list first.** It is the part that makes the privacy statement true, it can ship immediately, and it is the specification the command would have to implement anyway. A command written before the list exists is a command whose completeness nobody can check.

Whoever takes the command: `a4`'s write-up (`docs/research/2026-09-14-a4-install-remains.md`) is the inventory, measured on a real packaged build rather than reasoned from the code.

## CHECKED 2026-09-16 by Henry — the list shipped, and it covers what was measured; the command is a product question

**The lighter shape is already in the README**, from `bug-history-survives-uninstall`: *"Removing
Obsrv does not remove any of that"* and three commands, for `~/Library/Application Support/Obsrv`,
`~/Library/Logs/Obsrv` and `~/Library/Caches/electron`.

**Checked against `a4`'s measured inventory** (`docs/research/2026-09-14-a4-install-remains.md`),
not reasoned from the code. After one use and the app deleted, what remains is `userData`
(history, tabs, settings, Chromium's per-site state and caches, and a crashed run's
`control.json`) and the log. `npm rm` also leaves the Electron zip in `~/Library/Caches/electron`.
**All three are on the list.** The rest of that inventory is npm's own (`~/.npm/_cacache`, an
empty prefix) or the developer-only dev lane (`~/.obsrv-dev`), and neither is Obsrv's to remove for
a user.

**What remains is the command, and whether to build one is scope, not a defect:** the card's own
words are *"the lighter one may be enough"*. **To Backlog, for Opeyemi:** is the documented list
enough, or is `obsrv uninstall` wanted? If it is, the list above is its specification, and the
card's cautions (don't delete a profile in use, say what it will remove first) are its
requirements.
