---
title: "a superseded pull-request suite keeps running to the end, because `always()` on the test job outlives the concurrency cancel"
column: backlog
kind: chore
release: later
order: 128
---

DRAFT 2026-10-05, not yet raised. Written so it can go up the moment Henry and Opeyemi say whether the change is wanted; **nothing here is
fixed or chosen**, and `.github/workflows/ci.yml` on `main` has not been touched. The candidate was Wren's; Dogu measured it (`#3530`,
`#3543`).

## What was measured

`ci.yml` gives a pull-request run `group: <workflow>-<ref>` with `cancel-in-progress: true`, and its own comment says "Branches keep sharing a
group and cancelling, which is what you want there." The `test` job (the macOS suite) carries `if: ${{ always() && !startsWith(github.ref, 'refs/tags/v') }}`
(`ci.yml:176`). **Measured with that line, a second run on the same ref does not cancel the first run's suite job.**

All on `workflow_dispatch` to throwaway branch refs, **one pair per variant, not a real pull request** (the concurrency group is built from
`github.ref` either way, so the same behaviour is expected; not tested):

| variant of `ci.yml:176` | what happened | runs |
|---|---|---|
| `always() && !startsWith(…)` (as on `main`) | second run stayed `pending` with no jobs; the first run's suite job stayed `in_progress` through every sample for about 8 minutes (30 samples); a plain `gh run cancel` did not stop it either, only `force-cancel` did | `37303720760`, `37303797249` |
| `!cancelled() && !startsWith(…)` | the first run's suite job was `cancelled` about 80 s after the second dispatch; the second run went `queued`, then `in_progress` | `37304835711`, `37304912984` |

So the mechanism and its size are measured (never cancelled in 8 minutes against cancelled in about 80 s). **A rate is not.**

**Why `always()` is there, and whether the one-line change keeps it.** The comment at `ci.yml:169` to `:175` says a `scope` job that FAILED would skip the
`test` job, so the required check would never arrive and the pull request would be unmergeable. Idris asked (`#3532`, check 1) that this be shown to
hold under `!cancelled()`. Measured (`#3543`), `scope` forced to fail by an `exit 1` in its `decide` step, one `workflow_dispatch` per variant:

| variant | what the `test` job did | run |
|---|---|---|
| no status function (`if: !startsWith(github.ref, 'refs/tags/v')`), the control | `skipped` in 0 s | `37306363079` |
| `!cancelled() && !startsWith(…)` | started on a macOS runner and ran until cancelled by hand (about 100 s after the request) | `37306369922` |
| `always() && !startsWith(…)` (as on `main`) | started the same way; a plain cancel did not end it within 2 minutes, `force-cancel` did | `37306373610` |

**What that does not say:** the macOS suites were cancelled after a few minutes, so what a forced-failed `scope` leaves in the suite's own result
was not seen, only that it starts; with `board_only` empty it falls to the full macOS run, as today.

## What it costs today

Wren's numbers from `#3481`, **not recounted for this card**: four pull-request heads lost 18 to 26 minutes each, and every superseded suite burned its
roughly 25 macOS minutes to the end while the newer run waited behind it.

## What the change would do to the tally, and it should be named rather than discovered

Idris, `#3532`, in his words: two of the eight counted attempts at `arrivals.spec.ts:218` at that time (`37294297527`, `37297276819`) came from superseded
suites that ran to the end and were stamped `cancelled` afterwards. If superseded suites are cancelled in about 80 seconds, that supply disappears:
the natural rate of attempts drops by roughly a quarter (2 of 8; a small sample), so N would be reached more slowly, in exchange for four heads not losing 18 to
26 minutes each. Idris thinks that is the right trade; **the figures are his, from `#3532`, and were not recounted here.** At `#3556` the tally was ten, two of
which he lists as superseded suites.

## What is not measured

- **A real pull request, two pushes a minute apart on a draft, and what the required check shows on the SUPERSEDED head** (it would read `cancelled`, and
  whether that blocks or confuses a merge is not known). Idris, `#3532`, check 2.
- **`main`.** `cancel-in-progress` is `false` there and the group carries the sha, so nothing supersedes a `main` run; the comment at `ci.yml:44` to
  `:47` explains why a cancelled `main` run is "a commit with NO CI answer". The change should leave `main` alone, and that has not been shown: it needs one
  real `main` push suite and one hand-cancelled one (Idris, check 3).

## Options, none chosen

1. **Leave it.** Cost: the figures in "What it costs today", on every pull request pushed to twice in one suite's time.
2. **`!cancelled() && !startsWith(…)`** at `ci.yml:176`, with the comment at `:169` to `:175` rewritten (it describes `always()`). Its own pull request, gated by Idris;
   the two unmeasured checks above before it merges. Cost: the attempt supply above, and a `cancelled` required check on superseded heads.

The decision is Henry's and Opeyemi's: it changes what the required check shows for a superseded head.
