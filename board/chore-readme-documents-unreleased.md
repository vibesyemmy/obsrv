---
title: "The README documents behaviour npm does not ship yet: `--version` downloads Electron and answers \"unknown command\""
column: done
owner: "Henry"
kind: chore
criterion: A3
order: 63
---

FOUND BY HENRY 2026-09-17, in `a3`'s cold-machine run. **Unowned. The fix is a release, and releasing is
Opeyemi's.**

The README on `main` (line 194) says `npx -y getobsrv --version` "prints the installed version, and
needs neither a build nor Electron". That's true of `main` since `cfe22c5`. **npm `latest` is 0.60.0,
published 2026-09-13, before that commit.** On a fresh runner, following the README's own Quickstart
(`npm i -g getobsrv`, then `obsrv --version`, run `35167299615`):

    obsrv: downloading Electron 43.7.1 (first run after an install; ~120 MB), which the tools wait for
    obsrv: unknown command: --version
    <the full --help text>
    exit 2

The same `--version` from **main's packed tarball** printed `0.60.0` in 3.3 s, with no download (run
`35168190686`).

**The general shape:** GitHub shows `main`'s README, and npm serves the last release. Every README
change that describes unreleased behaviour is wrong for a stranger until the next publish, and `main`
has four days of changes since 0.60.0. Options: publish, or mark unreleased README sections until a
release. **The package.json version on `main` is still 0.60.0**, so the version printed doesn't tell
a reader which one they have either.

## CLOSED 2026-09-17 by Henry — the release happened, and the claim is true of what npm serves

**The fix was a release, and 0.61.0 is published.** Verified against the published artefact rather
than against the tag or the release notes: `npm pack getobsrv@0.61.0`, extracted, and the tarball's
own launcher run.

    $ node package/bin/obsrv.js --version
    0.61.0
    0.02s user 0.01s system — 25 ms total

No Electron, no `node_modules` in the package (2.1 MB extracted), no download. That is exactly what
README line 200 claims — *"prints the installed version, and needs neither a build nor Electron"* —
so the sentence is now true for a stranger, which is the only reader this card was about. The RC
cold-verify run `35175793982` said the same from a fresh install; this is the second, independent
reading.

**`package.json` on main is 0.61.0 too**, so the other half of the complaint — that the version a
reader prints doesn't say which tree they have — is closed with it.

## The general shape outlives the instance, so it does not close with it

**GitHub shows `main`'s README; npm serves the last release.** Every README sentence describing
unreleased behaviour is wrong for whoever reads it first, and the gap is however long it is until the
next publish — four days, in this instance. That is a rule about how we write, not a fact about
`--version`, and it goes to `CONTRIBUTING.md` in its own change rather than dying here.

