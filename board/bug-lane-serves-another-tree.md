---
title: "The dev lane says which tree it serves, and never says it is not yours"
column: doing
owner: "Henry"
waiting: ""
kind: bug
order: 6
---

Raised 2026-09-15 by Rook, out of `bug-contrast-figure-mismatch`, and filed unowned deliberately — see the last paragraph.

**THE HAZARD.** The `obsrv-dev` MCP tools serve one lane per machine, and that lane serves whichever checkout built it. Measured while writing this card:

    npm run lane -- --status   ->  main @ c7e57c4 · ~/Documents/Projects/Obsrv
    the caller                     .../Obsrv/.claude/worktrees/rook-cli-version

So a session working in a worktree — which is the rule in CONTRIBUTING.md, not the exception — calls `obsrv-dev` tools and exercises **main, not its branch**. Nothing contradicts the assumption that it is testing its own work. The verification comes back green, and the green is about somebody else's code.

**TWO INDEPENDENT ENCOUNTERS, and neither session was looking for it.** Rook, 2026-09-15, verifying the contrast fix: `mcp__obsrv-dev__obsrv_inspect` answered with `obsrv-dev lane: main @ abb508f` and the fix was in a worktree the lane had never built. Kenya, 2026-09-14, found the shared lane pointing at Henry's half-finished tree. One trap, two directions, two days.

**WHY THIS IS A CARD AND NOT A KNOWN QUIRK.** The lane already reports its root, and that sentence caught it both times — so the information exists and the mechanism works. What is missing is the comparison. **The reply states a fact and never contrasts it with what the reader assumes**, which is this project's recurring defect wearing its plainest clothes: a true sentence that does not know what the reader believes. A stamp becomes a warning only if someone tired happens to compare two paths in their head.

**WHAT MAKES IT LOAD-BEARING BEYOND ITSELF.** Every verification any session does through `obsrv-dev` is suspect unless that line was read and compared. This team's whole method is *measure rather than reason*, and this is the one hazard that corrupts the measuring instrument itself while leaving it looking correct. A false green here is indistinguishable from a real one.

**THE OBVIOUS FIX, and the reason it is not obviously right.** Compare the lane's root with the caller's working directory and WARN when they differ, rather than stating the root and leaving the comparison to the reader.

Two things whoever takes it should establish rather than assume, because the obvious fix has a way to be wrong:

- **An MCP server may not know the caller's worktree.** The proxy at `~/.obsrv-dev/bin/dev-mcp.js` runs where it runs; the session's cwd is not necessarily the tool's. If it cannot be known reliably, a warning built on a guess is worse than the stamp — it would cry wolf on a session that was right, and this repository has learned twice what that does to a guard (`chore-guard`, and the suite-answer check's no-open-PR exit).
- **Serving another tree is sometimes correct.** A session deliberately testing main from a worktree is a legitimate use, and `OBSRV_DEV_HOME` exists for a second lane. The warning has to distinguish *you are on a different tree* from *you are on a different tree than you think*, and only the second is worth a sentence. Whether that distinction is reachable at all is the first measurement.

**UNOWNED, and Rook's reasoning for not taking it.** It found the hazard and already has an explanation of the fix, which is exactly the state it was in on `bug-contrast-figure-mismatch` — where its own two hypotheses were both wrong and a neutral instrument, not an explanation, found the answer. That argument was overruled once on good grounds (the finder held run 17's output and a cold reader would have reproduced it all). Here there is nothing to reproduce: the hazard is two lines of `--status` output, and a session arriving cold loses nothing and brings no committed theory about how the warning should work.

## PROGRESS 2026-09-16 by Henry: the proxy cannot see the caller's tree, so the call names it

**The first measurement the card asked for: can the MCP server know the caller's worktree? No.**
Read from the four `obsrv-dev` proxies running on this machine at 16:05Z (`lsof` cwd, and the
environment of each process):

- **Every proxy's working directory and `CLAUDE_PROJECT_DIR` are the main checkout,** for all four
  sessions. A proxy starts in the project its session opened and stays there.
- **The session's own process followed its worktree for one session and not another.** Rook's sits
  in `.claude/worktrees/rook-cli-version`. Henry's sits in the main checkout while Henry works in
  three worktrees under `/private/tmp`. Reading the parent's directory would be right for one and
  silently wrong for the other.
- **Claude Code declares MCP `roots`** (read from the client's code, not measured). They are built
  from the session's working directory and its added directories: where a session may work, not
  which of several worktrees a given call means.

**The obvious fix would also have been silent on Rook's own case.** A worktree under
`.claude/worktrees/` sits inside the main checkout, so "is the caller's path inside the lane's
checkout" answers yes. Checkouts have to compare by their git tops.

**So the call says which checkout it means.** Every `obsrv-dev` tool gains a required `tree`, the
top of the caller's working tree, and the proxy compares git tops:
- a call naming the lane's checkout, or a directory in it, runs, and the lane's server never sees `tree`;
- a call naming another checkout, a worktree inside the lane's included, is not run, and names
  both and how to point the lane;
- a call naming no checkout, or a path in none, is not run and says what to pass;
- `tree: "any"` runs on whatever the lane serves: the card's "serving another tree is sometimes
  correct", said on purpose rather than by default.

**Wren's cold read found the escape hatch reopening the hazard, and it is closed in the same PR.**
An `"any"` answer carried the same stamp as a compared one, so a reader could not tell them apart:
the state before this change. Now both stamps on an `"any"` answer, the proxy's text line and the
lane server's line in `notes` or `warnings` (the one Claude Code shows), end
`tree "any": not compared with your checkout`. The refusals for no `tree` and for a path in no
checkout no longer offer `"any"`; they say what to pass. A caller who never thought about trees
should not be handed the one value that skips the check. The mismatch refusal still offers it,
where running on the lane's build is a real decision. It also says that pointing the lane away
turns calls meant for the lane's checkout into refusals, since another session may be the one
using it.

**Controls, one run each:** eight sabotages each turned exactly the intended unit test red: no schema
rewrite, `tree` forwarded to the build, path containment instead of git tops, a missing `tree`
allowed, another checkout allowed, no mark on the text stamp, no mark on the structured stamp, and
`"any"` offered again in the no-`tree` refusal.

**Limits:**
- **It trusts what the caller names.** A session that names the lane's checkout while meaning its
  branch is still answered by the lane. This moves the comparison to the one place both facts are
  known; it cannot make the caller right.
- **Not yet seen live.** A proxy change reaches a session only after `npm run lane` copies it and
  that session's MCP connection restarts, and no session has it yet. The refusal returns as an error
  result with text, the path the no-lane sentence already takes.
- **A stale build is a different hazard:** the right checkout with `npm run build` not run is not
  this card's.
