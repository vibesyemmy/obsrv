---
title: "the recorded scroll lags a scroll the page makes within 120 ms of an agent scroll, so pageRect is wrong for that long"
column: backlog
kind: bug
order: 124
---

FOUND 2026-10-03 by Idris on `main` (room `#3196`), as one first-attempt failure of
`flow-selector-click.spec.ts:270` in the merge suite of `#545` (run `37158995878`), and **measured by Dogu the
same night**, after a first measurement of the wrong sequence had said it did not reproduce (the story is on
`bug-selector-click-over-scrolls-under-text-scale`).

## What happens

The app keeps a record of the target's root scroll (`TabSession.targetScroll`). `inspect` builds its `pageRect` as
`rect` plus that record, and the selector click derives where the page is from `pageRect - rect`. The record is
set exactly when the app scrolls the page itself (`ipc.ts`, the landing of a `scroll`), and otherwise fed by the
target preload's scroll reports.

Those reports are **deferred by up to 120 ms after an app-applied scroll** (`src/preload/sync.ts`, `SUPPRESS_MS`:
a window that stops the other pane's echo from being mirrored back). A scroll the *page* makes inside the window,
by its own script, an anchor, a restore, or a person, reaches the record only when the window ends. For that
time `pageRect - rect` is the app's earlier position, not the page's.

**Measured** (scratch spec on the fixture, not committed): app scroll to 1500, then `window.scrollTo(0, 0)` after a
delay, then how long until the record equals the page's real `scrollY`, 12 runs per delay: delay 0 ms: caught up
after 111-122 ms; 40 ms: 73-81; 80 ms: 36-42; 110 ms: 10-23; 125 ms and later: 1-34 ms (a frame). Back to back with no
wait: **400 of 400 reads stale**. The lag is `max(120 ms - delay, one frame)`, and it never failed to catch up.

## Why the first look missed it

The first measurement scrolled the page with `window.scrollTo` at rest, 40 reads at three text scales, all
agreeing within 2-12 ms. With no app-applied scroll in the previous 120 ms there is no window open, and the page's
scroll is reported on the next frame. The sequence that matters, an app scroll followed within 120 ms by a
page-level one, was not in it.

## What it touches

- **`obsrv_inspect`'s `pageRect`** (a published field): wrong by the size of the page's scroll, for up to 120 ms
  after an agent scroll, with nothing in the reply saying so.
- **A selector click** aims from `pageRect - rect`. With the record stale it over- or under-scrolls and then
  **refuses**, naming the geometry (`"…" is still outside the … viewport after scrolling to …`). A refusal, not a
  wrong press: the bound the flow card relies on holds.
- Anything else that reads `targetScroll` as the page's scroll: `ipc.ts` passes it to two other consumers, which I
  did not trace.

Exposure needs a page-level scroll inside the window. How often a real flow does that is **not measured** (a step's
own settle may well outlast 120 ms); a test that resets the page's scroll with `window.scrollTo` right after a flow
does it easily, which is how CI found it.

## Release class

`release:` is **left unset on purpose**. By `docs/release-gate.md` a value in a published field that a caller cannot
tell is wrong is the first class; against that, the window is 120 ms, it needs the page to scroll itself inside
it, and the selector click turns it into a refusal. Whether that is `later` or `disclose` is the Lead's call, and
the card says it is not decided rather than defaulting to the lower one.

## What would fix it (not decided, not built)

- **Read the scroll in the same instant as the rect.** `inspect`'s page script reports the root scroll alongside the
  box, and `pageRect` is built from the page's own number, not the record. No published shape moves (`pageRect`
  exists); it is an internal report field, so the page script, the parser and the readout change together.
- Or let the preload report a page-level scroll to the record immediately and keep the 120 ms deferral only for the
  *mirror* the echo window exists to protect.
- Either way, the spec's `reset()` should scroll through the app (`call('scroll', { x: 0, y: 0 })`) until the product
  is fixed, as `flow-selector-click-text-scale.spec.ts` does; that is a test change and hides nothing the card
  does not say.

## Acceptance

- a test that scrolls through the app and then at the page level, with no wait, and reads `pageRect - rect` equal
  to the page's real `scrollY` (today: 400 of 400 reads are stale);
- that test, sabotaged by restoring the record as the source, fails;
- `flow-selector-click.spec.ts:270` stops failing first attempt for this reason.
