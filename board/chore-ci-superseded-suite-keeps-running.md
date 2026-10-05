---
title: "a superseded pull-request suite keeps running to the end, because `always()` on the test job outlives the concurrency cancel"
column: backlog
kind: chore
release: later
waiting: "Henry: go or no-go on the ci.yml:176 change"
order: 128
---

RAISED 2026-10-05 as a record of what was measured and what was not; **nothing here is fixed or chosen**, and `.github/workflows/ci.yml` on
`main` has not been touched. The candidate was Wren's; Dogu measured it (`#3530`, `#3543`) and saw the current behaviour once more on a real
pull request (`#3690`). Whether to change the line is Henry's and Opeyemi's call, since it changes what the required check shows for a
superseded head.

## What was measured

`ci.yml` gives a pull-request run `group: <workflow>-<ref>` with `cancel-in-progress: true`, and its own comment says "Branches keep sharing a
group and cancelling, which is what you want there." The `test` job (the macOS suite) carries `if: ${{ always() && !startsWith(github.ref, 'refs/tags/v') }}`
(`ci.yml:176`). **Measured with that line, a second run on the same ref does not cancel the first run's suite job.**

All on `workflow_dispatch` to throwaway branch refs, **one pair per variant, not a real pull request** (the concurrency group is built from
`github.ref` either way, so the same behaviour is expected; not tested):

| variant of `ci.yml:176` | what happened | runs |
|---|---|---|
| `always() && !startsWith(…)` (as on `main`) | second run stayed `pending` with no jobs; the first run's suite job stayed `in_progress` through every sample for about 8 minutes (30 samples); a plain `gh run cancel` did not stop it either, only `force-cancel` did | `37303720760`, `37303797249` |
| `!cancelled() && !startsWith(…)` | the first run's suite job was `cancelled` 67 s after the second dispatch (second dispatch 11:44:49Z, job ended 11:45:56Z by the API; a poll first saw it at 11:46:09Z, which is where an earlier "about 80 s" came from); the second run went `queued`, then `in_progress` | `37304835711`, `37304912984` |

So the mechanism and its size are measured (never cancelled in 8 minutes against cancelled in 67 s). **A rate is not.**

**Seen again on a real pull request, by accident, 2026-10-05 (`#569`, event `pull_request`, current `always()`):** not a controlled
probe, so it is recorded as an observation. Run `37347660127` (head `b4595ce82`) was created 17:20:15Z and its suite job started
17:20:31Z. A push at 17:21:28Z created run `37347809597`, and a second push at 17:21:52Z created `37347858609`; **the middle run, still
`pending`, was cancelled at 17:21:53Z by the newer arrival, as `ci.yml`'s own comment says a pending run is, but the first run's
suite job, already `in_progress`, was not.** A plain `gh run cancel` on it at about 17:21:55Z left it `in_progress` after 80 s more;
`force-cancel` ended it at 17:23:36Z, and the newest run's suite job started at 17:23:56Z, 20 s later. So on a real pull request
too, a superseded in-progress suite kept running through two newer pushes and a plain cancel for at least 1 m 40 s and ended only
on `force-cancel`.

**Why `always()` is there, and whether the one-line change keeps it.** The comment at `ci.yml:169` to `:175` says a `scope` job that FAILED would skip the
`test` job, so the required check would never arrive and the pull request would be unmergeable. Idris asked (`#3532`, check 1) that this be shown to
hold under `!cancelled()`. Measured (`#3543`), `scope` forced to fail by an `exit 1` in its `decide` step, one `workflow_dispatch` per variant:

