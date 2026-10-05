---
title: "the suite job's 30-minute cap has a thin margin on a slow runner, and one attempt in the last two days crossed it"
column: backlog
kind: chore
release: later
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

**Added the same day, after the listing above was written** (Idris, `#3538`, from his own pull; Dogu counted the same log, `#3537`): `#561`'s
attempt 2 (run `37294469890`, suite job `111731312723`) ran 11:02:20Z to 11:30:15Z, **27 m 55 s, `success`, 2 m 05 s under the cap**, and
its e2e step took **26.1 minutes for 661 tests**. That is now the slowest finished suite job and the slowest e2e step this card holds; the 27.8
and the 25.7 above are second place. **The rate above ("1 in 37") does not show the margin:** three suite jobs that started between 09:31Z
and 11:02Z on 2026-10-05 ran 27 m 46 s (`37290561363`), over the cap (`#561` attempt 1) and 27 m 55 s (`#561` attempt 2). The window listing was
**not re-run** for this addition, so its minimum, median, mean, maximum and the 36 and 61 counts are as first written; the e2e range is now 19.9
to 26.1. The cause of the slow runs is still unknown (see below).

## What is known about earlier cap hits, and what is not

- `bug-no-traces-when-e2e-hangs`: as of its 2026-09-16 sweep of 607 runs, one job (control 4) had hit the limit.
- `bug-selector-click-over-scrolls-under-text-scale`: attempt 1 of run `37123672372` was cancelled at the cap (that card's text).
- The attempt above. **That makes at least three; the history was not recounted for this card.**

**Not known:** why the slow runs are slow (the e2e minutes vary by up to six (19.9 to 25.7, and 26.1 since the addition above) between suites of near-identical size, which points at the runner,
but that is a reading, not a measurement); whether cap hits cluster on slow runners; how long a hung run holds a runner today.

## Options, with the costs that are known, none chosen

1. **Raise `timeout-minutes`** (one line). Cost: a hung job holds a macOS runner longer, and `bug-no-traces-when-e2e-hangs` records that
   a job that outlasts the cap uploads no traces, so the longer the cap, the longer the window where a hang leaves nothing to read.
2. **Split the e2e step across two macOS jobs.** Wall-clock goes down; runner minutes and queue pressure go up (**not measured here**: the card's first version said a PR run
   sat about 16 minutes in the queue on 2026-10-05, and that was wrong twice over: the run was `37212962898` on **2026-10-04** (`#557`; Idris, `#3482`), and the wait was not a runner queue; Wren's read of the same day's jobs, `#3481`, found every macOS
   suite job starting 0.1 to 0.2 minutes after its scope job, so there was no runner queue, and the long waits were whole-run waits
   behind a PR's previous suite, a different mechanism the card does not cover).
3. **Leave it.** Roughly 1 in 37 here (and the addition above says the rate understates how close the others run); the cost of a hit is one re-run (about 25 minutes) **plus the 30 minutes the capped attempt already spent**, about 55 minutes of one PR's wall-clock in `#561`'s case (Wren, `#3481`; Idris agreed, `#3482`), and the gates already treat a cap hit as no result.

The decision is Henry's and Opeyemi's: it trades CI cost against a rare re-run, and this card does not weigh it.
