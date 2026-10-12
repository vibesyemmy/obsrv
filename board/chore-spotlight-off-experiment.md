---
title: "an experiment: does switching Spotlight indexing off on the macOS e2e runner change how often the harness has to kill a hung app?"
column: backlog
kind: chore
release: later
owner: "Dogu"
waiting: "Opeyemi: yes or no on the ci.yml experiment (indexing off on alternate runs, kill-line rate counted per arm; its own PR and gate). The longer probe has run, see below"
order: 132
---

RAISED 2026-10-06 (Wren, room message 4092; the probe and the design are Dogu's). **Nothing here is a finding about the hangs.** It is one cheap variable that
both real-hang snapshots share, and a plan to find out whether it matters before anyone changes CI.

## Why this variable

The snapshot card (`board/chore-e2e-snapshot-at-the-kill.md`) holds the two snapshots taken in real hangs. In both, the app was idle and not runnable and the host was busy with
Spotlight: `fit-pan.spec.ts:93` (run `37455521138`, `mds_stores` 110.0% and four `mdworker_shared` at 15 to 22%) and `flow-type-text.spec.ts:100` (run `37463948210`, job `112270207388`,
`mds` 45.1%, `mdworker_shared` 40.5% and 20.8%, `mdworker` 30.1%, `mds_stores` 29.7%): ten of the ten busiest host rows. **Three things limit that.** The figures are `ps`'s `%cpu`, a decayed
average, not a delta. They were taken at the kill, 40 seconds into a hang, so they do not say what Spotlight was doing when the hang began. And the card's own healthy probes already read Spotlight at 20 to 63%,
so a busy Spotlight is ordinary on this image. It is a reason to run an experiment, not a reading.

**A third snapshot, 2026-10-07, points the other way (`main`'s push for the `#605` merge, run `37627685923`, job `112813647663`, `mirror-302.spec.ts:99`; Wren, `#4387`, and read again from the raw log by Dogu).** Load **2.85 6.83 8.65** on 3 cores, and the five busiest host rows were `launchd` 13.0%, `provjobd…` 2.3%, `audioclocksyncd`, `logd` and `smd`: **no `mds`, `mds_stores` or `mdworker`**, with the app idle as before. So the premise "the busiest rows were all Spotlight" held for two hangs of three, and the third is **a hang on a lighter host** (load 2.85 on 3 cores over the last minute, against 15 to 17). **A fourth, the same day (`#608`'s suite, `controls.spec.ts:54`, job `112815227905`), has Spotlight in all five of its busiest rows at load 15.94, and a tail that is not silent: `quitting` was logged about five seconds after the close began.** **A fifth, the same day (`main`'s push suite for the `#612` merge, `status-at-launch.spec.ts:106`, job `112840866337`), has `mds_stores` at 133.8% and `mds` at 68.9% at the top of its busiest rows**, a `quitting` logged half a second after the close began, and no test failed on it. So **four of five hangs had Spotlight on top, and the one that did not was on a lighter host.** What that changes about the ask: it does not make the experiment pointless, because it can still lower the rate of the busy-host ones; it does mean **turning Spotlight off should not be expected to remove all of them**, and the longer probe's question (is Spotlight still busy late in a job) now sits beside a hang that happened without it. One snapshot of the top five rows at one instant ten seconds after the close began, so it shows that Spotlight was not among the busiest at the kill and cannot show what it did in the 41 seconds before. The answer wanted from Opeyemi is unchanged; the evidence it rests on is.

## What one probe showed (`probe/mdutil-effect` at `5ef6b38e`, run `37468521945`, raw job logs read by Dogu and Wren)

Two runners in one run, both macOS 14.8.9 with 3 cores, one with `sudo mdutil -a -i off` and one without. **The command works there:** exit 0, and `mdutil -a -s` reads `Indexing disabled.` on `/`,
`/System/Volumes/Data` and `/System/Volumes/Preboot` afterwards. Spotlight's summed CPU (a `top` delta), mean over the first ~100 s: **on 137.1 before `npm ci` and 106.8 after, off 24.3 and 24.9.**
**One pair, and not a clean one:** the `on` runner had been up 4 minutes (load 7.5) and the `off` runner 1 minute (load 59.7), so a boot-time indexing burst that had not yet started in `off` could be the
whole gap. `npm ci` took 8 s, so there was almost no file-writing load. Only the first ~100 s of a job was sampled, and the three timed hangs are 12.8 to 21.0 minutes into a job (see the longer probe below). It says the switch is real and removes a large CPU consumer
here; it says nothing about the hang rate.

## The longer probe (run `38244210986`, `probe/mdutil-effect` at `13a57f18`, 2026-10-12)

Pushed on Opeyemi's go. Same two arms on two runners in one run, both macOS 14.8.9 with 3 cores, `sudo mdutil -a -i off` on one. It was built to align the arms by uptime (each waits until the machine has been up 6 minutes before the
switch and the sampler, Wren, room message 4104) and to sample for 12 minutes. **It cost about 24.5 macOS minutes for the pair, not the 38 first estimated:** `spotlight indexing off` ran 11:40:59Z to 11:53:16Z (12 min 17 s) and
`spotlight indexing on` 11:41:00Z to 11:53:14Z (12 min 14 s). **The 6-minute wait took 0 s on both**, because the runners were already up 542 s and 431 s when their jobs started; 38 (6 + 12 + setup, twice) is the cost on a fresh
runner, not what this run paid. Raw job logs read by Dogu: off job `114793956669` (618 lines, 50,142 bytes, md5 `2d2cd6a4…`), on job `114793956906` (598 lines, 49,408 bytes, md5 `b28d2534…`).

Spotlight's summed CPU (`top`'s `%CPU`, the second of two samples taken 2 s apart, `top -l 2 -s 2 -n 60 -o cpu`, summed over every command starting `mds`, `mdworker`, `mds_stores`, `mdsync` or `corespotlightd`; 300 is the ceiling on 3 cores), mean / max per 2-minute bin of uptime (325 rows for `on`, uptime 431 to 1149 s; 328 for `off`, 543 to 1263 s):

