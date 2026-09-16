---
title: "Once on main, `ipc.spec:31` waited 30 s for a url-changed that never came, and two later tests found the native pane invisible on both tries"
column: next
kind: bug
order: 60
---

FOUND BY HENRY 2026-09-16, reading why main's CI went red at `5e426fb` (#139's merge). **Unowned.
Observed once, cause unknown.**

## Observed, in run [`35145262453`](https://github.com/vibesyemmy/obsrv/actions/runs/35145262453), attempt 1

    ipc.spec.ts:31   reports the URL the native pane navigated to   30.0 s, both tries
                     first line: "Test timeout of 30000ms exceeded." (the "Target page … closed"
                     under it is teardown)
    ipc.spec.ts:134  image mode hides the native pane …   1.2 s, both tries
                     :167  expect(native.isVisible()).toBe(true)   → false
    ipc.spec.ts:173  ignores malformed payloads           217 ms, both tries
                     :191  expect(after.visible).toBe(true)        → false

`:31` navigates the native pane to `about:blank` through `window.obsrv.navigate` and waits for
`onUrlChanged`. It never came. **`:134` and `:173` failing on their retries too** means each failed
alone in a fresh worker. So this is not only a dependency on `:31` having left state behind: the native
pane read as invisible in a freshly replaced worker too.

## How often, measured rather than guessed

Every CI attempt in the API's last 96 runs (2026-09-16, 16:05Z–20:49Z), searched for `ipc.spec.ts:31`.
The detector was checked against this run first, where it finds both tries:

    attempts that ran ipc.spec:31     44
    failed                             1   (this run)
    before #129 merged (19:25:45Z)    28 ran, 0 failed
    after                             16 ran, 1 failed

**One against zero is not a difference.** #129 changed `NativePane` (load and commit recording) and
merged 48 minutes before this run. That makes it the obvious suspect, and nothing here supports it
over coincidence. The window also starts at 16:05Z, so anything older is unswept.

## Not established

- Why `url-changed` never arrived for `about:blank`, and why `isVisible()` read false in fresh workers.
  Both point at the native pane on that runner at that time, not at one test's state.
- Whether it is new. A wider sweep (older runs, via the per-attempt logs) is the first step, before
  any reading of `NativePane`.

## Where to look first if it recurs, as a lead and not a finding

Rook's read: a native surface reading invisible in a fresh app, plus a `url-changed` that never came,
is close to the shape in the `gpu-reset-webgl-stall` memory: a wedged display session on the runner
taking a surface with it. The mechanism there is a lost WebGL context, not a hidden view, so it is a
place to look, not an explanation. **The tell for "runner, not test" here:** the retries failed in
fresh workers, so no state was inherited, and a later attempt on the same head was green. That tell
holds even though nothing else in the run failed.


## SWEPT 2026-09-17 by Rook: 60 suite attempts since, no second sighting

Run at Wren's ask, and by someone with no stake in the suspect — `#129` is Kenya's, so she declined
the sweep.

**Detector:** a `✘` on `ipc.spec.ts:31`, and separately a `✘` on `:134`/`:173`. **Validated against
run `35145262453` before sweeping anything** — it fires there with both tags, so its silence
elsewhere means something.

**Every attempt, not each run's latest.** `--status failure`, a run's `conclusion` and `--log-failed`
all read the latest attempt only, which is how 13 first-attempt failures were missed on `#106`.

    60 suite attempts read, 0 sightings

**One flagged case, checked and rejected.** Run `35157225867` (`e1c952d`, 22:20:57Z) came back
tagged, and it is **not** a sighting: `ipc.spec:31` carries no `✘` in that log at all. The
30-second timeout was `image-mode.spec.ts:70`. My first detector asked for *"`ipc.spec.ts:31`
appears" AND "something timed out"* — and `ipc.spec.ts:31` appears in **every** log as a passing
line, so the tag fired on any timeout anywhere. It is now anchored to the `✘`.

Worth keeping in the record, because the loose tag was a strict **superset** of the correct one: it
fired once across 60 attempts, that once is verified as a different test, so the correct detector
finds zero across the same 60 without re-reading them.

**So one against zero stays one against zero**, over a window considerably wider than before —
Henry's sweep reached back to 16:05Z; this covers the 60 most recent suite attempts, all after
`#129`.

**That is evidence about rarity, not about cause.** A single unreproduced sighting with 60 clean
attempts behind it is consistent both with a runner condition that has not recurred and with a defect
needing a trigger nobody has found. It does not clear `#129`, and it does not implicate it.

**What would settle it is still a recurrence**, and the card's existing reading stands: `:134`/`:173`
failed on their **retries**, which run alone in a freshly launched app, so inherited state from `:31`
is excluded and the pane read invisible in a fresh worker — pointing at the runner at that moment
rather than at those tests.
