# Walk the page before measuring it

*Design, 2026-09-08. Follows the live-first agent drive spec (2026-09-07).*

## The problem

A live `obsrv_audit` or `obsrv_lint` measures the whole page from wherever the
window happens to be scrolled — usually the top — and the window does not move
while it does. That is correct: both walks read the DOM, and an element's box
is the same number whether it is on screen or not. It is also, to the person
who installed a window in order to watch, indistinguishable from nothing
happening. The check finishes, the agent reports thirteen footer links at
3.5 mm, and the window has been showing the hero the entire time. The user has
to take the agent's word for it.

An agent driving Chrome scrolls, and the person watching sees it look. That
is the experience live-first was built to give Obsrv, and a check that sits
still gives it away again.

There is a second reason, and it is measured. Some pages mount content on
scroll — sections revealed on `IntersectionObserver`, images swapped in as
they approach the viewport. On those, a walk that never scrolls measures a
page that is not finished. Two pages, same method (audit at the top; walk to
the end a screenful at a time; return to the top; audit again):

| page | before the walk | after it |
|---|---|---|
| ojustudio.com (1366×768) | 35 targets · 122 text · 18 findings | identical |
| usekolo.app (1366×768, app shell) | 30 targets · 157 text | **37 targets · 173 text** |

usekolo reveals sections on scroll: seven targets and sixteen text elements
exist only once the page has been walked, and a top-only audit never sees
them. So the walk changes what is measured on such pages, which is why the
result must record whether one happened (§4) — two runs that disagree are
then explicable rather than mysterious.

## 0. A bug the measurement exposed — fix first

Measured *while the page was at the bottom*, the usekolo audit reported 11
targets, 78 text elements and a `pageHeight` of **768** on a 7,445 px page;
the lint's contrast findings went from 19 to 1. That is not the page; that is
the walk discarding everything above the fold.

The cause is in `src/shared/audit.ts:90-101` and `src/shared/lint.ts:111-121`.
Both walks compute page coordinates as `rect.top + window.scrollY` and reject
an element as "parked off the page" when `rect.bottom + window.scrollY <= 0`.
In an app shell the window never scrolls — the inner container does — so
`window.scrollY` is 0 at every scroll position, every element above the fold
has a negative `top`, and the walk drops it. `pageHeight` then collapses to
whatever is on screen.

The headless capture knew: `src/cli/main.ts:426` resets the scroll host to 0
before the walks, with the comment *"their rects are measured against a
scroller at the top."* The live `audit` and `lint` dependencies in
`src/main/ipc.ts:1518-1546` call the walks directly, with no reset. So a live
audit or lint of an app shell that has been scrolled — by the user, or by an
agent's `scroll` — has reported wrong numbers since live audit shipped in
0.29. It went unnoticed because measurement usually follows navigation, and
navigation lands at the top.

**Fix it in the walks, not around them.** Both already know the scroll host
(`clipTest(rootScrolls() ? null : findScroller())`, from the panel-findings
work). Page coordinates for an element inside that host add the host's
`scrollLeft`/`scrollTop`; the "off the page" test uses the same corrected
numbers. Then a measurement is correct at any scroll position, live or
headless, and the headless reset becomes belt and braces rather than the only
thing standing between a user and a wrong answer. This is a correctness fix
that stands alone — it depends on nothing else here — and is Task 0 of the
plan, shipping in the same release as the walk.

The walk in this spec returns to the top before measuring (§2), which would
mask the bug. That is not a reason to leave it: an agent's own `scroll`
before an `audit` hits it today.

## Decision

Before a live `obsrv_audit` or `obsrv_lint` measures, it walks the page a
screenful at a time to the end, then returns to the top and measures. The
person watching sees the whole page pass; the measurement is what it was. It
is on by default, off by a flag, and it never applies where there is nothing
to watch.

## Non-goals

