---
title: "Fixing the stale echo is a decision about what `issued` means"
column: next
kind: bug
order: 38
---

Split out of `flake-sync-165` at Rook's insistence, and the insistence is right: this is a decision with a cost attached, not a tidy-up to append to the card that found it.

**The fault**, diagnosed and reproduced — see `flake-sync-165` and `docs/research/2026-09-15-sync-165-stale-echo.md`. A client-side redirect leaves a record in `issued[pane]` that is normally retired by its own echo. When that echo does not arrive, `ISSUED_MAX_AGE_MS` (10 s) will not prune it inside a 3 s test file, and the NEXT genuine load of the same URL is read as an echo. `mirror()` returns before comparing anything. About 4% of runs.

**Three candidates, all of which change what "echo" means for a superseded load:**

- **Retire on any new document**, not only on an echo.
- **Bound the record's age below a test file's length** — which is choosing a number, and the current number was presumably chosen for a reason nobody has written down.
- **Make the record identify the load rather than the URL**, so a second genuine load of the same address is distinguishable from the first one coming back.

**WHY THIS NEEDS A DECISION AND NOT A PATCH.** The `issued` map exists to stop the panes chasing each other. Loosening what counts as an echo is loosening the thing that prevents the loop — and the cost of getting that wrong is on the record: **the 252-load loop of 2026-09-03**. Whoever takes this should have that incident in front of them before choosing, because each candidate trades a stale expectation for a weaker loop guard, and the third is the only one that plausibly does not.

**The instrument already exists**, which is most of the work: `mirrorTrace()` and `sync-trace.spec.ts` land with `flake-sync-165` and will say which branch any candidate takes. Whoever fixes this can watch the fix change the branch rather than inferring it from a green suite.

**And the same discipline applies to the fix as to the trace:** four of the five mirror branches can be forced deliberately and `pane-destroyed` cannot — the spec says so in those words. Absence of `pane-destroyed` in a trace means nothing; absence of the other four means they did not happen.
