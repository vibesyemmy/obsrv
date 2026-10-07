---
title: "when the e2e harness kills a hung app it prints the app's log tail and nothing about what the machine and the process were doing"
column: doing
kind: chore
release: later
owner: "Dogu"
waiting: "event: a real hang that prints the parent row; none has since `#594` merged (12:42Z 10-06)"
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

**Amended 2026-10-06, after the build (Wren's read `#4002`, Idris's gate `#4003` and `#4005`):** (i) the worst case is **1.0 s, or 1.25 s if the inner cap itself failed**: `snapshotThenKill` races the snapshot against a
second timer 250 ms longer, so a snapshot that never settles still cannot hold the kill. (ii) **The busiest-other-processes rows name a process by the last part of the first word of its command and print nothing after it.** The app's own rows keep their arguments, because the
flags are what tell a GPU helper from a renderer; a host process is only being named as busy, its arguments are somebody else's, and on a laptop the busiest five can be anything that is
on a command line, in a log that gets pasted and uploaded. `ps` cannot say where an executable ends and its first argument begins when the path has spaces, so the rule does not try, and a
program whose path has a space reads as its first word (`Google` for `Google Chrome Helper`). A first version cut at the first ` -` and printed every argument that did not start with a dash
(`curl https://x?token=...`, `python3 main.py secret`); Idris and Wren each found it, `#4005` and `#4006`. (iii) A process table read of 5,000 rows or more says the read was cut there.

## Built 2026-10-06

`tests/e2e/helpers/killSnapshot.ts` (the snapshot, pure parsing and formatting plus a bounded runner), `snapshotThenKill` and an exported `boundedClose` in `tests/e2e/launch.ts`, and
`tests/unit/killSnapshot.test.ts`. The unit tests drive each failure the budget names (`ps` failing, throwing, hanging, flooding; load unreadable; a throwing kill), the kill wiring in
`boundedClose` with a fake app (a hung close ends in the report and then the kill, even when the snapshot never settles; a close inside the grace is not killed and leaves no timer; a
failing close reaches the caller; and the real defaults), and one against the real `ps`. Each property was broken in turn to check a test notices, and the ones that survived were fixed
(an untested line cap, an unreachable byte cut, and a kill call whose deletion left every test green until `boundedClose` was made testable).

