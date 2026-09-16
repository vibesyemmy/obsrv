---
title: "The hidden-window capture test passes with the `drawNow` handshake removed, so it cannot catch the regression it was written for"
column: next
kind: bug
order: 54
---

FOUND BY HENRY 2026-09-16, while running the control Wren's `bug-e2e-takes-the-desk` asks for (*"a
planted stale frame must still go red"*). **Unowned.** Not caused by that fix: it holds on `main`.

## Observed, on this desk, one run each

`tests/e2e/live-drive.spec.ts`, *"a capture of a hidden window shows the page now, not the frame
before it went away"*. The sabotage made `flushRendererDraw` in `src/main/ipc.ts` answer at once
without sending `IPC.drawNow`. The built `out/main/index.js` had 0 `obsrv:draw-now` sends against
1 normally, so the sabotage really was in the build.

| build | `drawNow` sabotaged | test |
| --- | --- | --- |
| `main`'s window code and tests | **yes** | **passed** |
| `main`'s window code and tests | no | passed |
| the desk fix | **yes** | **passed** |

**The test was not skipped.** Its `hideEventsFire` probe passed, so the window really was hidden.
It hides the window, navigates from a red page to a white one, and asserts that `captureTarget`
shows white. **It showed white without the handshake that exists to make that true.**

## What that means

The handshake was the fix for a capture measured three navigations behind on a real occluded
window (see the test's own comment). **Today, on this desk, nothing in the suite would notice if
it stopped working.** Candidates for why the test passes anyway, none checked:
- `webContents.capturePage` on a hidden window may make Chromium produce a fresh frame itself;
- `win.hide()` may not stop the app renderer's animation frames the way real occlusion by other
  windows did;
- this desk may differ from the one the stale capture was measured on.

## What a fix has to show first

**A planted stale frame that the test catches**, meaning a setup under which removing `drawNow`
turns this test red, before anything about the handshake is changed or trusted. If no setup
on a real desk makes it red, that is a finding about the handshake too: it may no longer be needed.

## RESOLVED 2026-09-16 by Kenya — the assertion could not fail, and the reply already knew

**The third candidate, and it needed none of the other two to be true.** The test navigated to
`hairline.html`, a `#fff` page, and asserted `green > 150 && blue > 150` — which says only *"not red
any more"*. **A blank capture is white. An undrawn canvas is white. The window's own background is
white.** So the assertion passed whether or not anything had been drawn, and Henry's two candidates
were never needed to explain the green.

**And the capture already said so.** With the handshake gone, `flushRendererDraw` answers `null`,
and `frameCheck.ts:25` puts this in the reply's `warnings`:

    the renderer did not say which frame it drew, so the capture may show an older frame than
    the target painted

The product was reporting its own doubt while the test called the capture fine. A third instrument,
already shipped, already correct, never read.

## What the test does now

- **Navigates to `solid-blue.html`**, so three states separate: red = the stale frame,
  **white = nothing drawn**, blue = the page that is really there. `blue > 150 && red < 100`.
- **Asserts the capture carries no frame-identity doubt.** This is the stricter arm: it fails when
  the handshake is gone *whatever the pixels do*.

The fixture carries a small corner mark, which is not decoration: a page that is one colour end to
end is judged blank by the live capture, which then waits out its settle budget and warns. The mark
makes it an ordinary page and keeps the centre pure blue. Run time went 7.4 s → 4.8 s.

## Measured, both arms, with the sabotage verified in the build (`obsrv:draw-now` sends: 1 → 0)

| build | result |
| --- | --- |
| handshake intact | **passes**, 4.8 s |
| handshake removed | **fails both attempts**, on the warnings assertion |
| whole `live-drive.spec` with it intact | 45 passed, 1 skipped (`focusWindow`, desk-gated — not this test) |

## The part that is NOT resolved, and it is the card's own "what a fix has to show first"

**The pixels were still correct with the handshake removed.** The sabotaged run failed on the
warning, and the colour assertions passed — so on this desk `win.hide()` does not reproduce the
stale frame, and **no colour-based assertion, tri-state or not, can catch this regression here.**

So the card's demand — *a planted stale frame that the test catches* — **is not met.** What is met is
the title: the test no longer passes with the handshake removed. The regression is caught by the
absent acknowledgement, which is a property of the code path rather than of the desk, and that is
why it is deterministic where pixels are not.

**Reproducing an actually stale capture needs real occlusion** — another window covering the app,
not `win.hide()` — which is a desk-taking run and needs Opeyemi's separate word. Until someone does
that, the card's other possible finding stands open: **the handshake may no longer be needed at
all**, and nothing here proves it is. Worth its own card if anyone wants it pursued.
