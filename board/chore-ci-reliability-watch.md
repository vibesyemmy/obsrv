---
title: "Automate the CI hidden-failure sweep — currently a manual grep run by hand every ~20 minutes"
column: next
kind: chore
owner: "Dogu"
order: 99
---

FILED 2026-09-18 by Dogu, joining as DevOps Engineer. Scoped in the room (`#540`-`#545`),
corrected there twice before landing here — both corrections kept below rather than
smoothed over, per this repo's own convention.

**What this replaces.** Wren has been running the hidden-failure watch by hand tonight: read
each run, look for its flaky count, report per the rule in the room. That's real and repeated
work with no tooling behind it — no script anywhere under `scripts/` mentions "flaky" (checked
directly, not assumed).

**The read command, corrected once already, in-room:** `grep -oE '[0-9]+ flaky' | tail -1` on
the run's own summary line. **Not** `grep -c '✘'` (absent under `--reporter=line`; only the
`list` reporter prints it) **and not** `grep -c` on the flaky line either — `-c` counts matching
*lines*, so a single summary line reading "3 flaky" reports as 1. Both wrong in the same
direction: undercounting a suite that already conceals failures behind `retries: 1`. (Henry,
`#543`.)

**Ground truth already on this board, read before scoping this:** `bug-flakes-gate-the-gate.md`
(done) is the deep prior investigation here and this card should be read as its sequel, not a
fresh start. Two lessons from it carry directly into the tool:
- **Per-test tallying is a floor, not a count** — it's blind to a run that fails outside any
  test (PR #18, worker teardown, zero test failures) and blind to a test that's absent from
  whoever's list (`devtools.spec.ts:116` went uncounted for a full day beside `:92`, same file,
  same failure shape). A tool built on "grep the test names I know about" reproduces this.
- **A watch has to report the size of what it's looking at, not just that it's alive.** The
  card's own heartbeat bug — `gh run list --commit <short-sha>` returning zero rows forever,
  looking alive while watching nothing — is the shape any automated watch here can fall into.
  `rows=N` on every heartbeat, not just "still watching."

**Scope for whoever builds this (me, once claimed and picked up):**
1. A script, callable by hand or from a workflow step, that takes a run id and reports
   pass/flaky/fail by reading the run's own summary line the corrected way above.
2. Per-attempt recurrence: a run's `conclusion` is its latest attempt only, so this needs the
   per-attempt log (`.../actions/runs/<id>/attempts/1/logs`, per `#22`/this history), not just
   the final conclusion — `chore-flaky-leaders-0917` (done) found four tests failing their first
   attempt repeatedly this way, invisible to `conclusion` alone.
3. Apply both lessons above: don't reduce to a per-test list; surface a whole-run failure with
   no matching test line, and don't let an empty/short-SHA query read as "clean."
4. Explicitly out of scope, and not decided here: whether `retries: 1` itself should change.
   `bug-flakes-gate-the-gate` argued both directions on this at length and left it to whoever
   takes it with Henry and Opeyemi — a policy question, not a tooling one.
5. Also out of scope: A1 (signing/notarization — Rook's, though Henry offered the CI-secret-
   wiring half to me once the cert lands, to raise with Rook Saturday) and release/publish
   sequencing (`docs/release-gate.md`, already policy).

Not yet in Doing: scoped and filed, not started. Claiming and moving to Doing when I actually
begin the script, per rule 2.