| uptime | indexing on | indexing off |
| --- | --- | --- |
| 6 to 8 min | 165.8 / 288.9 | not sampled |
| 8 to 10 | 187.1 / 290.3 | 29.7 / 77.2 (27 rows; the switch is in this bin) |
| 10 to 12 | 213.2 / 290.3 | 0.5 / 6.0 |
| 12 to 14 | 221.5 / 288.3 | 0.8 / 5.3 |
| 14 to 16 | 199.6 / 257.1 | 0.5 / 5.4 |
| 16 to 18 | 15.4 / 131.6 | 0.4 / 2.7 |
| 18 to 20 | 0.5 / 8.0 | 0.4 / 4.1 |
| 20 to 22 | not sampled | 0.4 / 2.8 |

**What it shows:** on this image, on an otherwise idle runner, with indexing on, Spotlight's processes used about two of the three cores (bin means 166 to 222) from minute 7 (where that arm's sampling began, at 431 s) to about minute 16 of uptime, and were quiet by minutes 18 to 20; with
indexing off the same processes sat near 0.5 after the first two minutes. **Which clock the hangs are on matters.** The three hangs timed here (job start from the API, kill line from the log) fall at job minutes 18.7, 12.8 and 21.0, and at runner uptimes of about 21.5, at least 14.5 and about 21.7 minutes (the `elapsed` of the oldest host process in each snapshot; the middle one is a lower bound). The probe's axis is runner uptime, but it ran no suite on an otherwise idle runner, so its quiet after minute 16 does not say Spotlight is quiet during a suite: in the 21.7-minute hang's snapshot `mds_stores` is at 133.8% and `mds` at 68.9%, while the `mirror-302` hang (about 21.5 minutes) has no Spotlight process among its five busiest rows. So the timing puts the hangs neither inside the probe's busy window nor after Spotlight has gone quiet; the `ci.yml` experiment is what would tell. One sighting each; no rate. **What it does not show:** it ran no suite, so it says nothing about whether Spotlight has
anything to do with a hang or whether switching it off removes any. It is one pair, on two different machines. The arms were not aligned: the wait did not bind, so sampling started at about 543 s of uptime for `off` and 431 s for
`on`. Each reading is an interval over about 2 s, and `-n 60` keeps only the 60 busiest processes, so a Spotlight process outside the top 60 is not counted; the `off` bin at 8 to 10 minutes includes the switch itself.

## The `ci.yml` experiment, after that (needs a separate OK, its own PR and its own gate)

One step in the macOS e2e job that turns indexing off, applied **on alternate `github.run_number`** so both arms share the same days and runner pool, and the kill-line rate counted per arm. **The register's rate is about
26 jobs in 178 (about 15%)**, and at that rate 0 in 30 by chance is 0.85^30, about **0.8%**; but 30 jobs per arm only separates 15% from roughly 0 to 3%, and a drop to 8% would need many more. **No difference** would rule
Spotlight out; **fewer hits** would be a mitigation, not proof that it is the cause. Nothing in `ci.yml` changes before the OK, and the first probe touched neither `ci.yml` nor `main`.

## Not known

Whether anything in the hang depends on Spotlight (no suite ran on either arm); the runner-to-runner spread, which one pair cannot give; whether the quiet after minute 16 is typical or this pair's; and where in uptime the hangs fall, which three timed snapshots put at about 14.5 to 21.7 minutes. The earlier questions,
whether Spotlight is busy at minute 10 to 18 of a job and whether the switch changes that, now have one pair's answer above.