**Follow-up, 2026-10-06 (Wren's suggestion, `#4038`): the snapshot also prints the app's parent**, the Playwright worker that holds the link to the app, with its state, `%cpu`, CPU time and name. It is in
the `ps -A` table already, so there is no second command and the budget is unchanged. If the parent is not in the table it says the process that launched the app had gone, and a parent of pid 1 is called
a reparenting. It is the half of "stuck link or starved runner" that the app's own tree cannot show: a worker that is busy, stopped or gone reads differently from one that is idle. It is not listed a second
time among the busiest other processes. It is **named, not quoted**: the first word and, when the second word is a script, that script's file name (`node workerProcessEntry.js`), and nothing after
it, because a local run can be launched by any script with any arguments and this text goes into a log that gets pasted (Idris's pre-read, `#4049`). **The app's own tree is limited to 16 rows**, so a large tree can never crowd the parent and the host rows out of the 40-line cap (Wren, `#4051`); **the 16 are chosen by what they say, not by table order**:
the root, then any descendant that is not plainly sleeping or idle (`R`, `T`, `U`, `Z`), then the busiest by `%cpu`, so the one busy or stopped child cannot be the row that was left out; and the line that says how many
were left out also says what they were doing (`… and 15 more descendants (S×15; busiest 0.0%)`), so that leaving rows out is a reading too (Wren, `#4053`); and **a process missing from a table that was read to its 5,000-row limit is
reported as not found in the rows read, not as having gone.** Tested for each case, and sabotage-checked.

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

**The first snapshot from a real hang, 2026-10-06 (`#593`'s own suite, run `37455521138`, `fit-pan.spec.ts:93`, first attempt 30.0 s, retry `✓` in 386 ms).** Report line 11:30:12.163Z, snapshot
header 81 ms later (`ps took 43 ms`), tail silent (`starting`, `gpu`, no `quitting`). **The app was idle, not busy and not stopped:** main in state `S<s` at **0.0% CPU** (0:00.50 of CPU in 41 s),
its six helpers `S<` at 0.0 to 0.4%. **The host was saturated:** load 15.19 / 14.34 / 11.26 on 3 cores, **`mds_stores` (Spotlight) at 110.0%** and four `mdworker_shared` at 15.1 to 22.5%. In the table
that is the row "main not busy, host load high": it **rules out a busy loop in main and a stopped main**, fits a starved runner, still fits a stuck harness link, and names no cause. Three limits:
it is one hang; it is a reading **at the kill, about 40 s after the click began waiting**, not at the start; and the healthy probe runs already showed Spotlight at 20 to 63% and loads of 10 to 37, so a
saturated host is not in itself unusual on this image. **An observation, not a cause (Wren, `#4038`):** none of the app's seven processes was runnable (all `S`, about 0%), and each carried `<`, a raised
priority, which a Spotlight indexer does not; a process queued behind a busy host would more often read `R` and have accumulated CPU time. That fits "waiting for an event that did not arrive" at least as
well as "starved", and `ps` inside the guest cannot show a hypervisor taking the vCPU, so it excludes neither. **And the click's call log went further than in the earlier `fit-pan` sighting:** `.view-1x`
resolved, then `element is visible, enabled and stable`, `scrolling into view if needed`, `done scrolling`, **`performing click action`**, then nothing for the rest of the 30 s, so the actionability checks all
passed and the stall was in the click being performed. The next datum that would help is on the harness side, which is what the parent row below is for.

**The second snapshot from a real hang, 2026-10-06 (`#592`'s suite at `4bc5914e`, run `37463948210`, job `112270207388`, attempt 1, `success`; `flow-type-text.spec.ts:100`, first attempt 30.0 s, retry `✓` in 644 ms).**
Found by Idris (`#4090`); read again here from the raw job log (1,532 lines, 222,296 bytes, md5 `23b6b4b0`), where it is the run's one `app.close() has taken 10003 ms`. Kill line 12:45:32.877Z; snapshot header 155 ms later (`ps took 96 ms`),
tail silent (`starting` at 12:44:51.019Z, `gpu`, no `quitting`), so the app had been up **42 s** and logged two lines, 0.4 s apart, in the first of them. **Same shape as the first, nearly figure for figure:** the app idle, not busy and not stopped:
main `S<s` at **0.0%** with **0:01.18** of CPU in 00:42 (the first: 0:00.50 in 41 s), the gpu helper 1.2% (0:01.23), the network service and four renderers `S<` at 0.0% (0:00.12 to 0:00.64), **seven processes and none runnable, each carrying `<`**
(Wren's observation on the first applies unchanged). **The host was saturated again, a little differently:** load 16.82 / 15.88 / 11.90 on 3 cores (462 processes), **`mds` 45.1%**, `mdworker_shared` 40.5%, `mdworker` 30.1%, `mds_stores` 29.7%
and a second `mdworker_shared` 20.8%, **four of those five in state `U`** (uninterruptible wait, which in the first snapshot no busiest row was). It rules out the same two things as the first (a busy loop in main, which would show
CPU time in the tens of seconds and shows one; a stopped main) and **names no cause**. Two readings of one shape, now twice: the harness's link stuck, or the runner stalled, and the idle and unrunnable app fits both. What a second one adds: **it is not a
property of `fit-pan`** (a different file, a different first test, `flow-type-text.spec.ts:100` being the file's first), and the host's Spotlight use was lower (45% against 110%), so the saturation is not one number. What it does not add:
**this merge ref carries `#593`'s snapshot and not `#594`'s parent row, so the half the parent row exists to show is still unseen**; two hangs are not a rate; and the healthy probes already read Spotlight at 20 to 63%. The register's recount of
2026-10-07 (`docs/e2e-flakes.md`, "Counted again, 2026-10-07": 38 hits in 32 jobs, 21 silent and 17 `quitting`) includes this hit and the first one's run; it is one count, by Dogu.

**The third snapshot from a real hang, 2026-10-07, and the first with the parent row (`main`'s push suite for the `#605` merge, run `37627685923`, job `112813647663`, attempt 1, `success`; `mirror-302.spec.ts:99`, first attempt 30.0 s, retry `✓` in 187 ms).**
Found by Wren (`#4387`); read again from the raw job log by Dogu (214,229 bytes, 1,472 lines, md5 `d813a6f809cdb28f9efdcf053b12ac53`, the same as Wren's pull). Kill line `app.close() has taken 10003 ms; killing pid 38530`; tail silent (`starting` and `gpu` 0.3 s apart, no `quitting`); `ps took 53 ms`.
**The app was idle again, and this time the host was quiet:** load **2.85 6.83 8.65** on 3 cores (the two earlier hangs read 15 to 17); main `S<s` at 0.0% with 0:00.57 of CPU in 00:41, the gpu helper 0.9%, the other six helpers 0.0%, **eight processes and none runnable**; the five busiest other
processes of 475 were `launchd` 13.0%, `provjobd…` 2.3%, `audioclocksyncd` 0.1%, `logd` 0.1% and `smd` 0.0%: **no Spotlight process among them**, where in the first two hangs ten of the ten busiest rows were. **The parent row, which `#594` added and no hang had printed until now:** `node workerProcessEntry.js`, pid 16967, state
`R<`, 0.0%, 0:30.05 of CPU in 17:08. **What it does and does not say:** the Playwright worker was **not gone and not stopped**, and **not busy on average** (30 s of CPU over 17 minutes). Its `R` is a single instant, and the snapshot is taken **by that process** (`launch.ts`), so at that instant it was running our code at least; `R` does not say what it was doing before the kill.
What this does to the readings: the third hang does not fit "the runner was starved" as the first two seemed to, because the host was quiet, and it leaves "the harness's link to the app was stuck" and "main was waiting for an event that did not arrive" standing, with nothing here that separates them (the control 4 note below still applies). **One quiet-host hang does not undo the two busy-host ones**; it says Spotlight was not needed for a hang, which is not the same as saying it was never involved. Three hangs, not a rate; no cause.
**Counts:** adding this hit to the register's 38 in 32 (through run `37463948210`) gives 39 in 33, 22 silent and 17 `quitting`, **as far as the runs read go**; it is an addition, not a new sweep, and the register is not updated here.

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
for the native pane's size text, `app` then undefined in `afterAll`); whether such a hang leaves the spawned app behind is unchecked. **What a snapshot reads in a real hang** is the point of the whole card: one has been caught (above), one reading, and the controls only show what each deliberate cause looks like. The cost on a
runner that is itself hung is measured once, in that hang: `ps took 43 ms`.

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
