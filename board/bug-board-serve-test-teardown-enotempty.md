---
title: "`boardServeBrowser.test.ts` failed once in its teardown with `ENOTEMPTY`: the test killed the server and removed its directory in the same breath"
column: done
kind: bug
release: later
owner: "Dogu"
order: 131
---

**One sighting, in one log, and a reading of the code. A candidate, not a rate.**

## The sighting

`#594`, run `37461396063`, attempt 1, job `112261642861` (read from the raw job-log API, 559 lines, `shasum` `ce9d74535c68`),
head `acd7c8e9772ec7c09881ee1152d06616ee09f709`, 2026-10-06 12:12Z. The unit step failed on the one test, the other 2062 passed:

```
FAIL  unit  tests/unit/boardServeBrowser.test.ts > board-serve in a browser > repaints in place: …
Error: ENOTEMPTY, Directory not empty: /var/folders/…/T/board-serve-browser-GYIFEr
  ❯ tests/unit/boardServeBrowser.test.ts:48:35        (the `rmSync` in `afterEach`)
```

The log has no assertion error (0 `AssertionError` lines): the failure is the hook's, reported against the test it followed. The PR's diff was
`killSnapshot.ts`, its unit test and a card, which the failing test does not read.

**How often.** Before this log, 0 of the 483 saved suite logs (every attempt since 09-27) had a `boardServeBrowser` failure; this is the
first, and it is one. One is not a rate. Nothing here says how often a suite will hit it.

## The reading (of the code, not a measurement of that run)

The test's `afterEach` did `p.kill('SIGKILL')` on each server and then `rmSync(dir, { recursive: true, force: true })` at once.
`SIGKILL` is delivered, not awaited, and the call returns before the process is gone. The temp directory (`board-serve-browser-*`) holds
`remote.git`, `clone` and `pusher`. The server's poller runs `git -C <clone> fetch` as a child it started with `execFile` (`scripts/board-serve.js`),
and **that git process is the server's child, not the test's**: killing the server does not stop it. A git that is mid-write into
`clone/.git` (refs, `FETCH_HEAD`, packs, a lock) while `rmSync` walks the tree is the usual way `rm -r` ends in `ENOTEMPTY`.

Two corrections to what the room said while it was being read:

- **`tar -x` is not a writer into this directory.** `buildAt` extracts into its own `board-serve-*` directory under `tmpdir()`, not under
  the test's `board-serve-browser-*` directory. It could leave *that* directory behind (a different leak, never seen); it cannot make this
  `rmSync` fail. The writer the reading names is `git fetch`.
- **Waiting for the parent's exit does not wait for that git.** It is the parent's child. So an exit wait alone covers the server's own writes and
  not the grandchild's, and the thing that covers either writer is retrying the removal.

Not measured: that the sighted run had a git in flight at the kill. The log does not say, and no process table was taken there.

## The change

`tests/unit/killAndRemove.ts`, used by the `afterEach` of `boardServeBrowser.test.ts` and, for the same shape with no sighting,
`boardServe.test.ts`:

1. `SIGKILL` each child and wait for its `exit` (bounded at 2 s, so a child that never exits cannot hang the hook);
2. remove each directory with `maxRetries: 5, retryDelay: 200` (Node's `rmSync` retries on `EBUSY`, `EMFILE`, `ENFILE`, `ENOTEMPTY`, `EPERM`, with a
   delay that grows by `retryDelay` each try). One probe of the window: against a writer that never stopped, the call gave up with `ENOTEMPTY`
   after **5.2 s**, once, on this laptop. A writer that finishes inside that window costs the hook only the time it needed.

## The control, measured on this machine

`tests/unit/killAndRemove.test.ts` has one test with a **real** late writer: a detached grandchild that keeps creating files in the directory for
700 ms and outlives the parent that was killed. Ten runs of that one test per variant, one laptop, the sabotage committed first and restored with
`git checkout --`:

| teardown | passed of 10 | what the failures said |
|---|---|---|
| the fix as written (exit wait + retries) | **10** | |
| **the old teardown** (no retries, no exit wait) | **0** | `ENOTEMPTY, Directory not empty` |
| retries removed, exit wait kept | 0 | `ENOTEMPTY` |
| exit wait removed, retries kept | **10** | |

**How the old teardown was run.** My "old teardown" row is the helper with its retries and exit wait taken out, so it is kill-then-remove run
through the helper's own code, not main's two lines as text. Henry (room message 4066) ran main's literal shape against the same kind of detached-writer parent in a
pristine copy, 6 trials each: **old 0 of 6 clean (6 of 6 `ENOTEMPTY, Directory not empty`), new 6 of 6 clean.** The two agree. They are not independent
in the one respect that matters: both writers are hot loops (700 ms of back-to-back file creation), far harder on the directory than `git fetch` is.
That is why a hot loop fails 10 of 10 and 6 of 6 and CI showed this once in 484 logs; neither measurement says anything about the CI rate.

What this shows: **the control fails on the old teardown, every time, and passes on the fix, every time.** It is not flaky in either direction
over these ten, and ten runs bound nothing about a rate.

