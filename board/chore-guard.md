---
title: "A suite that measured nothing must be as loud as two suites at once"
column: backlog
kind: chore
order: 25
---

SCOPE WIDENED 2026-09-14 on obsrv-91's argument, which is right: this card and the evidence-assertion are two halves of one thing, and building them apart gets one of them wrong.

HALF ONE — refuse to start a suite while another is running. Two concurrent suites in one worktree made both greens untrustworthy and cost a full afternoon.

THE HARD PART, and the reason a naive lock file is worse than nothing: the guard must distinguish ANOTHER SUITE RUNNING from A STALE LOCK LEFT BY A SUITE THAT DIED. Those are identical from a lock file alone. A guard that refuses on a stale lock gets its lock deleted by the first person who hits it, and then nobody trusts it again. Whatever it checks — a pid, a port, a live process — the refusal text must SAY WHICH OF THE TWO IT FOUND.

HALF TWO — a suite that passed having measured nothing is indistinguishable from one that passed having checked everything. obsrv-a6 hit this with a -g filtered run; Henry hit the same shape verifying the surface-parity staleness check, which passed green on a planted stale row because filtering had starved the rows it compares. The fix there was a vacuity guard (surface-parity.spec.ts:368) that fails when the comparison had no evidence. Generalise it.

Kenya's find is the third instance in one day and belongs in the same fix: live-drive.spec sets `info` (control port and token) in the FIRST test of the file, so any -g filtered single-test run of it dies on `Cannot read properties of undefined (reading 'token')` — which reads like a bug in whatever test you just wrote.

So: a concurrent suite, a stale lock, and a run that asserted nothing are three ways to get a green that means nothing, and the guard should name which one it is looking at in all three cases.
