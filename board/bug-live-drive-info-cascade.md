---
title: "One live-drive failure takes the rest of the file down, and its error blames a filtered run"
column: next
kind: bug
order: 43
---

FILED 2026-09-16 by Henry, from reading main's red run `35074542775` (09-16 08:34Z, `1c054a7`)
for `bug-ci-main-red-37pct`. **Unowned.**

## What happened

`live-drive.spec.ts:776`, *a capture of a hidden window shows the page now*, failed its first try
on a black centre pixel (`Received: 0`, expected above 200) in the capture taken **before** the
window was hidden. Its retry failed in 347 ms, and ten later tests (`:816`, `:840`, `:855`,
`:874`, `:899`, `:914`, `:922`, `:943`, `:969`, `:1088`) failed **both** tries in 2–5 ms each,
all with:

    info (the control port and token) was never established: this file's first test did not
    run in this suite. A filtered run (-g / -t) skips it, so this is the run, not the code — run
    the file whole to exercise this test.

The tally says eleven failed tests. **It is one failure and ten cascades.** The file recovers only
at `:1119`, whose test reads the control file again.

## The mechanism

`info` is a module variable assigned **inside the file's first test** (`live-drive.spec.ts:105`,
*writes a 0600 discovery file*), not in `beforeAll` (`:86`). After any failure Playwright replaces
the worker. The new worker runs `beforeAll` again (a fresh app) but not that first test, so `info`
is undefined for everything that follows. **No retry of a test after the first can pass in this
file**, and every test after a failure fails whatever its own code does.

The cascade was known: `bug-resizing-test-flaky-ci` says *"Rook's `established.ts` makes that
cascade LEGIBLE; it does not stop it."* That card closed on the resizing verdict, and the cascade
stayed.

## Why the message makes it worse, not only legible

`established()` (`src/shared/established.ts`) names **one** of the two ways `info` goes missing:
a filtered run, which is how the cascade was reproduced when the message was written. In CI the
file runs whole and the first test **did** run, in the worker that was replaced. So after a real
failure, the harness tells the reader that ten red tests are *"the run, not the code"*.
**A sentence keyed off one of two facts**, which `CONTRIBUTING.md`'s *Writing it down* warns
about, in the harness that checks the product's sentences.

## What a fix has to decide

- **Establish `info` in `beforeAll`**, read from the control file after launch, so every worker
  has it. The first test then asserts the file's properties (mode, pid) without producing state
  other tests depend on. That stops the cascade and makes a retry in this file mean something.
- **Or name both causes in the message**: a filtered run, or a worker replaced after an earlier
  failure. That keeps the cascade and stops the misdirection. It is the smaller change and the
  weaker one.
- **Other specs:** whether any other file sets shared state in a test instead of a hook. Not
  swept.

**Control for either:** fail `:776` on purpose and run the whole file with retries on. Before the
fix, eleven tests are red. After a `beforeAll` fix, one is.

## What `:776` itself was

Not read beyond its assertion: a black centre in a capture of a *visible* window, once, on main.
It may belong with `bug-target-canvas-no-frames` (the target canvas blank in CI). Not established.
