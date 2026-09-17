---
title: "An address typed while the toolbar's last navigation is still resolving is overwritten by its answer, and Enter re-sends the old one"
column: review
owner: "Henry"
waiting: "Wren: the cold read of the fix PR, then Henry merges"
kind: bug
criterion: B5
order: 73
---

FOUND BY KENYA 2026-09-17 (room #364), reading shape 1 of `chore-flaky-leaders-0917` (`panes:230`/`:259`).
Filed and claimed by Henry, routed by Wren, while Kenya is away.

**The defect.** `Toolbar.go()` awaits `window.obsrv.navigate(url)`, then runs `setUrl(applied); setDraft(applied)`.
`submit` sends `draft` (React state), not the DOM value. If the answer lands after the user has typed a new
address, it replaces the typing, and the next Enter re-sends the address already showing. That's a no-op:
nothing loads and nothing fails, so no error state appears.

**Measured by Kenya:**
- **Arm A:** a good navigation, then a failing one. 6/135 misses (4.4%).
- **Arm B:** a failing navigation after a failing one. 0/135 (Fisher p = 0.030). Arm B is clean because
  its overwrite writes the same bad address back.
- **Two misses traced** with `NativePane.loadTrace()`: the bad host was never asked for.
- Her arms are on `probe/error-state-latch`.

**The product rule already exists:** `panes:188` stops an *incoming* navigation from clobbering typing. The
answer to a navigation *we* started does the same harm. Typing after a submit wins.

**Plan:**
- `go()` writes the answer into the field only while the draft is unchanged since that navigation started.
  `setUrl` stays.
- `EmptyState`'s form doesn't have the pattern: it never writes the draft back, and `busy` disables submit
  while a navigation is in flight.
- **Test (`panes.spec`, desk-safe):** a local route holds the navigation's response. The test types a new
  address, releases the response, and asserts that the field keeps the typing and that Enter navigates to
  the typed address.
- **Control:** today's `go()` must fail.
- Kenya's arm A should drop to 0/135.

## In review 2026-09-17: the fix, and what does and does not measure it

- **The fix (`Toolbar.tsx`):** `go()` records the draft when its navigation starts, in a ref that holds the
  current draft rather than the render's closure. It writes the answer into the field only if the draft is
  unchanged when the answer arrives. `setUrl(applied)` is kept. All three callers stay right: Enter, a
  keyboard-picked history entry, and a clicked history match.
- **The evidence is the deterministic test (`panes.spec`):** a local route holds the navigation's response,
  the test types a new address and releases, and both panes finish loading. The typing must then survive a
  sustained 750 ms, and Enter must navigate to it.
  - With the fix: passes (2.7 s).
  - **Control, today's `go()`:** red at "the answer to the held navigation overwrote the typing" on all 3
    repeats, with the field holding the held URL.
  - The whole `panes` file: 13 passed.
- **Kenya's arms don't measure it here, and that's stated rather than claimed:** at her full 135 each,
  arm A on the fix was 0/135 and arm B 0/135. **But arm A on today's unfixed `go()`, run just after on
  the same machine, was also 0/135.** The miss didn't reproduce in this environment, so the rate arms
  can't show the fix working. Kenya's 6/135 was measured in her run's conditions. **The held-response test
  is what shows it.** The arms remain a rate check for CI's `panes:230`/`:259` recurrences over the next
  runs.

