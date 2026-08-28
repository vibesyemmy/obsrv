# Obsrv — visited-URL history in the URL bar

**Date:** 2026-08-28
**Status:** Approved 2026-08-28
**Extends:** `2026-08-27-obsrv-toolbar-design.md` (the URL bar sits in row 1 of the
chrome) and `2026-08-28-obsrv-pane-split.md` (the split ratio the dropdown is clamped
against).

## The problem

Chromium's back/forward is per-session and dies with the window. Nothing survives a
relaunch, so every session begins by retyping the same handful of URLs —
`http://localhost:4173`, a staging host, the one production page being compared. The
app is used by returning to the same small set of addresses over and over, which is
exactly the case a persistent history serves best.

## Design

Type-ahead in the URL bar. No history screen: the list of addresses this app is
pointed at is small and revisited, so matching against what you type is the whole
win, and a separate browsable surface would be more to build and maintain than the
problem justifies.

### Storage

`history.json` in the app's userData directory, beside `settings.json` and validated
in the same style — every field checked on load with a fallback, a malformed file
treated as empty rather than fatal.

An entry is `{ url: string, visits: number, lastVisit: number }`. No title: the list
shows URL and relative age, and a title is a second piece of state to keep fresh for
no gain in a tool whose URLs are self-describing.

**Capped at 500 entries, least-recently-visited evicted first.** The file is read and
written whole, so it needs a bound; 500 is far beyond what this app's usage produces
and small enough to parse instantly.

No database. A dependency to hold a dev tool's URL list would cost more than it
returns.

### What is recorded

Committed **main-frame** navigations in the native pane, which is already the
navigation master and already emits `did-navigate` for `SyncBus` to mirror.

Deliberately excluded:

- **Subframe navigations** — not pages the user went to.
- **In-page navigations** (`did-navigate-in-page`) — hash and history-API changes would
  bury real entries under dozens of near-identical rows.
- **Failed loads.** Chromium commits its error page, so recording naively would store
  the address of something that did not load, and offer it back as a suggestion.

**Agent-driven navigations are recorded.** Agent control drives the window the user is
watching — it is the same session, and the user saw it happen. Excluding them would
need explaining every time someone wondered why a page they watched load was missing.
The cap and the clear button handle volume.

### Matching and ranking

Case-insensitive substring match against the URL. Ranked by recency, with visit count
breaking ties, so the address you use constantly stays at the top without a stale
favourite outranking what you were looking at ten minutes ago. **Six rows maximum** —
past that, a longer list is a worse tool than a better query.

Relative ages reuse `formatAge` from `src/shared/update.ts` rather than growing a
second time formatter.

### Keyboard

- **Down** opens the list, and moves through it.
- **Up** moves back through it.
- **Enter** navigates to the highlighted row, or to the typed text when nothing is
  highlighted.
- **Escape** closes the list. A second Escape reverts the draft, which is what Escape
  does in the URL bar today — closing the list must not consume that.

### The overlay constraint, and the clamp

The dropdown hangs below the URL bar, which puts it over the panes — and the native
pane is an OS-level `WebContentsView` that paints over anything the renderer draws
there. The URL field starts near x=120, so a list anchored to it would be entirely
beneath the native view and invisible. This is the same constraint that forced the
overflow menu rightward.

**The list's left edge is clamped to the native pane's right edge.** It is always
visible, and in solo target — where there is no native view — it aligns with the field
exactly. The cost is cosmetic: with a wide native pane the list sits offset from the
field it belongs to.

The alternative considered and rejected was hiding the native view while the list is
open, using the existing `setNativeVisible`. It aligns perfectly and causes no reflow,
but the left pane would blank to surround on every keystroke that matches — a constant
irritation traded for a static cosmetic one.

The split is already published to CSS as a custom property by the pane-split work, so
the clamp is a style rule rather than a new measurement. In solo target the clamp must
collapse to zero.

### Privacy

Mirrors the update check, which is the app's established stance on anything that
records or transmits:

- **On by default**, because a history that is off by default is a feature nobody
  finds.
- **A Settings toggle** stops recording. Existing entries are kept — stopping and
  erasing are different intentions.
- **A Clear history button** in Settings empties the file.
- Nothing leaves the machine. There is no sync, no telemetry, and no network path of
  any kind out of this feature.

## Out of scope

A browsable history drawer or page, per-entry deletion, search over titles, favicons,
and exposing history on the agent-control surface. An agent that wants a URL already
has it.

## Test plan

**Unit** — the pure module: add and update an entry, recency-and-visits ranking, the
500-entry cap evicting the least recent, substring matching, a malformed or absent
file loading as empty, a round trip through save and load.

**E2E** — typing shows matches; Enter on a highlighted row navigates; Down/Up move the
highlight; Escape closes the list and a second Escape reverts the draft; a failed load
is not recorded; an in-page navigation is not recorded; the toggle stops recording;
Clear empties the list; the list's left edge never falls left of the native pane's
right edge, at a wide split and in solo target.
