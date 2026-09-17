---
title: "`obsrv --help` on a fresh install downloads Electron (~120 MB) before printing the help"
column: backlog
kind: chore
criterion: A3
order: 66
---

FOUND BY HENRY 2026-09-17. **Measured** in the 0.61.0 RC verify dry run (run `35170713448`, job
`cli-cold`): `obsrv --version` answered with no download, and the `downloading Electron 43.7.1` line came
during the `obsrv --help` that followed.

`bin/obsrv.js` answers `mcp`, `install-skill` and `--version`/`-v` in plain node, before the Electron
binary is looked for (cfe22c5 added `--version`, the first thing a bug report asks for). `--help` isn't
among them. It falls through to `resolveElectron()`, which downloads the binary when it's missing, and
only then does the built CLI print the help. A stranger's first command after `npm i -g getobsrv` is
often `obsrv --help`, and it answers after a ~120 MB wait with a download line.

**The catch for a fix:** the help lists every preset and profile, and those tables are TypeScript in
`src/shared`, bundled into `out/main/cli.js` for Electron. `bin/` is plain node. Options:
- a plain-node help built from a JSON the build emits;
- a short plain-node help that says the full list needs the one-time download;
- ship the help text itself as a build artifact.

Choose by what keeps `--help` and the tables from drifting. A test that compares the two outputs would
do that.
