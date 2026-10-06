---
title: "the suite job's 30-minute cap has a thin margin on a slow runner, and one attempt in the last two days crossed it"
column: doing
kind: chore
release: later
owner: "Dogu"
waiting: ""
order: 127
---

FOUND 2026-10-05, as a question by Wren (`#3467`, item 4: "is there a card for the cap's margin?"), measured by Dogu. There was no card:
the board text I found about the cap is `bug-no-traces-when-e2e-hangs` and `bug-trace-upload-errors-when-e2e-never-ran` (what happens to a
run that outlasts it) and one mention in `bug-selector-click-over-scrolls-under-text-scale`; none is about its margin. **Nothing here is fixed or chosen**; this card records what was measured and
leaves the decision to the people who own CI's cost.

## What happened

`#561`'s CI run `37294469890`, attempt 1 (head `9d95308`): the suite job ran 10:31:00Z to 11:01:20Z (30 m 20 s) and was
`cancelled` at `timeout-minutes: 30` (`.github/workflows/ci.yml`, the `test` job). The log ends `##[error]The operation was canceled.`;
unit (130 files) and shader (10 files) had passed, there was no `✘`, and the e2e step was at test 651 of about 662. **It counts as no
result** (`#3444`, restated in `#3468`: a job killed at the cap counts as nothing), and says nothing about `#561`. It was re-run as attempt 2.

## What the recent window says

Dogu's own listing at about 11:15Z on 2026-10-05: of the 150 most recent `ci.yml` runs, the **61 completed runs created since the
`#540` merge** (2026-10-03T22:35Z), read per attempt. **36 of the 61 suite jobs were the macOS job** (the other 25 were board-only
runs on ubuntu, 2 to 6 seconds). Minutes for the 36: **minimum 21.3, median 24.4, mean 24.5, maximum 27.8.** By band: none under 20;
2 at 20 to 22; 6 at 22 to 24; 22 at 24 to 26; 6 at 26 to 28; none above 28. Conclusions: 34 `success`, 2 `failure` (`37190742650`
and `37160406685` attempt 1; their causes were not read for this card). The slowest finished job, `37290561363` at 27.8 minutes, was
2.2 minutes under the cap. **That listing excludes `#561`'s attempt 1**: its run was still in progress (as attempt 2) when it was
read. Counting it, **1 of 37 macOS suite jobs reached the cap** in the window.

The e2e step itself, in the suites Dogu counted from the raw logs today: **19.9 minutes** (`37194381795`, 659 tests), 20.1 (`37297104172`,
661), 22.4 (`37278055730`, 660), 22.6 (`37290395143`, 661), 23.7 (`37197856918`, 659) and **25.7 minutes for 658 tests on `37290561363`**, the
slowest finished job above. (The first version of this card gave `37197856918` as 19.9; that was the wrong run for that number. Wren's pull
of the same logs caught it, `#3481`.) The comment above the e2e step in `ci.yml`
still says e2e takes "≈17" minutes on a green main, with "≈12 spare"; **that is not what these logs show.**

