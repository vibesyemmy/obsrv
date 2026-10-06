---
title: "when the e2e harness kills a hung app it prints the app's log tail and nothing about what the machine and the process were doing"
column: doing
kind: chore
release: later
owner: "Dogu"
waiting: ""
order: 129
---

RAISED 2026-10-05; **nothing here is built or measured.** It came out of the join recorded in the register (`docs/e2e-flakes.md`, the
section "A silent close sits before some failures", merged in `#569`) and the room thread that checked it (`#3658` to `#3663`).

## What is known, and the wall it hits

`boundedClose` in `tests/e2e/launch.ts` gives `app.close()` ten seconds; past that it prints `[launch] app.close() has taken N ms;
killing pid P` with the app's own log tail and kills the process. Ten hits were known in eight CI job logs (09-29 to 10-05) **as of `#569`**, and run `37355564026` (`main`, 18:51Z) added an eleventh, so eleven in nine; **eight
tails are silent** (`starting`, `gpu: …`, no `quitting`), so `app.quit()` did not reach `before-quit` in ten seconds, and three log
`quitting`. Four of the five first-attempt failures that ran the full 30.0 s since `#540` had a silent tail as of `#569`; the new one is a 30 s `beforeAll`
hook timeout in `throttle-live.spec.ts`, which makes it five of six.

Candidate readings, none excluded by the logs: the main process was **blocked** (a busy loop), the **harness's link** to it was stuck
(the quit request never arrived), or the **runner** was stalled. One local datum (Idris, one laptop, not CI) is five slow closes under 24 CPU burners **with a scratch event-logger patch in `targetSource.ts`**, all five tails with
`quitting`; the patch is an unmeasured confound (the same loop was not run without it) and the file the figures came from did not survive a session restart.
It is a reason to doubt that a starved runner explains the silent tails, and **a starved runner is not shown to be the explanation** (`#569` says the same).

**Recounted 2026-10-06, and the figures above are superseded.** "Eight tails are silent" was the register's ten-row table plus one hit, and the
register's recount (`#587`, `#588`, raw API, every attempt) says it is not the shape of the set: **14 silent and 16 `quitting` across 30 hits in 26 jobs
through 10-06 04:26Z, and 18 silent and 17 `quitting` across 35 hits in 29 jobs with the hits since** (through run `37437677489`). A silent tail is in
about half of the hits (14 of 30, 18 of 35). It does not change what the tail cannot say: the three readings above still cannot be separated from the app's own log.

## What to add

At the kill, before `SIGKILL`, print one **snapshot**, bounded and never able to throw: `ps` rows for the app's process tree (pid, ppid,
state, `%cpu`, CPU time, elapsed, command truncated), plus `uptime` (load) and the top few processes on the host by CPU. The log tail
already printed stays as it is. Test infrastructure only: no `src/` change, no change to when or whether the app is killed.

## What it can and cannot tell (Idris's limit, `#3663`)

| what the snapshot reads | rules out | still fits |
| --- | --- | --- |
| main process busy (`R`, high CPU) | a stuck harness link; a stalled runner with an idle app | a busy loop in main |
| main process stopped (`T`) | busy loop; harness link | something stopped it |
| main not busy, host load high | nothing about the app | a starved runner |
| main not busy, host quiet | busy loop; starved runner | **both** a stuck harness link and a main that is simply not running |

So it can rule candidates out; **it cannot name the cause**, and the last row leaves two readings standing.

## Time budget, written 2026-10-06 before any code (`#3999`)

**Measured once, on one laptop (macOS 27.0.1, idle), to choose between one sample and two.** BSD `ps` `%cpu` is not a lifetime average there: a node process
spinning for 4 s read **98.5** at 1.5 s, then **3.1, 1.2, 0.4** over the second after the spin, while its cumulative CPU time stayed at `0:04.03`. So one sample reads busy
against idle, and a second sample (which would add a gap) is not taken unless a control shows it is needed. One `ps -A -o pid=,ppid=,state=,%cpu=,time=,etime=,command=`
took **31 ms** and returned **692 rows, 255,673 bytes**. The runner's figure is **unmeasured** and is the first thing the CI probe records.

1. **Hard cap on the whole snapshot: 1,000 ms wall**, enforced by a race against a timer; past it the kill proceeds whatever the snapshot is doing.
2. **One subprocess only**, the `ps` above, with its own 500 ms timeout (SIGKILL on expiry) and a 4 MB `maxBuffer`; its streams and handle are released at the cap. Host
   load comes from `os.loadavg()` and `os.cpus().length` in-process.
3. **Output cap: 40 lines and 4,096 bytes**: the app's process tree (pid, ppid, state, `%cpu`, CPU time, elapsed, command cut to 100 characters), the top 5 host processes
   by `%cpu`, the load average.
4. **It cannot throw.** The whole function is inside a try/catch; a failure prints one line, `snapshot unavailable: <reason>`; `proc.kill('SIGKILL')` is in a `finally`;
   the `stderr` write is guarded too. No `src/` change, nothing that changes whether the app is killed.
5. **Added time to the kill: expected tens of milliseconds, worst case 1.0 s**, on a kill that is already 10 s late. If the runner's `ps` costs more than the cap allows, the
   design changes, not the cap.

