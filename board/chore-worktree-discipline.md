---
title: "Three sessions were sharing one working tree"
column: done
kind: chore
owner: "Henry"
order: 15
---

CLOSED 2026-09-15 on Opeyemi's word, by writing `CONTRIBUTING.md`.

**The open item was the whole card and it sat untouched for fourteen hours.** The resolution below was issued in a chat room on 2026-09-14 and held all night — four worktrees in use, four sessions, zero collisions — but it held because everyone kept remembering, which is exactly what the card said was the weakest possible enforcement. The card spent a night demonstrating its own thesis while sitting in Doing with an owner's name on it.

Opeyemi spotted it, by reading the Doing column and asking what was going on. Two of the three cards there were real work; this one was mine and was not.

**What went into `CONTRIBUTING.md`**, and the criterion for inclusion was *someone lost an hour to this*, not *this is good practice*:

- Work in your own worktree, with the three sessions in one checkout as the evidence, and the shared stash stack across worktrees.
- **Build before you test.** `npx playwright test` and the MCP tools run the built `out/`, and that produced TWO false failures in one evening by two different sessions — one a real bug falsely reproduced on the first attempt, one a merge nearly reported broken. If a failure surprises you, check the build before the code.
- **Verify by watching it fail**, with four real instances: the vacuity-starved staleness check, the relaunch spec whose tab sat at position 0 where the index is accidentally right, the label decided by a race, and the concurrency guard that cancelled the runs it was written to protect.
- The board's claim mechanism, and why `board:check` runs on push rather than on `pull_request`.
- That `HOME` does not sandbox Electron on macOS, and neither lever moves `temp`.
- `-g` filtering not being safe everywhere, and the suite lock.
- Sentences naming their own subject, and naming the two facts a silence fits.

Linked from the README, since a document nobody is pointed at is the same defect as a convention in a room.

Found 2026-09-14 when Kenya joined the room and reported being in /Users/opeyemiajagbe/Documents/Projects/Obsrv on main at f470827 — the same checkout Henry was mid-edit in, and the same one Rook described in the room at the older HEAD a5c1a3c. Kenya also saw its branch change under it (test/explained-table-staleness -> main), which was Henry merging and checking out main in that tree an hour earlier.

`git worktree list` showed only two worktrees, neither belonging to Rook or Kenya — so up to three sessions on one tree, which is the hazard Rook itself flagged in the room before anyone hit it, and which has cost this project a rebuild before (a `git checkout -- .` from one session dropped another's uncommitted work).

RESOLUTION ISSUED: nobody edits the shared checkout; each session takes its own worktree (Rook /tmp/obsrv-rook on feat/cli-version, Kenya /tmp/obsrv-kenya on docs/c5-note-inventory). Henry stays in the main checkout as the one already mid-change. obsrv-e7 has worked from /private/tmp/obsrv-c4-sweep all day, so the pattern is proven.

Also flagged: the git stash stack is SHARED across worktrees, so a bare `git stash pop` in one takes another's work. WIP commit, or stash push -u -m with a unique tag and apply by sha.

OPEN: this is currently a convention announced in a chat room, which is the weakest possible enforcement — it survives exactly as long as the room's scrollback. Worth deciding whether it belongs in CONTRIBUTING or a pre-edit check.
