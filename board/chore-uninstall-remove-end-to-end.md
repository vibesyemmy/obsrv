---
title: "Nothing exercises obsrv uninstall --remove against a real filesystem"
column: done
kind: chore
criterion: C5
order: 99
---

SPLIT OUT 2026-09-18 by Henry from `chore-uninstall-path`, which shipped the removal. Named by Idris
in the `#335` verdict as the one gap worth having eventually and not worth holding that change for.

## What is covered today, and what is not

**Covered.** `removeListed`'s every branch — exclusivity to present-and-allowed, the per-path re-check
and its ordering, continuation past a failure, the unmeasured-platform short-circuit, the exit code.
And the one fact that cannot be reasoned about, measured against a real disposable filesystem in both
shapes: a symlink **nested inside** a removed tree, and the removal **target itself** being a link.

**Not covered.** No test runs `--remove` end to end against a populated tree and checks what is left
on disk afterwards.

## Why it is not simply missing

`checkRemoval` reads the **passwd** home rather than `$HOME`, deliberately, so that moving an
environment variable cannot point a deletion somewhere it should not go. **That is exactly the
substitution an end-to-end test needs**, which is Idris's point and worth keeping in these words: it
is not a gap in the testing effort, it is the guard working as designed against the thing that would
make such a test easy.

So closing it is a change to the guard's own interface — a sandbox root the shell can pass and the
test can populate — and that change deserves its own review, because a guard that can be told where
the home is has a new way to be wrong.

## Acceptance, each with a control

- the guard takes a sandbox root from its caller, and **refuses one that resolves inside the real
  home** — the existing `GuardOptions.sandboxRoot` already does this; the work is wiring it to
  `bin/uninstall.js` without giving a caller a way to disable the real-home check. **Control:** a
  sandbox root pointing into the passwd home is refused;
- a test populates a sandbox, runs the command's own removal path, and asserts what is gone and what
  is still there. **Control:** reverting the per-path re-check leaves a refused path deleted, and the
  test says so;
- nothing in the test suite can remove anything outside its own `mkdtempSync` tree, under any
  arrangement of environment variables.

## DONE, 2026-09-20 by Kenya

**Wiring:** `OBSRV_TEST_HOME` and `OBSRV_TEST_SANDBOX_ROOT`, gated behind `OBSRV_TEST=1` like every
other test-only knob in this codebase, threaded to both `checkRemoval` call sites in
`bin/uninstall.js` (the listing one and the removal one — a caller passing a real sandbox but
forgetting the second site would have made the acceptance's own control moot). Unset — the normal
case, on every real machine — both resolve to exactly what ran before: `guard.realHomeDir()` and
`sandboxRoot: undefined`.

**New test**, `tests/unit/uninstallRemoveEndToEnd.test.ts`, not CI-only (unlike `uninstallCommand
.test.ts`'s reading arm, which restricts itself to CI because it reads whoever runs it's real home —
this one never does, by construction):
- populates a full sandboxed home (both `remove` directories with nested content, all four
  `removeFiles` entries with content that genuinely parses as Obsrv's own, a same-directory file and
  subdirectory that must survive, and everything in `keep`) and confirms `--remove` takes exactly the
  seven plan entries and nothing else, on real disk, read back afterward;
- a symlink inside a removed tree pointing OUTSIDE the sandbox entirely — unlinked, not followed,
  proven against a real target rather than `uninstallRemoval.test.ts`'s injected `remove`;
- **the card's own control:** a sandbox root resolving inside the real passwd home (`userInfo()
  .homedir`, a nonexistent path under it, never created) is refused at the listing stage — checked via
  the listing's own `refused` entries, since a bad sandbox refuses before `removeListed` ever runs and
  its own JSON has nothing to show for it — and confirmed end to end that `--remove` under the same
  bad sandbox removes nothing;
- one further case, not asked for by this card but built on the same harness: a malformed
  `history.json` sharing the Electron directory is removed anyway today. **That is a real, separate
  gap** — filed as `bug-uninstall-confirm-unenforced.md` rather than fixed here, since implementing
  the actual confirm-check is its own piece of design work.

Every existing uninstall-family unit test (`uninstallCommand`, `uninstallReport`, `uninstallPlan`,
`uninstallRemoval`, `removalGuard` — 65 tests) still green after the wiring change. Full suite: 103
files, 1432 passed, 1 skipped. `npm run typecheck` clean. No leaked `mkdtempSync` directories after
the run (checked `/tmp` directly rather than assumed from the `finally` blocks reading right).