- Walking in headless mode. Nothing is watching; `walk` is ignored with a note.
- Walking for `obsrv_inspect` (a point query — scrolling to measure one element
  would be strange) or `obsrv_snap` (one screen, by definition).
- Changing what the audit or lint *measure*. §0 corrects the walks'
  coordinates, which is a bug fix; the walk of this spec happens before them
  and changes nothing they report.
- A new control command. This is orchestration of `scroll { page: "next" }`,
  which the app has had since 0.41.0.

## 1. Where it lives

In the MCP server, in `liveAudit` and `liveLint` (`src/mcp/server.ts`), as a
shared `walkPage(info)` helper called after navigation and before the `audit`
/ `lint` control call. Not in the app: the app already exposes everything the
walk needs, an MCP-side walk needs no app release, and — the deciding reason —
the npm server and the DMG app update independently. An orchestration over an
existing command survives that skew; a new command does not.

## 2. The walk

```
scroll { page: "top" }
repeat up to WALK_MAX_SCREENFULS:
    scroll { page: "next" }          → { scrolled, atEnd }
    dwell WALK_DWELL_MS
    stop when atEnd
scroll { page: "top" }
measure
```

- `WALK_MAX_SCREENFULS = 12`, the same cap the full-page capture uses
  (`MAX_TILE_BANDS`). An infinite-scroll feed stops there and the result says
  so.
- `WALK_DWELL_MS = 350`. The `scroll` command already waits for the pane to
  confirm the offset; the dwell is on top of that, so a person's eye can land
  on each screenful. Measured on usekolo.app: nine screenfuls in 2,843 ms,
  about 320 ms each all-in — the dwell is nearly the whole cost, the scrolls
  themselves are near-instant. A twelve-screenful cap is about four seconds.
  Whether 350 reads as watching or as flicker is a judgement for a person
  watching it (§6).
- The walk ends at the top. With §0 fixed, measuring at any position is
  correct, so this is for the person watching: a `highlight` that follows
  maps through the current scroll, and "the page is where you left it" holds
  only when it was left at the top: a walk returns the page there and may
  close a menu, so an agent that wants to measure a driven scroll position or
  an open menu as it stands passes `walk: false` (§3), and one that wants to
  talk about a footer finding drives `scroll` there itself, as it does today.

## 3. The flag

`walk: boolean`, default `true`, on `obsrv_audit` and `obsrv_lint`.

- `true` (default) in live mode: the walk runs.
- `false`: no walk. For an agent re-measuring after a fix that does not need
  the page shown again, and for anyone who finds it slow.
- Any value in headless mode: ignored, with a note (`walk is live-only; there
  is nothing to watch in a headless render`).

## 4. What the result says

The live result gains:

```
walked: { screenfuls: 7, atEnd: true, ms: 4820 }
```

`atEnd: false` with `screenfuls: 12` means the cap stopped it, and the note
says so. Absent when the walk did not run, whichever the reason. This is the
field that makes a difference between two runs explicable: if a lazy-loading
page reports more elements after a walk than before, the reader can see that
one run walked and the other did not.

## 5. Version skew and failure

- **Older app.** An app that predates `scroll.page` (before 0.41.0) answers
  the first `scroll { page: "next" }` with a 400. The walk stops, the
  measurement proceeds, the result carries no `walked` and a note: `the app
  predates page-wise scrolling (0.41.0); measured without walking`. A walk
  must never fail an audit.
- **The scroll does not confirm** (`scrolled: null`, a busy or navigating
  page). Treat as the end: stop walking, return to top, measure. Note it.
- **The page navigates mid-walk** (a click handler on scroll, a redirect).
  The `status` after the walk names a different URL than before; the
  measurement is of whatever is there now, and the result says the URL moved.
  This already happens today without a walk and is not made worse by one.