**Added the same day, after the listing above was written** (Idris, `#3538`, from Idris's own pull; Dogu counted the same log, `#3537`): `#561`'s
attempt 2 (run `37294469890`, suite job `111731312723`) ran 11:02:20Z to 11:30:15Z, **27 m 55 s, `success`, 2 m 05 s under the cap**, and
its e2e step took **26.1 minutes for 661 tests**. That is now the slowest finished suite job and the slowest e2e step this card holds; the 27.8
and the 25.7 above are second place. **The rate above ("1 in 37") does not show the margin:** three suite jobs that started between 09:31Z
and 11:02Z on 2026-10-05 ran 27 m 46 s (`37290561363`), over the cap (`#561` attempt 1) and 27 m 55 s (`#561` attempt 2). The window listing was
**not re-run** for this addition, so its minimum, median, mean, maximum and the 36 and 61 counts are as first written; the e2e range is now 19.9
to 26.1. The cause of the slow runs is still unknown (see below).

**Added later the same day** (Dogu, from the raw log of run `37319268852`, `#3642`; Idris counted it too, `#3643`): `#567`'s final-head
run, suite job `111793913543`, 13:45:42Z to 14:13:00Z, ran **27 m 18 s, `success`, 2 m 42 s under the cap**, with an e2e step of 25.7 minutes
for 661 tests (one unrelated flaky). That is a third *finished* suite job within 2 m 42 s of the cap on 2026-10-05, besides the one that
crossed it (27 m 46 s, 27 m 55 s, 27 m 18 s). The window listing was **not re-run** for this either, and runs after 14:13Z that day are not
counted here.

**Added the evening of 2026-10-05, on `main`** (Idris counted it, `#3740`; Dogu re-read the job from the API and the log, `#3742`, and Wren from the API, `#3741`):
the push suite for `#568`'s merge, run `37355564026` at `ec3beafe9e7b1ed148047a72f723211b510cd638`, suite job `111917026851`, 18:23:47Z to
18:53:41Z, ran **29 m 54 s, `success`, 6 s under the nominal cap**, with the longest e2e step counted so far, **27.6 minutes** (659 passed, 1
flaky, 1 skipped). The flaky was `throttle-live.spec.ts:82`, a `"beforeAll" hook timeout of 30000ms exceeded.`, with the harness's slow-close
line (10 s) directly before it, about 43 s of the job with the three retries it re-ran (Idris's corrected figure, `#3743`; Idris's first estimate was 45 s, withdrawn there), so the 4 m 20 s spread below is still almost entirely unexplained by it. Its sibling on `main`, `37355574685`
(`#569`'s merge), started 3 s later on a tree that differs only in docs and ran **25 m 34 s**: a measured 4 m 20 s spread between concurrent,
nearly identical jobs, which does not by itself say the runner caused it. On `main` `cancel-in-progress` is `false` and a cancelled run is "a
commit with NO CI answer" (`ci.yml`'s own words), which is where a kill costs most.

**The cap is enforced late, so "N seconds under" is not "N seconds from a kill" in either direction.** Two samples, on different runners, so not
a distribution: a throwaway probe (`#3746`, run `37359806990`, ubuntu, `push` event, a different workflow from `ci.yml`) gave a job
`timeout-minutes` of 1, and its step started 18:57:04Z and was cancelled at 18:58:32Z, **88 s later (28 s over)**; and the one macOS case,
`#561`'s attempt 1, ended at **30 m 20 s on the 30-minute cap (20 s over)**. **The same probe showed `timeout-minutes` accepts an expression
and evaluates it both ways** (`${{ github.ref == '...' && 1 || 3 }}` gave a 1-minute cap where the condition held; where it did not, the job ran its 100 s sleep and was not cut at 60 s,
which shows it was not capped at one minute and not that its cap was three), at that strength: one run, `push` not `pull_request`.

## What is known about earlier cap hits, and what is not

- `bug-no-traces-when-e2e-hangs`: as of its 2026-09-16 sweep of 607 runs, one job (control 4) had hit the limit.
- `bug-selector-click-over-scrolls-under-text-scale`: attempt 1 of run `37123672372` was cancelled at the cap (that card's text).
- The attempt above. **That makes at least three; the history was not recounted for this card.**

**Not known:** why the slow runs are slow (the e2e minutes vary by up to six (19.9 to 25.7, and 26.1 since the addition above) between suites of near-identical size, which points at the runner,
but that is a reading, not a measurement); whether cap hits cluster on slow runners; how long a hung run holds a runner today.

## Decided 2026-10-06: the suite job's cap goes to 50 minutes (Henry, `#3807`)

**Henry chose 50, neither 40 nor 45,** on this card's own table: at 45 the margin for one 900 s hang at the slowest e2e step is 6 seconds, and a cap whose worst-case
margin is six seconds is the defect being fixed one size up. The asymmetry Henry gave: a genuinely hung job at 50 costs five minutes more than at 45, and a cap that clips a
legitimate run costs a full re-run and a false red someone has to diagnose. **The table, so nobody has to trust the number** (spare minutes for one 15-minute hang, with
setup 1.87 at the median and 2.27 at the maximum, from `#3795`):

| cap | spare at e2e median 22.6 | after a 900 s hang | spare at e2e maximum 27.6 | after a 900 s hang |
| --- | --- | --- | --- | --- |
| 30 | 5.5 | does not fit | 0.1 | does not fit |
| 40 | 15.5 | 0.5 | 10.1 | does not fit |
| 45 | 20.5 | 5.5 | 15.1 | 0.1 (6 s) |
| **50** | **25.5** | **10.5** | **20.1** | **5.1** |

The change is the `test` job's `timeout-minutes` only (the release job keeps its 30), with the stale "≈17 / ≈12 spare" comment above the traces step rewritten. The cap is
enforced 20 to 30 s late (the probe in `#3746`, `#561` attempt 1), which this table does not include. **Not measured:** what a 50-minute cap does to a real hang; the table is
reasoned from `ci.yml`'s comment and the logs. A main-only variant (`github.ref == 'refs/heads/main' && 45 || 30`) is not what was chosen.

## Options, with the costs that are known, none chosen

1. **Raise `timeout-minutes`** (one line). Cost: a hung job holds a macOS runner longer, and `bug-no-traces-when-e2e-hangs` records that
   a job that outlasts the cap uploads no traces, so a longer cap lets a hang with no finite timeout hold the runner longer. **A correction to the traces half of that sentence** (Dogu, `#3761`): `ci.yml`'s own comment above
   the traces step says a hang that ends as a test failure still uploads, and that only a run that outlasts the job's cap does not; every spec has a finite timeout (the
   longest is `surface-parity.spec.ts`'s 900 s), so **a longer cap turns a cancelled run with no traces into a failed one with traces**. That comment sized the cap
   for one 900 s hang ("e2e ≈17 of 30 minutes, ≈12 spare"); at today's numbers the spare is about 5.5 minutes at the e2e median (22.6) and about 0.1 at its maximum (27.6),
   so one hang no longer fits at either. **The job overhead in that sum is Idris's figure, not mine** (`#3795`): job minutes minus the e2e step's minutes over 11 recent suite jobs, **minimum
   1.52, median 1.87, maximum 2.27 minutes**, and the run with the 27.6-minute e2e step (`37355564026`) is the one with 2.27, which leaves 30 − 27.6 − 2.27 ≈ 0.1 minute: exactly the 6 seconds that
   run had. (My first version used 1.4 minutes, taken from one run's steps before the e2e step and leaving out the rest of the job; no job measured is that low.) **With those inputs
   (a 15-minute hang): cap 30 leaves about 5.5 at the median and 0.1 at the maximum; cap 40, 15.5 and 10.1; cap 45, 20.5 and 15.1.** So 40 fits one 900 s hang at the median only, and **45 fits it at the slowest
   e2e step seen by 6 seconds, not by minutes** (the job that set that maximum ran 1,794 s; a 45-minute cap is 2,700 s, so 906 s are spare against a 900 s hang); **50 leaves 25.5 at the median and 20.1 at the
   maximum for one hang, so 10.5 and 5.1 minutes remain after it.** The 900 s is real (`surface-parity.spec.ts:44`,
   `timeout: 900_000`, the only timeout of 600 s or more in `tests/e2e`). Reasoned from the comment and the logs, not measured; the choice is Henry's.
   **A variant the probe makes possible, not tested on `ci.yml` and not proposed for merge:** `timeout-minutes: ${{ github.ref == 'refs/heads/main' && 45 || 30 }}`,
   so pull-request jobs keep the cap they have and the cost above lands only on `main`, where a kill hurts most. A pull request's `github.ref` is
   `refs/pull/N/merge`, which would read as the second value; that is inference, not a measurement.
2. **Split the e2e step across two macOS jobs.** Wall-clock goes down; runner minutes and queue pressure go up (**not measured here**: the card's first version said a PR run
   sat about 16 minutes in the queue on 2026-10-05, and that was wrong twice over: the run was `37212962898` on **2026-10-04** (`#557`; Idris, `#3482`), and the wait was not a runner queue; Wren's read of the same day's jobs, `#3481`, found every macOS
   suite job starting 0.1 to 0.2 minutes after its scope job, so there was no runner queue, and the long waits were whole-run waits
   behind a PR's previous suite, a different mechanism the card does not cover).
3. **Leave it.** Roughly 1 in 37 here (and the addition above says the rate understates how close the others run); the cost of a hit is one re-run (about 25 minutes) **plus the 30 minutes the capped attempt already spent**, about 55 minutes of one PR's wall-clock in `#561`'s case (Wren, `#3481`; Idris agreed, `#3482`), and the gates already treat a cap hit as no result.

The decision is Henry's and Opeyemi's: it trades CI cost against a rare re-run, and this card does not weigh it.
