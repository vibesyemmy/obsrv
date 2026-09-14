---
title: "Three sessions were sharing one working tree"
column: doing
kind: chore
owner: "Henry"
order: 15
---

Found 2026-09-14 when Kenya joined the room and reported being in /Users/opeyemiajagbe/Documents/Projects/Obsrv on main at f470827 — the same checkout Henry was mid-edit in, and the same one Rook described in the room at the older HEAD a5c1a3c. Kenya also saw its branch change under it (test/explained-table-staleness -> main), which was Henry merging and checking out main in that tree an hour earlier.

`git worktree list` showed only two worktrees, neither belonging to Rook or Kenya — so up to three sessions on one tree, which is the hazard Rook itself flagged in the room before anyone hit it, and which has cost this project a rebuild before (a `git checkout -- .` from one session dropped another's uncommitted work).

RESOLUTION ISSUED: nobody edits the shared checkout; each session takes its own worktree (Rook /tmp/obsrv-rook on feat/cli-version, Kenya /tmp/obsrv-kenya on docs/c5-note-inventory). Henry stays in the main checkout as the one already mid-change. obsrv-e7 has worked from /private/tmp/obsrv-c4-sweep all day, so the pattern is proven.

Also flagged: the git stash stack is SHARED across worktrees, so a bare `git stash pop` in one takes another's work. WIP commit, or stash push -u -m with a unique tag and apply by sha.

OPEN: this is currently a convention announced in a chat room, which is the weakest possible enforcement — it survives exactly as long as the room's scrollback. Worth deciding whether it belongs in CONTRIBUTING or a pre-edit check.