- **The budget.** A walk is at most `WALK_BUDGET_MS = 15_000` of wall clock:
  each scroll has a 5 s apply timeout and there are up to fourteen, which
  unbounded would put a live audit past the MCP client's 60 s default. Past
  the budget the walk stops, `atEnd` is false, and the note says so.
- **The page will not move.** A `next` that lands where the page already was,
  when the app does not say `atEnd`, is a locked scroll (a modal, a menu) or
  a page that scrolls by other means: the walk stops, `atEnd` is false, and
  the note says the page stopped moving. When the app does say `atEnd` it is
  a one-screen page: zero screenfuls, at the end, no note.

## 6. Risks, to be measured

1. **Dwell.** 350 ms is measured for cost (§2) but not for feel. Watch a walk
   on a real page and decide. Too fast and it is a flicker; too slow and a
   twelve-screenful page is a long wait for a number that was available at
   once.
2. **Animating pages.** The `scroll` command's settle already handles a page
   that never goes quiet (it exits early as `animating`). Confirm a walk over
   ojustudio.com — which animates continuously — does not pay a full settle
   per screenful.
3. **Sticky chrome.** A page with a sticky header shows it at the top of
   every screenful. That is what scrolling shows a person too, and the walk is
   for a person; no hiding here (unlike the full-page capture, which is a
   stitched artefact).

## 7. Testing

- **§0, browser** (`tests/browser/audit.test.ts`, and lint's): an app-shell
  fixture with the inner scroller scrolled down by a known amount. Every
  element's page-space `y` must be the same as when the scroller is at 0, and
  nothing above the fold may be dropped. This is the test that would have
  caught 0.29.
- **§0, e2e** (`tests/e2e/live-drive.spec.ts`): `scroll { page: "bottom" }`
  on the app-shell fixture, then `audit` — `pageHeight` and the target count
  must match an audit taken at the top.
- **Unit** (`tests/unit/mcpLib.test.ts` or a new `walk.test.ts`): the walk
  loop against an injected `controlCall` — stops at `atEnd`, stops at the
  cap, stops on `scrolled: null`, stops and notes on a 400, always returns to
  the top, reports `screenfuls`/`atEnd`/`ms`.
- **E2E** (`tests/e2e/mcp-live.spec.ts`): `obsrv_audit` on the tall fixture
  returns `walked` with the expected screenful count and `atEnd: true`, and
  the app's scroll is at the top afterwards; `walk: false` returns no
  `walked`; the measurement (`summary` counts) is identical with and without
  the walk on a fixture that does not lazy-load — which is the guarantee that
  the walk changes what is seen, not what is measured.
- **Skill**: one sentence in the review loop: audits walk the page before
  measuring, so the user sees it; pass `walk: false` to re-measure quietly.

## 8. Measured

Watched on 2026-09-08 against the branch build (unpackaged, its own
profile), driven by the built MCP server, preset 1080p-24, the default
`walk`:

| page | walked | per screenful | measured after |
|---|---|---|---|
| usekolo.app | 9 screenfuls, at the end, 3,207 ms; the whole call 6,096 ms | ≈356 ms | 39 targets · 177 text · 10 findings · pageHeight 10,178 |
| ojustudio.com | 5 screenfuls, at the end, 1,789 ms; the whole call 3,390 ms | ≈358 ms | 35 targets · 122 text · 18 findings · pageHeight 5,983 |

Two of §6's risks are answered. The dwell is nearly the whole cost of a
screenful: a scroll round-trip is a few milliseconds over the 350 ms, on
the page that animates continuously as much as on the one that does not —
so `scroll` does not pay a full settle per screenful (§6.2). ojustudio's
numbers are the ones a top-only audit gave in §"The problem", which is the
guarantee the walk changes what is seen and not what is measured; usekolo's
are the walked ones, on a taller viewport. Neither walk came near the
twelve-screenful cap or the 15 s budget (§5), and no note was raised.
Whether 350 ms reads as watching or as flicker (§6.1) is the person's call
who watched it; the constant stays until they say.
