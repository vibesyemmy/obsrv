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

## What would reopen this

A `boardServe*` `ENOTEMPTY` (or any `rmSync` error in those two `afterEach` hooks) in a suite log after this merges. One would mean the
retry window (the 5.2 s above, at most) is too short or the writer is not the one named, and it would be a measurement of the reading rather than a
confirmation of it. Absence is weak evidence at one sighting in 483.
