---
title: "`npm run typecheck` covers no test file, so \"typecheck clean\" has never said anything about a test change"
column: done
owner: "Henry"
kind: bug
order: 59
---

FOUND BY HENRY 2026-09-16, reading why #143 went red on CI instead of at typecheck. **Unowned.**

## What happened

#143 changed `tests/e2e/live-drive.spec.ts` to call `isFrameIdentityWarning` and put the import into
`tests/unit/frameCheck.test.ts` instead. CI's e2e step failed both tries with
`ReferenceError: isFrameIdentityWarning is not defined` (run `35145332609`, first line). The
typecheck step before it passed. A missing import is exactly what `tsc` names, and it never saw the
file.

## Why, measured

`npm run typecheck` is `tsc -p tsconfig.node.json && tsc -p tsconfig.web.json && tsc -p tsconfig.mcp.json`.
Their `include` lists are `src/main`, `src/cli`, `src/preload`, `src/shared` and
`electron.vite.config.ts` (node), `src/renderer` and `src/shared` (web), and `src/mcp` (mcp).
**Nothing under `tests/`.** Vitest and Playwright both strip types without checking them, so a type
error in a test surfaces only if it throws at run time. A wrong argument type that doesn't throw
never surfaces.

**With the tests included** (a probe tsconfig extending `tsconfig.node.json`, adding `tests/**/*` and
`src/mcp/**/*`): **61 errors in about 20 test files**. The largest counts are `tests/unit/store.test.ts`
15, `tests/unit/electronPath.test.ts` 8, `tests/e2e/mcp-live.spec.ts` 5 and `tests/e2e/tabs.spec.ts` 3.
**Not yet sorted into defects and config.** `store.test.ts` imports renderer code, which wants the web
tsconfig's settings, so some of the 61 will be the probe's configuration rather than the tests.

## Why it matters beyond one import

Every PR today that changed only tests and said "typecheck clean" (several of Henry's, Kenya's and
Rook's) was reporting a check that did not cover the change. Nothing false was claimed about `src`,
but the sentence read as coverage it didn't have. That is the silence-that-fits-two-facts shape
again, in the verification line itself.

## What a fix has to do

- **Sort the 61** into real test defects and probe configuration: renderer tests under the web
  settings, node tests under the node settings.
- **Add test tsconfigs to `npm run typecheck`,** so CI's typecheck step covers them.
- **The control:** reintroduce #143's missing import on a branch and watch `npm run typecheck` go red
  on it, before any e2e step runs.

## Closed 2026-09-16: `tsconfig.tests.json` is part of `npm run typecheck`

**One program, not one per side.** A unit test imports both sides in the same file.
`store.test.ts` imports the renderer store along with shared presets, so splitting by directory
wouldn't separate the settings. The tests config extends `tsconfig.node.json` (same strictness,
node types) and adds the renderer's `DOM.Iterable` and JSX. It includes `tests/**`,
`playwright.config.ts` and `vitest.config.ts`, and all 161 tracked test files are in the program.
The whole `npm run typecheck` takes about 4 s.

**The sort, re-measured on `e1c952d`.** On that tree the probe above found 54 errors, not 61, because
main had moved. 4 of the 54 came from the probe's configuration, and adding `DOM.Iterable` and JSX
removes them: TS2488 ×3 in `inspect`, `orientation` and `toolbar` specs, and TS6142 in
`panelControls.test`. The other 50 were in the tests:

- **Two real defects.**
  - `contrastPainted.test`'s "reference panel" was a literal in the profile's shape
    (`gamutCoverage`, `bits`) typed as `PanelParams`. So `onPanel` read undefined fields and came
    out NaN, and no assertion read it.
  - `rendering.spec`'s hairline test lacked its sibling's null guard. A capture with no full paint
    failed as a TypeError on `seen.sf`, not with the message.
- **Stale fixtures (types that grew).** Every reader of a missing field was checked. Each one
  defaults the field, so no test was passing by mistake. The restore test now also asserts the orientation
  and text scale a seeded tab takes.
- **Narrowing and casts.** Four specs read the control file as always holding a port, but it can be a
  stance, so they now narrow. The rest are casts that stopped overlapping their types.

**Controls, run on the committed branch, with files restored from copies.**
1. Removing #143's import (`isFrameIdentityWarning` in `live-drive.spec.ts`) makes `npm run typecheck`
   exit 2 with `TS2304: Cannot find name 'isFrameIdentityWarning'`. CI runs typecheck before unit,
   build and e2e.
2. Putting back the old `REFERENCE` literal fails `expected NaN to be close to 19.56…`.
3. Dropping `orientation`/`textScale` from `syncTabs`' seed fails the restore test.
