---
title: "Nothing exercises obsrv uninstall --remove against a real filesystem"
column: backlog
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
