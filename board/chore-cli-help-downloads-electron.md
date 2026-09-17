---
title: "`obsrv --help` on a fresh install downloads Electron (~120 MB) before printing the help"
column: review
owner: "Henry"
waiting: "Wren: the cold read of the fix PR, then Henry merges"
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

## Claimed by Henry 2026-09-17, routed by Wren

Pulled from Backlog. It's in the 0.61.0 notes' known issues, and it's self-contained: `bin/obsrv.js`'s
plain-node branch already answers `mcp`, `install-skill` and `--version` before Electron is looked for.

**Plan:** answer `--help` the same way, from the same source the built CLI prints it from, so the two
can't drift. Test it with the `OBSRV_ELECTRON_PKG_DIR` stand-in from #207: `--help` must print the usage,
exit 0, and never reach the binary. That means no launch and no download, and it's desk-safe as a unit
test. How plain node reaches the help text (a module in `out/` or a generated file) gets decided on
reading the build.

## In review 2026-09-17: answered in plain Node, from the CLI's own parser

- **`bin/obsrv.js` now answers `--help`, `-h`, `help` and a bare `obsrv`** before the Electron lookup, beside
  `--version`. The CLI's own `parseArgs` decides what a help request is, and `usage()` writes the text.
  Both come from `out/cli/args.js`, which the MCP build already compiles for plain Node and the tarball
  ships (`files: out`). That makes the launcher's text the built CLI's text by construction.
- **Pure, checked by reading:** `args.ts` and `cli/lint.ts` touch no fs, env, exit or console, and import
  only local shared modules, never `electron`.
- **Fallback:** a tree without `out/cli/args.js` falls through to the CLI, which answers the same after the
  lookup.
- **Test (`cliLauncher.test.ts`):** the repo's bin runs against a stand-in `electron` package that records
  being reached.
  - Every help form prints `usage()` plus a newline, exits 0 with an empty stderr, and never reaches the
    stand-in.
  - `snap` does reach it, so the test isn't vacuous.
- **Control:** with the help branch disabled, it's red at `--help` (`status: 3`, empty stdout: the stand-in
  answered).

