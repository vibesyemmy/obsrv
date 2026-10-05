---
title: "when the e2e harness kills a hung app it prints the app's log tail and nothing about what the machine and the process were doing"
column: backlog
kind: chore
release: later
waiting: "Henry and Wren: whether to build it"
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

## Controls it needs before anyone reads a snapshot

1. A main process busy-waiting for 45 s (an `electronApplication.evaluate` that spins): the snapshot must read busy.
2. The main process stopped with `SIGSTOP`: it must read `T`.
3. An idle app on a host under CPU burners: it must read load high, app idle.
4. **A case where the harness link is the thing cut and the app is healthy.** How to cut it deterministically is **not known**; if
   there is no way, the card says so and the last row of the table stays unresolved.

## Not known

**A hang inside `launchApp` never reaches `boundedClose`,** so the snapshot would not run there (Idris, `#3764`: one launch hang in 60 idle runs, `launchApp` waiting 10 s
for the native pane's size text, `app` then undefined in `afterAll`); whether such a hang leaves the spawned app behind is unchecked. Whether `ps` shows the Electron helper processes with the same flags on the macOS runner image; whether a snapshot adds noticeable
time to a kill that is already ten seconds late; how large the output is. All three are one run each to find out.

## Owner and decision

Dogu's lane (CI and test infrastructure). Whether to build it is Henry's and Wren's call; the only thing asked for now is the card.
