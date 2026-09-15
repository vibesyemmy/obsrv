---
title: "The dev lane says which tree it serves, and never says it is not yours"
column: next
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