## Controls it needs before anyone reads a snapshot

1. A main process busy-waiting for 45 s (an `electronApplication.evaluate` that spins): the snapshot must read busy.
2. The main process stopped with `SIGSTOP`: it must read `T`.
3. An idle app on a host under CPU burners: it must read load high, app idle.
4. **A case where the harness link is the thing cut and the app is healthy.** How to cut it deterministically is **not known**; if
   there is no way, the card says so and the last row of the table stays unresolved.

**Results, 2026-10-06, from a CI probe** (a throwaway branch with a trimmed `ci.yml` and one probe spec, never merged; each control launches its own app, makes
`app.close()` hang, and lets `boundedClose` print the snapshot; runs `37452623714` and `37453082900`, macOS runner, 3 cores):

| control | what the snapshot read for the app's main process | what it read for the host |
| --- | --- | --- |
| 1. main busy-waiting 45 s | state `R`, **98.4% and 100.0% CPU** (11.85 s of CPU in 15 s elapsed) | mostly Spotlight (`mdworker`, `mds_stores`) in the busiest rows, 16 to 33% each |
| 2. main stopped with `SIGSTOP` | state **`T`**, 0.0% CPU, CPU time not moving | Spotlight again, up to 63% |
| 3. idle app (quit held back), three CPU burners | state `S` (and `R` at 0.0% in the first run), **0.0% CPU** | **the three burners at 96.7 to 97.9%** (81 to 86% in the first run) |

All three read as the card wanted. Three things the reading depends on: **(a) `%cpu`, not the state letter, tells busy from idle**: an idle main read `R` in one run and `S` in
another, and a busy one read `R`. **(b) The load average did not separate control 3 from the others on this runner**: it read 10 to 16 on 3 cores in every snapshot,
burners or not, so the busiest-process rows are what carries the host reading. **(c) A busy host is ordinary on this runner**: Spotlight alone used 20 to 63% of it in controls 1
and 2, so a reading of "host busy" in a real hang needs that baseline beside it before it says anything. One runner image, one probe each time, not a rate.

**Control 4 has no deterministic method that I could find, and the last row of the table stays unresolved.** Candidates considered: stopping the Playwright worker stops the
thing that prints; pausing main through the inspector gives a main that is not running, which is the same row; closing the inspector makes `close()` reject quickly and not hang;
and Playwright connects to the app's inspector port directly, so the harness has no hook to blackhole it. "The harness's link is stuck while the app is healthy" and "main is
simply not running" show the same snapshot, and nothing run from outside the app separates them.

## Not known

**Answered by the probe (2026-10-06):** `ps` on the macOS runner image shows the Electron helpers with their flags (`--type=gpu-process`, `--type=renderer`, `--type=utility`), once the
path that every process in the tree shares is cut off (the first probe cut each command inside that path and every helper read alike; `shortCommand` fixed it). **Time:** the header's
`ps took N ms` read 72, 41, 72, 51, 50 and 61 ms across six snapshots, and the 1,000 ms cap was never near; the laptop figure was 31 ms. **Size:** about 2.0 KB and 17 lines on a table of
464 to 473 rows, under the 40 lines and 4,096 bytes. In the job log the reporter's `✓` line can land inside a snapshot, because stderr and stdout are merged by line.

**Still not known.** **A hang inside `launchApp` never reaches `boundedClose`,** so the snapshot would not run there (Idris, `#3764`: one launch hang in 60 idle runs, `launchApp` waiting 10 s
for the native pane's size text, `app` then undefined in `afterAll`); whether such a hang leaves the spawned app behind is unchecked. **What a snapshot reads in a real hang** is the point
of the whole card and is unknown until one is caught; the probe only shows what each deliberate cause looks like. The cost on a runner that is itself hung is unmeasured.

## Owner and decision

Dogu's lane (CI and test infrastructure).

**Decided 2026-10-06: build it.** Wren said yes in `#3744` (no deadline, behind the redirect diagnosis, the cap and `ci.yml:176`, all of which have landed on
`main`) and Henry said yes in `#3972`, with one condition that is now this card's first constraint: **the instrument must never be able to throw or hang.** A
diagnostic that can fail inside the failure path turns one red into two and makes the original unreadable, so it is bounded, best-effort and swallows
everything. Wren's two conditions stand beside it: it adds nothing noticeable to the kill, and control 4 gets a method or this card says it has none.

**No deadline, and no dependency was set.** Henry's order in `#3972` (the `bug-vision-47-normal-not-red` card, the orientation code PR, the redirect card) is the order of
Henry's own cards, and Wren's `#3744` put this behind the redirect diagnosis, the cap and `ci.yml:176`, which have landed. Nothing here is urgent, and it
does not wait on Henry's cards.

**Claimed 2026-10-06 by Dogu.** First steps, in order: read `boundedClose` in `tests/e2e/launch.ts` and write down the snapshot's time budget before
building anything; then controls 1 to 3, and control 4's method or its absence. Test infrastructure only (no `src/` change, nothing that changes when or
whether the app is killed), so Idris gates the PR; nothing in it is built or measured yet.