What it does not show, and the table says so on its last row:

- **The exit wait is not what makes the control pass.** Removing it leaves the control green. The retries are what covers a late writer. The exit
  wait is kept because it is cheap, it is what makes the server's own writes finish first, and a fake-child test pins its order (kill, then exit,
  then remove, bounded). **No measurement here shows that it matters.**
- **The control is a model of the mechanism, not the race.** The writer is a deterministic 700 ms loop, so it fails every time on the old
  teardown. The CI failure was one occurrence of a timing window; this does not reproduce that window and does not show that the sighted run's
  writer was a `git`. It shows that *if* a writer outlives the kill, the old teardown fails and the new one does not.
- **The real test file was not looped on the old teardown** to see whether `ENOTEMPTY` can be provoked there. It is a way to find out whether the
  reading is right, and it was not done.

## The control's head start was a fixed 150 ms, and that made it blind on a slower machine (Wren, room message 4074)

The first version of the real-writer test slept 150 ms and then killed the parent. If the writer had not started by then, the old teardown had nothing to
race and **passed the control**. Wren measured it (the parent delaying the writer by S ms, 8 runs per cell, old teardown): `ENOTEMPTY` 8 of 8 at S=0, 2 of 8 at
S=100, 0 of 8 at S=250 and S=500. Henry re-ran his own old-vs-new probe, which used the same 150 ms, with the delay (6 trials per cell): old 6/6 red at S=0,
**2/6 at S=100, 0/6 from S=250**, so his "0 of 6 clean" figure above is about that laptop at that moment, not about the control's power. CI is where this matters: the one
real hang's snapshot printed load 15.19 on 3 cores, where a node child can take well over 100 ms to start.

The test now waits for the writer's first file (`vi.waitFor`, 10 ms interval, 8 s cap) and **fails** if none appears, so the writer is provably running when the parent
is told to die. It also cleans up its parent and directory on a failing run (a sabotage that never started the writer left both behind; found by running it).

Measured against the new test, old teardown, 8 runs per cell, the writer starting S ms late: **S = 0, 100, 250, 500, 1000: failed 8 of 8 in every cell.** The fix: passed 4 of 4 at S = 0, 500, 1000.
As a control for the method, the *first* version of the test against the old teardown at S=250 **passed 8 of 8** (blind), as Wren found, so the method can see
the problem it reports gone. A writer that never starts within the cap fails the test with `the writer has not made its first file`.

**Not shown, and not rounded up:** Henry's own re-run of the new wait at S=100 gave old teardown red **5 of 6**, against my 8 of 8 and Wren's 8 of 8: three small samples, three
loads, and I have no reading of the difference. The S rows test the wait (the writer is late), **not a starved runner that delays the kill after the writer is up**: the writer
runs 700 ms of wall clock, so a kill later than that finds nothing to race and the old teardown passes again. That case is not covered, and it is the one a loaded CI runner most resembles.

## The wiring is guarded too (added after room message 4066)

`killAndRemove.test.ts` tests the helper, and for the first version of this branch nothing failed if either `afterEach` went back to the two old
lines: the fix was wired by habit. `tests/unit/teardownWiring.test.ts` adds two checks over the real files:

1. **The shape that failed, by its text.** A file that kills a child (`.kill(`, not `process.kill(pid, 0)`) and removes a directory with `recursive`
   and no `maxRetries` in the call. A recursive removal in a file that kills nothing is left alone: `electronPath.test.ts` removes 20 directories after an
   `execFile` it awaited, which is not this shape, and a rule that flagged it would have meant editing a file nobody asked about.
2. **The two call sites import the helper and call it with the lists they fill** (`started`/`servers` and `dirs`).

Sabotaged, each restored with `git checkout --` (the first version had one survivor, below):

| sabotage | caught by |
|---|---|
| browser file back to kill + bare `rmSync` | both checks |
| `boardServe.test.ts` back to kill + bare `rmSync` | both checks |
| import kept, call replaced by kill + `rmSync` with `maxRetries` | the call check only |
| no kill, bare `rmSync`, import removed | the call check only |
| kill + `rmSync(d, OPTS)` through a named const, import removed | the call check only |
| a **new** file with the old shape | the scan only |
| `killAndRemove([], dirs)` (no children), either file | the call check (a **survivor of the first version**, fixed by checking the arguments) |
| `killAndRemove(servers, [])` (no directories) | the call check |

What it cannot see: options passed by name (`rmSync(d, OPTS)` has no `recursive` to read, so the scan assumes it is fine; the call check covers the
two known files), a kill through a wrapper, and **the exit wait**, which no check here or in the control shows matters. Population when written: no
other file under `tests/unit` kills a child (`mcpControl.test.ts` has one `process.kill(pid, 0)`, an existence probe).

## What would reopen this

A `boardServe*` `ENOTEMPTY` (or any `rmSync` error in those two `afterEach` hooks) in a suite log after this merges. One would mean the
retry window (the 5.2 s above, at most) is too short or the writer is not the one named, and it would be a measurement of the reading rather than a
confirmation of it. Absence is weak evidence at one sighting in 483.
