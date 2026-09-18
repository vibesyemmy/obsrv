---
title: "Automate the CI hidden-failure sweep — currently a manual grep run by hand every ~20 minutes"
column: done
owner: "Dogu"
kind: chore
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

## Doing 2026-09-18: `scripts/ci-flake-check.js` built, measured against real runs

**Claimed, per rule 2**, own worktree, `feat/ci-flake-check`.

**A fourth mistake found while building this, not assumed:** `gh run view --log` interleaves
every step of a job under one prefix, tab-separated by job and step name. Vitest's own summary
— `Test Files 1 failed | 96 passed` and `Tests 2 failed | 1393 passed` — matches the exact
`<n> failed`/`<n> passed` shape Playwright's list reporter uses. **Verified directly against run
`35285273313`**: a flat grep across the whole job log picks up two of five "N failed/passed"
hits from the "Unit tests" step, not e2e. So the script never greps the raw log — it parses
`gh`'s job/step-tab-prefixed lines, keeps only the `E2E (Playwright driving the Electron app)`
step's own lines, and only then reads the summary. This is the same class of error as the
`grep -c '✘'`/`grep -c` mistakes above: a command that runs, returns a number, and is wrong.

**Evidence, each read from the real run rather than assumed:**
- `35286751102` (e2e ran clean-ish): script reports `failed=0 flaky=2 passed=613 skipped=0` —
  matches the raw log's own `2 flaky` / `613 passed (20.4m)` lines exactly.
- `35285273313` (Unit tests step failed, job stopped before e2e ran): script reports "e2e step
  did not run" rather than a false `0 failed` — the run's overall `conclusion` is `failure`, and
  a naive per-test-only reading could otherwise print all-zero counts and look clean.
- `35294477296` (board-only path, e2e step skipped by `needs.scope.outputs.board_only`): same
  "did not run" report, same reasoning — column-only board PRs should never appear to pass an
  e2e check they never ran.
- `35290248624`: `failed=0 flaky=0 passed=615 skipped=0` — a genuinely clean run reads as one.
- `--recent 3` swept the three runs above in one call — this is the piece that replaces Wren's
  repeated by-hand checks.

**Item 2 (per-attempt recurrence), `--all-attempts`: implemented, not yet observed.** Built
against `gh run view`'s documented `--attempt` flag and the run's own `attempt` json field, and
it runs without error on every single-attempt run tested above (`attempt 1` only, as expected).
**No run with `attempt > 1` existed in this repo's recent history to test the actual case
against** — a manually re-run workflow. Saying so here rather than claiming it's proven: the
single-attempt path is measured, the multi-attempt path is reasoned from `gh`'s own docs.

**Item 3, both lessons applied, per the evidence above**: the whole-run-no-signal case
(`35285273313`, `35294477296`) is surfaced as a warning rather than silently reading as
all-zero-clean; nothing here reduces to a fixed list of test names, so a test absent from
anyone's list (the `devtools.spec.ts:116` shape) isn't a blind spot the way a hardcoded list
would be.

**Not done, and staying out of this PR:** wiring this into `ci.yml` itself as a workflow step —
this PR is the script plus its own evidence, callable by hand (`node scripts/ci-flake-check.js
--recent 20`); whether and how it becomes part of the required check is a separate decision, not
mine to make unilaterally on a script's first day.

No unit test written — the thing under test is `gh`'s own CLI output shape, which nothing in
this repo's test harness invokes; the evidence above is against real run IDs instead, in the
tradition of how `bug-flakes-gate-the-gate` itself was verified.

## CORRECTED, same day, before review: the "verified against 35285273313" claim above overstated what step-scoping does, and step-scoping alone is not reliable

Found by dogfooding the script against its own PR's CI run (`35295017371`) rather than assumed
clean because the first four runs checked out.

**First: the `35285273313` evidence above is right in conclusion, wrong about the mechanism.**
Re-ran the anchored-regex scan (`^(\d+)\s+(failed|flaky|...)`) over that run's **entire** job
log, with no step filter at all: still zero hits. The anchor — a match has to start the
(trimmed) line — is what keeps Vitest's `Test Files 1 failed | 96 passed` out; both of its lines
start with a word and ANSI color codes, never a bare digit. Step-scoping was true but not
load-bearing for that case, and the card stated it as though it were.

**Second, and this one shipped in the PR before being caught:** step-scoping alone is not safe
to depend on. `gh run view --log`'s own `--help` warns it can fall back to a slower per-job log
fetch and mark lines `UNKNOWN STEP` when it can't associate them with a step — measured on
`35295017371` itself: e2e ran 22 minutes and passed, and **every line in the run** came back
`UNKNOWN STEP`. The step-only version of `e2eSummary` read that as "e2e step did not run" for a
run that plainly had — the exact silent-clean failure mode this card's item 3 exists to prevent,
reproduced by the tool meant to prevent it.

**Fixed:** `e2eSummary` now prefers step-scoped lines when `gh` actually attributed any to the
e2e step by name; when none were, it checks whether any line in the run reads `UNKNOWN STEP` at
all — if so, attribution degraded for this run rather than the step genuinely not running, and
the whole job's lines are scanned instead (safe, per the anchor above). Re-verified against all
five runs, including the one this broke:

| run | before the fix | after the fix |
|---|---|---|
| `35295017371` (own PR, e2e ran 22m, `UNKNOWN STEP` throughout) | `e2e step did not run` — wrong | `failed=0 flaky=1 passed=614` — cross-checked against the raw `1 flaky` / `614 passed (21.3m)` lines directly |
| `35286751102`, `35290248624`, `35285273313`, `35294477296` | as recorded above | unchanged, re-run to confirm |

Left in the same commit rather than quietly folded in, so the correction is visible next to the
overclaim it corrects.

## DONE 2026-09-19, with one residual named rather than hidden

**Item 1** (the script) and **item 3** (apply both lessons — whole-run-no-signal, don't reduce to a
fixed test list) are shipped and merged: `#339`/`f124c83`, the UNKNOWN-STEP fix `#346`/`f124c83`,
the tally-vs-conclusion mismatch `#353`/`e3b0280` — the last one found by @Wren reading a real run
(room #597), not by anything this script's own logic caught first.

**Item 2, `--all-attempts`, ships built but not fully proven.** It runs against `gh`'s documented
`--attempt` flag and has not thrown on any single-attempt run tested. No run with `attempt > 1` has
existed in this repo since it was built to test the actual multi-attempt path for real. That is a
narrow, stated limitation, not a silent one — closer to `bug-ipc-native-pane-invisible-once`'s
"recurrence-waiter" shape than to unfinished work, and closing this card rather than leaving it in
Doing waiting on an attempt count nobody controls.

**Items 4 and 5 stayed out of scope, as written**: `retries: 1` is a policy question left to Henry
and Opeyemi; A1 stayed Rook's.

Moved out of Doing because Opeyemi asked what was still sitting there and this had been done for a
day without the column reflecting it — same gap as `bug-raster-coverage-counts-transparent-rows`,
caught the same way.
