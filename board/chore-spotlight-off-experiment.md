---
title: "an experiment: does switching Spotlight indexing off on the macOS e2e runner change how often the harness has to kill a hung app?"
column: backlog
kind: chore
release: later
owner: "Dogu"
waiting: "Opeyemi: yes or no on the longer probe (about 38 macOS minutes for the pair, a throwaway branch, nothing in ci.yml); a ci.yml experiment needs your OK after it"
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

## What one probe showed (`probe/mdutil-effect` at `5ef6b38e`, run `37468521945`, raw job logs read by Dogu and Wren)

Two runners in one run, both macOS 14.8.9 with 3 cores, one with `sudo mdutil -a -i off` and one without. **The command works there:** exit 0, and `mdutil -a -s` reads `Indexing disabled.` on `/`,
`/System/Volumes/Data` and `/System/Volumes/Preboot` afterwards. Spotlight's summed CPU (a `top` delta), mean over the first ~100 s: **on 137.1 before `npm ci` and 106.8 after, off 24.3 and 24.9.**
**One pair, and not a clean one:** the `on` runner had been up 4 minutes (load 7.5) and the `off` runner 1 minute (load 59.7), so a boot-time indexing burst that had not yet started in `off` could be the
whole gap. `npm ci` took 8 s, so there was almost no file-writing load. Only the first ~100 s of a job was sampled, and the hangs are 12 to 15 minutes in. It says the switch is real and removes a large CPU consumer
here; it says nothing about the hang rate.

## The longer probe (what the yes is for)

Built, committed locally on the probe branch (`13a57f1`), **not pushed**, because a push to that branch starts it. Same two arms, but **aligned by uptime**: each waits until the machine has been up 6 minutes before the switch
and the sampler (Wren, room message 4104), and the sampler runs 12 minutes, covering minutes 6 to 18 after boot, which contains both snapshots. Every sample row carries its uptime, and the summary is per 2-minute bin of uptime.
**About 19 macOS minutes a job and 38 for the pair.** It answers whether Spotlight is still busy late in a job and whether the switch changes that then. It does not run the suite and cannot say anything about hangs.

## The `ci.yml` experiment, after that (needs a separate OK, its own PR and its own gate)

One step in the macOS e2e job that turns indexing off, applied **on alternate `github.run_number`** so both arms share the same days and runner pool, and the kill-line rate counted per arm. **The register's rate is about
26 jobs in 178 (about 15%)**, and at that rate 0 in 30 by chance is 0.85^30, about **0.8%**; but 30 jobs per arm only separates 15% from roughly 0 to 3%, and a drop to 8% would need many more. **No difference** would rule
Spotlight out; **fewer hits** would be a mitigation, not proof that it is the cause. Nothing in `ci.yml` changes before the OK, and the first probe touched neither `ci.yml` nor `main`.

## Not known

Whether Spotlight is busy at minute 10 to 18 of a job; whether the switch changes that; whether anything in the hang depends on it; and the runner-to-runner spread, which one pair cannot give.
