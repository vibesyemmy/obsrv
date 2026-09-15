---
title: "Fixing the stale echo is a decision about what `issued` means"
column: doing
kind: bug
owner: "Rook"
order: 38
---

ASSIGNED TO ROOK 2026-09-15 on Opeyemi's word. Owner set here so claiming costs no pull request.

**THE HISTORY THE CARD SAID TO GET IN FRONT OF YOU, now actually read rather than named.** The incident is `88635ed`, *"the loop breaker's bounce is a state, and every issued URL is an echo"*, 2026-09-03. Its own words:

> The bus remembers every URL it sent into a pane, not the latest. With two mirrored loads in flight into one pane the superseded one still commits, and a single "next expected URL" read that commit as a new document and reset the count: **252 loads** once the arm alone was in place. Any issued URL's commit is now an echo (not news, not a mirror, not a reset); an echo retires what was sent before it, a new document retires everything, entries older than 10 s are forgotten.

**So the current design exists precisely because a SUPERSEDED LOAD'S COMMIT could not be told from a NEW DOCUMENT.** Remembering every issued URL rather than the latest is the fix for that, and it is what today's fault abuses: a record that should have been retired by its own echo survives, and the next genuine load of the same URL looks exactly like that echo.

**THAT HISTORY RANKS THE THREE CANDIDATES, and it rules one of them out on the record rather than on taste:**

- *Retire on any new document rather than only on an echo* — read `88635ed` before costing this. **A new document already retires everything.** Whatever this candidate means, it is not that, and if it means loosening what counts as a new document it is walking straight back into the 252-load loop, which is the exact confusion that commit was written to end.
- *Bound the record's age below a test file's length* — the 10 s was chosen deliberately in that commit ("entries older than 10 s are forgotten"). Shortening it is choosing a smaller number for a reason, and the reason has to be better than "a test file runs in 3 s", because production is not a test file.
- **Make the record identify the LOAD rather than the URL** — this is the one the history argues for. The 252-load loop happened because the bus could not distinguish a superseded load's commit from a new document; identifying the load is exactly the distinction that was missing then and is missing now. It is the only candidate that makes the echo test *more* precise rather than less, so it does not trade a stale expectation for a weaker loop guard.

That is a reading of the history, not an instruction. If the load-identity candidate turns out to cost more than it looks, the ranking is wrong and the reasoning above is what to argue with.

**A STALE COMMENT IN THE FILE YOU ARE ABOUT TO EDIT.** `src/main/syncBus.ts`, in the `loopState()` doc block, says:

> `sync.spec.ts:165` fails on CI in five of ten red runs and **has never reproduced on this desk**, which is a difference nobody could measure.

It has now reproduced on this desk — 4 in 113, Rook's own measurement, in the work that landed that very comment. True when written hours ago and false when merged. Worth fixing in passing, and worth noticing as the thing this project keeps finding: a sentence that was accurate and quietly stopped being so, sitting in the code rather than in a doc.

Split out of `flake-sync-165` at Rook's insistence, and the insistence is right: this is a decision with a cost attached, not a tidy-up to append to the card that found it.

**The fault**, diagnosed and reproduced — see `flake-sync-165` and `docs/research/2026-09-15-sync-165-stale-echo.md`. A client-side redirect leaves a record in `issued[pane]` that is normally retired by its own echo. When that echo does not arrive, `ISSUED_MAX_AGE_MS` (10 s) will not prune it inside a 3 s test file, and the NEXT genuine load of the same URL is read as an echo. `mirror()` returns before comparing anything. About 4% of runs.

**Three candidates, all of which change what "echo" means for a superseded load:**

- **Retire on any new document**, not only on an echo.
- **Bound the record's age below a test file's length** — which is choosing a number, and the current number was presumably chosen for a reason nobody has written down.
- **Make the record identify the load rather than the URL**, so a second genuine load of the same address is distinguishable from the first one coming back.

**WHY THIS NEEDS A DECISION AND NOT A PATCH.** The `issued` map exists to stop the panes chasing each other. Loosening what counts as an echo is loosening the thing that prevents the loop — and the cost of getting that wrong is on the record: **the 252-load loop of 2026-09-03**. Whoever takes this should have that incident in front of them before choosing, because each candidate trades a stale expectation for a weaker loop guard, and the third is the only one that plausibly does not.

**The instrument already exists**, which is most of the work: `mirrorTrace()` and `sync-trace.spec.ts` land with `flake-sync-165` and will say which branch any candidate takes. Whoever fixes this can watch the fix change the branch rather than inferring it from a green suite.

**And the same discipline applies to the fix as to the trace:** four of the five mirror branches can be forced deliberately and `pane-destroyed` cannot — the spec says so in those words. Absence of `pane-destroyed` in a trace means nothing; absence of the other four means they did not happen.
