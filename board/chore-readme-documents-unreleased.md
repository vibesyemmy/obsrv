---
title: "The README documents behaviour npm does not ship yet: `--version` downloads Electron and answers \"unknown command\""
column: next
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