| variant | what the `test` job did | run |
|---|---|---|
| no status function (`if: !startsWith(github.ref, 'refs/tags/v')`), the control | `skipped` in 0 s | `37306363079` |
| `!cancelled() && !startsWith(…)` | started on a macOS runner and ran until cancelled by hand (my `gh run cancel` call was at 11:59:06Z, from my own terminal clock in `#3543` and not in the API, and the job ended 12:00:46Z, about 100 s later; the API's duration for the job is 126 s) | `37306369922` |
| `always() && !startsWith(…)` (as on `main`) | started the same way; a plain cancel did not end it within 2 minutes, `force-cancel` did | `37306373610` |

**What that does not say:** the macOS suites were cancelled after a few minutes, so what a forced-failed `scope` leaves in the suite's own result
was not seen, only that it starts; with `board_only` empty it falls to the full macOS run, as today.

## What it costs today

Wren's numbers from `#3481`, **not recounted for this card**: four pull-request heads lost 18 to 26 minutes each, and every superseded suite burned its
roughly 25 macOS minutes to the end while the newer run waited behind it.

## What the change would do to the tally, and it should be named rather than discovered

Idris, `#3532`, in Idris's words: two of the eight counted attempts at `arrivals.spec.ts:218` at that time (`37294297527`, `37297276819`) came from superseded
suites that ran to the end and were stamped `cancelled` afterwards. If superseded suites are cancelled in about 80 seconds [the figure is from the first probe's poll, `#3530`; the API's job times give 67 s], that supply disappears:
the natural rate of attempts drops by roughly a quarter (2 of 8; a small sample), so N would be reached more slowly, in exchange for four heads not losing 18 to
26 minutes each. Idris thinks that is the right trade; **the figures are Idris's, from `#3532`, and were not recounted here.** At `#3556` the tally was ten, two of
which Idris lists as superseded suites; at `#3731` it was sixteen attempts, and that message does not say how many of the six newer ones were superseded suites. **Later the same evening `#3756` withdrew N and stopped the tally being a gate** (acceptance (d) was found to be measuring the machine), so the cost named here, N being reached more slowly, mostly goes away; the tally was 18 attempts (17 first-try passes, 1 first-try failure) at `#3778`.

**Seen a third time, on `#574`'s run, 2026-10-05 evening (Wren `#3770`; checked against the API by Dogu):** run `37366445200` (head `bda4f3310`) was
created 19:54:47Z and **had no jobs until 20:10:49Z, 16 minutes later, one second after the previous head's run `37363954066` ended its suite job**
(20:10:48Z); that older suite was not cancelled by the newer push, as above. That is a real `ci.yml:176` effect. **What it is not:** the same run's
`failure` stamp. Its `What this change touches` job ran 20:10:49Z to 20:25:52Z, exactly 903 s, with no runner: GitHub's own Actions incident (runner
assignment delays, open from 19:11:58Z), not this mechanism. Five small ubuntu jobs ended that way between 19:18Z and 20:10Z. **A cancelled `scope`
makes `test` run the full macOS suite** (here 20:26:03Z to 20:50:05Z for a two-card change), which is the existing design, "unknown scope means run
everything". **A passing suite inside a run stamped `failure`, and `gh run view --log` returning zero bytes for that run (Henry, `#3775`), are
separate traps from this card's subject.**

## What is not measured

- **What the required check shows on the SUPERSEDED head under `!cancelled()`** (it would read `cancelled`, and whether that blocks or confuses a merge
  is not known). The current behaviour on a real pull request was seen incidentally (above); the proposed one was not, and a controlled test is two pushes a
  minute apart on a draft with the one-line change. Idris, `#3532`, check 2.
- **What `!cancelled()` does when `scope` is cancelled by the runner-queue timeout rather than failing.** Not measured; the proposed line has only been tried
  with `scope` failing (`#3543`). With `always()`, as today, a cancelled `scope` falls through to a full macOS run.
- **`main`.** `cancel-in-progress` is `false` there and the group carries the sha, so nothing supersedes a `main` run; the comment at `ci.yml:44` to
  `:47` explains why a cancelled `main` run is "a commit with NO CI answer". The change should leave `main` alone, and that has not been shown: it needs one
  real `main` push suite and one hand-cancelled one (Idris, check 3).

## Options, none chosen

1. **Leave it.** Cost: the figures in "What it costs today", on every pull request pushed to twice in one suite's time.
2. **`!cancelled() && !startsWith(…)`** at `ci.yml:176`, with the comment at `:169` to `:175` rewritten (it describes `always()`). Its own pull request, gated by Idris;
   the two unmeasured checks above before it merges. Cost: the attempt supply above, and a `cancelled` required check on superseded heads.

The decision is Henry's and Opeyemi's: it changes what the required check shows for a superseded head.
