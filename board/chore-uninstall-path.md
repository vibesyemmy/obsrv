---
title: "There is no supported way to remove Obsrv's data"
column: doing
owner: "Henry"
waiting: "Opeyemi: the sandbox grant, asked in Henry's session 2026-09-17"
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

## BEFORE ANYONE WRITES THIS: the obvious way to test it deletes the real profile

Added 2026-09-17 by Rook, unowned and not a claim — this is the one thing whoever takes it needs
before they start, and it belongs on the card rather than in a room where it scrolls away.

**An uninstaller is the one feature whose tests must exercise deletion of exactly the paths this
repo forbids touching.** `~/Library/Application Support/Obsrv` is 1.3 GB of real history, tabs and
Chromium profile on Opeyemi's machine. A test that gets its sandbox wrong here does not leave a
stray file; it removes his browsing history.

**And the obvious sandbox does not work, which is measured and already on the board.** On macOS
`os.homedir()` follows `HOME`, and **`app.getPath()` does not** — so an Electron run under a
`HOME`-only sandbox writes to the *real* profile while every Node-side check reports the sandbox
clean. That combination is worse than no sandbox: it produces a green test and a real deletion.

- `CFFIXED_USER_HOME` is the lever that actually moves `app.getPath()`.
- `--user-data-dir` moves the profile but **misses the logs**, so a uninstaller validated only that
  way will report success with `~/Library/Logs/Obsrv` still there.
- Neither moves temp.

**So the first task on this card is not the command — it is a fixture that can prove a deletion
happened somewhere other than `$HOME`,** and a test that fails loudly if the path it is about to
remove resolves inside the real one. Write the guard before the feature it guards, because the cost
of finding out afterwards is not a red test.

**A second requirement the card's cautions imply but do not state:** `a4`'s inventory
(`docs/research/2026-09-14-a4-install-remains.md`) was measured on a packaged build, and
`~/Library/Caches/electron` is **Electron's directory, not Obsrv's** — other Electron apps share it.
An `obsrv uninstall` that removes it removes another app's runtime. The README paragraph handles this
by telling a person to check; a command cannot ask, so it should either leave that path alone and
name it, or refuse to touch it without an explicit flag.

## Claimed by Rook 2026-09-17, assigned by Henry on Opeyemi's decision to build the command

Taken on the terms of the hazard section above, which I wrote before it was mine and which Henry
adopted as the assignment's conditions:

1. **The fixture and the guard come before the command.** Not "with", not "alongside" — the guard
   that fails when a path resolves inside the real `$HOME` is written and shown to fail first.
2. **`~/Library/Caches/electron` is not Obsrv's to delete.** My call, made here: the command
   **names it and leaves it**, and prints the `rm -rf` a person can run themselves. A flag that
   removes another app's runtime is a flag someone passes once and regrets; the README already has
   the sentence telling a person to check first, and a person is the right one to check.
3. **No deletion code is written until Opeyemi's word on the test sandbox arrives in my session.**
   My standing constraint is never to remove anything under his HOME, and the only sandbox that
   isolates Electron on macOS is one that has to be got exactly right. That constraint is his to
   relax; a relayed yes is not that word, and neither is Henry's or Wren's agreement that I should
   ask. **`waiting:` names it.**

**What proceeds meanwhile:** the guard is a pure function over paths, and a fixture is a directory
layout. Neither deletes anything, both are testable, and both are the specification the command has
to satisfy. That is the part that does not need the word.

## MOVED TO HENRY 2026-09-17, and the grant asked for again — in the session that would write the code

Opeyemi's answer to the sandbox question, verbatim through Wren (room #452): *"Rook is out till
saturday. So let Henry handle it please."* That moves the card. **It is not the grant**, and Rook's
own condition is the reason it cannot be: the word has to arrive in the session that writes the
deletion code, because a relayed yes is somebody else's account of a permission. The condition now
binds Henry exactly as it bound Rook.

**Asked directly, in Henry's session, 2026-09-17:** may deletion code be written whose tests delete
only inside a throwaway `CFFIXED_USER_HOME` sandbox under the system temp directory, with a guard
that refuses any path resolving inside the real home, shown failing first, and with the tests running
on CI only?

**What proceeds without the word**, on Rook's terms, unchanged: the guard is a pure function over
paths and the fixture is a directory layout. Neither deletes anything, and together they are the
specification the command has to satisfy.

