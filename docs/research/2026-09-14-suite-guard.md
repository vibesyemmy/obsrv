# Three ways to a green that means nothing, and what each one now says

Built 2026-09-14 by Rook for `chore-guard`. Every message below is copied from
a real run, not composed for the document.

The three are one family: a result whose appearance fits two opposite facts,
with nothing in it saying which. A refusal that fits "a suite is running" and
"a suite died here once". A pass that fits "everything checked out" and "there
was nothing to check". A crash that fits "the code is broken" and "this run
never set the value up". The fix in each case is not to prevent the state — it
is to make the output name which of the two it found.

## 1. Two suites at once — `scripts/suiteLock.js`, `scripts/suite.js`

One lock per worktree, taken by an atomic `mkdir`, holding the suite's name,
pid and start time. It covers all three suites because the interference is
between them: `test:e2e` runs `npm run build`, which rewrites `out/` — the same
`out/` the CLI specs execute.

The pattern is `bin/electronPath.js`'s install lock, which already solved this
for a different resource.

**Live holder**, observed by starting one suite and another a second later:

```
obsrv: the e2e suite is already running (pid 24890, started 1s ago).
Two suites in one worktree make both results untrustworthy — test:e2e rewrites out/ while the CLI specs read it.
Wait for it to finish, or stop that process. This is a live holder, not a leftover file: do not delete the lock.
```

## 2. The stale lock, which is the whole card

obsrv-91's point, and it is right: a guard seen refusing a *live* suite has
been shown capable of refusing. That is not the same as being right about
**which** of the two it found, and both branches produce a refusal. So this was
observed rather than designed — a real `npm test` started, `SIGKILL`ed
mid-run so no exit path could run, the lock left behind, and the next suite's
first words recorded:

```
obsrv: taking over a stale lock from the unit suite — pid 25891, which is no longer running.
It died 16s ago without releasing. Nothing is running; continuing.
(and the suite ran)
```

A dead holder is taken over rather than refused. Refusing on a corpse is what
gets the lock deleted by hand by the first person it blocks, after which nobody
trusts it again.

**The first version of that message was wrong, and running it is how I found
out.** It said `It died 0s ago` about a suite killed ten seconds earlier: the
caller had no age to hand and passed a literal `0`. A sentence keying off
nothing, in the one message whose job is to be believed. The age now travels
with the takeover, out of the lock file, and `tests/unit/suiteLock.test.ts`
holds a 42-second dead holder so it cannot silently become a constant again.

The tests plant pids in fixture directories and inject liveness. Whether some
pid happens to be running on this machine is exactly the state this code exists
to cope with, so a test that reads it fails on whichever machine is in the state
being handled — the rule `electronPath.test.ts` already applies to Electron.

## 3. A run that asserted nothing — `src/shared/established.ts`

Two shapes, one family.

**The crash.** `tests/e2e/live-drive.spec.ts` fills `info` — the control port
and token — inside the file's *first* test, so any filtered run of a later test
dies inside the app's own code. Kenya found it. Before and after, same command
(`-g "a wrong or missing token"`):

```
before:  TypeError: Cannot read properties of undefined (reading 'port')
after:   info (the control port and token) was never established: this file's first test
         did not run in this suite. A filtered run (-g / -t) skips it, so this is the run,
         not the code — run the file whole to exercise this test.
```

The first names the app. The second names the run. Nothing about the
arrangement improved — a file whose tests depend on each other in order is
still a file you cannot run one test of — but the dependency now announces
itself instead of being discovered by debugging the wrong thing.

**The vacuous pass.** `surface-parity.spec.ts` grew the only assertion anyone
had written against this, after a filtered run starved its rows and a *planted
stale row passed green*. Its wording now lives in `noEvidenceMessage` so the
next one need not be discovered the same way. Observed firing under `-g`:

```
No tool compared on any page, so this test had nothing to check.
A pass here is not evidence — it is the absence of any — so run the whole file rather than a filtered subset.
```

## What this does not do

- It does not stop you running a filtered suite. Filtering is useful; a
  filtered run that *reports* like a full one is not.
- It does not find the other files that could pass having measured nothing.
  `mcp.spec.ts` and `rendering.spec.ts` also accumulate module-level state; they
  have not been audited against this, and `noEvidenceMessage` existing is not
  the same as its being used.
- The takeover has a residual race: two processes seeing the same dead holder
  could both write, and the loser is refused on the re-read rather than
  serialised. `bin/electronPath.js`'s takeover mutex is the heavier pattern if
  it ever shows up in practice. It has not.
