---
title: "The target canvas goes blank in CI and the app says why — No frames from target renderer"
column: doing
kind: bug
owner: "Kenya"
waiting: "event: a panes:83 failure recurring under #29's screenshot config, which cannot be forced"
order: 35
---

**WAITING, not idle: this card is blocked on a `panes:83` failure recurring under the new trace config (#29), which cannot be forced.** The evidence it needs — the console line naming a GPU process exit, and a screenshot of the blank pane — was never captured on the runs already read, and no re-reading recovers it. Stated here because the board has no `waiting:` field yet (`chore-waiting-field`), and `doing` plus silence is what misled someone this morning.

SPLIT OUT of `bug-flakes-gate-the-gate` 2026-09-15 by Kenya, on Opeyemi's word. **This is the one failure in that card's set with a proven mechanism, and it is the product's own subject matter rather than the harness's.**

## What the failure context says, rather than what the summary line says

`tests/e2e/panes.spec.ts:83` — *"the target canvas shows the page, not a blank"* — failed **both attempts** in run `34988828712`. The assertion is a 10 s poll for white pixels on a canvas that is black when nothing has drawn into it.

The uploaded `error-context.md` carries the app's own UI at the moment of failure:

    - generic [ref=f1e73]: No frames from target renderer

**That is Obsrv's stall notice, not a test message.** Blank target plus *No frames from target renderer* is the documented signature of a lost WebGL context after GPU helper deaths — `docs/gpu-reset.md`, measured 2026-09-08, where the switch-and-recover path was validated.

So this is not a flaky test. **The suite caught the product failing on a loaded macOS runner, and reported it as noise because it was counted rather than read.**

## Why it is its own card

The parent card grouped five failures as one condition. The failure contexts split them:

    panes:83        THIS CARD — lost context, product signature, from the failure context
    vision:47       cause unknown; the failure message discards the channel that decides it
    controls:85     one root, with :109 and :115 as cascades of it — three rows, one failure
    stall:42        the app CLOSED under the test: "Target page, context or browser has been closed"
    devtools:92     already read and carded (bug-devtools-toggle-reopens)

Folding them produced a tally of "three distinct tests defeated the retry" that over-counts cascades and mixes four mechanisms. Each of the others is its own question.

## What is NOT known

- **Whether the GPU helper actually died in this run.** The notice is the app's report of no frames; the console line that names a GPU process exit is not in the uploaded artefact. The signature is documented and consistent, and consistent is not proven.
- **Whether recovery ran.** `docs/gpu-reset.md` describes a switch-and-recover path. Whether it fired here and failed, or never fired, is unread.
- **The rate.** One observation. `bug-sync138-no-url-changed` is the standing lesson on what a handful of observations can carry.

## What would settle it

The console lines from a failing run — a GPU process exit, or a context-lost event — which the current artefact does not upload. That is a harness change rather than a product one, and it is the cheapest next step: the evidence exists at failure time and is discarded.

## A correction to this card's own wording, 2026-09-15

This card first said *the trace*, and **there are no traces.** `playwright.config.ts` sets no `trace`, `screenshot` or `video`, so Playwright's defaults apply and all three are off; `test-results/` on failure holds `error-context.md` and nothing else. Rook found it (room #69); verified here in the tree.

So `ci.yml:91`, the step named **"Upload Playwright traces on failure"**, has uploaded an empty directory on every red run this week and passed — **uploading nothing succeeds.** A green step whose name asserts a capability the config does not provide, which is the same shape as `mcp:137` being counted as noise and `panes:83` being filed as a flake: nobody read it because it was green and its name said what we wanted.

**What that does to this card: nothing, and that is worth stating.** The `No frames from target renderer` line is in `error-context.md`'s page snapshot, which is the one artefact that does exist. The finding stands on the evidence that was actually read.

**What it does to the rest:** the console line naming a GPU process exit — the thing this card lists under *what is not known* — was never going to be in the artefact. That absence is the upload step, **not the app**, and no re-reading of past runs recovers it.


## A local reproduction that does NOT match this card's signature — Rook, 2026-09-16

Running `panes.spec:83` **alone** on current `main`, at `--repeat-each=3` plus a single run:
**4 failures out of 4**, with this card's assertion and figure — `Expected: > 1000, Received: 0`.

That would refute "only a casualty of an already-degraded run", which is the shape suggested by
its never having been the first failure of a CI run. **Two things stop it counting, and both are
mine to declare rather than for a reader to discover:**

- **The machine was not clean.** 43 Obsrv-related processes were alive, including a live app left
  from run 19, another session's app under `/tmp/obsrv-kenya`, and several MCP servers. A blank
  target under GPU contention is a documented Obsrv behaviour (`docs/gpu-reset.md`), so a
  contended machine is an expected cause of exactly this figure.
- **The signature is absent.** CI's snapshot carried the app's own *"No frames from target
  renderer"*. **The local `error-context.md` carries no such line.** Same assertion, same zero,
  no shared evidence of the same mechanism.

So this is **two failures that look alike at the assertion**, and the local one is evidence about
a contended machine rather than about `main`.

**What would settle it:** the same run with no other Obsrv process alive. Not done, because it
needs killing another session's app and the app on Opeyemi's desk, neither of which is mine to
close.

## A `panes:83` recurrence, recorded by Henry 2026-09-17 for Kenya to read (Wren's routing)

Recorded, not interpreted: whether this is the blank-canvas shape is Kenya's call.

- **The run:** 35176357601, **attempt 1**, job `typecheck · unit · shader parity · e2e`, on PR #211, a
  board-only card edit with no code in it. That run's other results: `history.spec:72` flaky, 556 passed.
- **First try, in file order after `:77` had navigated to `hairline.html`:**
  `Timeout 10000ms exceeded while waiting on the predicate`, so the canvas never showed more than 1000
  white pixels in 10 s. **Nothing else was captured for that try:** the artifact holds only its
  `error-context.md`, with no screenshot, no trace and no page snapshot.
- **The retry is not a second sighting.** It failed with `Expected: > 1000, Received: 0`, but `:83` has
  a hidden predecessor. It never navigates, and relies on `:77` having done so. The retry runs it alone in
  a fresh app, so it fails whatever the GPU does. **Its screenshot shows the empty new-tab state** (an
  empty URL field, "Point Obsrv at a page…"), not a loaded page with a blank canvas. So this defect turns
  any single first-try `:83` failure into a red run, which is worth fixing on its own: `:83` should
  navigate for itself.
- **No "No frames from target renderer" or GPU-process-exit line** turned up in the retry trace's console
  or in attempt 1's job log. The job log may not carry the app's stderr at all, so that absence isn't
  proof.
- **Preserved locally** before the artifact expires (2026-09-24 03:18Z), in
  `/private/tmp/obsrv-evidence/panes83-run35176357601-attempt1/`, which a reboot clears:
  - `playwright-traces.zip`, artifact 10478991913, sha256 `5be47313b70f…`;
  - the extracted `:83` folders for both tries;
  - `attempt1-logs.zip`.
  Attempt 1's logs also stay at `…/actions/runs/35176357601/attempts/1/logs` after the rerun.
