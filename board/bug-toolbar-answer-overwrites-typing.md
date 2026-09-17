---
title: "An address typed while the toolbar's last navigation is still resolving is overwritten by its answer, and Enter re-sends the old one"
column: doing
owner: "Henry"
waiting: ""
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
