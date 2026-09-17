# Which notes have been seen to fire

C5 asks that every note the tool can emit has been *seen to fire on a real page*. This
file is the standing answer: what the tool can say, and which of those sentences anything
has ever watched happen.

The distinction it keeps is the one `unsettledReason: 'resizing'` made concrete. That value
was legal in the snap schema, asserted legal by `tests/e2e/mcp.spec.ts:472`, and produced by
no run anyone had seen — a name for a state the project believed in and had never observed.
A schema entry is a claim about the world; a test that asserts the entry is *legal* is a claim
about the schema. Only a run that produced it is evidence.

## Method, and what it cannot tell you

Emitted notes were collected mechanically: every `warnings.push(...)`, `warn(...)` and
`notes.push(...)` call site in `src/`, captured with balanced parens so multi-line and
template notes come through whole. That yields **58 call sites**, 17 of them on the live
surface (`src/main`, `src/preload`).

Matching those against the suite by text is a **sieve, not a verdict**, and it undercounts:
tests assert notes through regexes and partial phrases, so an automatic phrase match misses
real coverage. It is recorded here only to say where to look next. The live-surface rows
below were checked by hand instead.

Text matching also cannot answer the actual question. A unit test that feeds a note builder
its arguments proves the sentence can be *constructed*; it does not prove any page produces
the state. Where this file says **observed**, it means a run against a real page in the real
app produced it.

## The live surface, checked by hand

| note (`src/`) | in tests | observed on a page |
| --- | --- | --- |
| `ipc.ts:1605` the target was still resizing | yes — both directions | **yes**, 2026-09-14, below |
| `ipc.ts:1607` the page keeps painting steadily | yes, e2e ×3 | yes — `live-drive.spec.ts:954` |
| `sync.ts:182` scrollSelector matched no element | yes, e2e ×2 | yes |
| `ipc.ts:1603` renderer has not reported the pane bounds | no | no |
| `ipc.ts:1604` renderer has not reported the render bounds | no | no |
| `ipc.ts:1606` the page was still painting at the budget | no | no |
| `ipc.ts:1610` the onion skin is blending two frames | no | no |
| `ipc.ts:1647` the raster is the target's own frame | no | no |
| `ipc.ts:1238` could not write history.json | no | no |
| `ipc.ts:1333` could not save tabs | no | no |
| `ipc.ts:1390` could not restore a tab | no | no |
| `ipc.ts:1550` agent-apply queue full before the renderer mounted | no | no |
| `ipc.ts:1995` agentConsent(true) with no request outstanding | no | no |
| `targetSource.ts:403` target renderer gone | no | no |
| `syncBus.ts:145` navigation mirror loop broken | no | no |
| `sync.ts:167` scrollSelector is not a valid CSS selector | no | no |
| `sync.ts:175` scrollSelector matched an element that could not scroll | no | no |

Three of seventeen have any contact with the suite. The rest are sentences the app is
prepared to say and nothing has heard it say. Several are genuine failure paths (a renderer
crash, a disk write that failed) where provoking the state is the work; that is the work,
not a reason to call them covered.

## `unsettledReason: 'resizing'` — observed 2026-09-14

Added the same day the criterion was being argued about, admitted by the snap schema, and
never seen. It fires, and the shape is narrower than the card assumed.

    fixture   tests/fixtures/solid-red.html (static — nothing on the page moves)
    driver    control `setPreset` cycled over EIGHT distinct viewports, continuously
    capture   control `captureTarget`, fired 400 ms into the cycle
    result    settled: false, unsettledReason: "resizing"
              + "the target was still resizing when the capture budget ran out..."
    runs      3 of 3, ~8.1 s per capture, ~183 confirmed preset applies each

**Two presets are not enough.** `settleTarget` (`src/main/ipc.ts:1093`) ends on two *equal*
consecutive 80 ms viewport reads inside a 4 s budget. Alternating between two sizes gives
each pair of reads a coin-flip chance of agreeing, so the loop exits `settled` almost at
once — measured, 30,000 flips deep, and the capture came back `animating`. Eight sizes in
rotation keep consecutive reads disagreeing across the whole budget, which is the only path
to `'resizing'` at `ipc.ts:1105`.

So the state is not "a capture that caught a resize". It is the viewport changing on
essentially every read for four continuous seconds: a window dragged by its corner while a
capture runs, or a script flipping presets in a loop. Rare, reachable, and now pinned by
`tests/e2e/live-drive.spec.ts` — which asserts it fires under that cycle and, three tests
later, that a merely animating page does **not** get blamed for resizing. That negative
assertion predates this work and guards c1a518c; the pair is what the note needed.

Note for anyone running that spec: `info` (the control port and token) is set by the first
test in the file, so a `-g` filtered run of a single test fails with
`Cannot read properties of undefined (reading 'token')`. Run the file.

## Observed in the e2e suite, measured — 2026-09-17

**What changed about the method.** The rows above were checked by hand. This section is a
measurement instead. A probe branch (`probe/c5-note-log`, never merged) logged every string in a
`notes` or `warnings` array of every reply the three surfaces sent: CLI JSON, MCP tool results, and
agent-control replies. The whole e2e suite ran on CI (run `35166342003`, 558 passed). Each logged
sentence was then attributed to **the longest string literal in `src/` (at `87c835a`) that it contains**,
so the location below is where the sentence is written, not where it is pushed.

**What it can and cannot tell you.** A row means a run of Obsrv (the app, or a headless CLI render
for `cli`-only rows), against a page the suite serves, produced that sentence. That's what this file
calls observed. **The net caught only `notes`/`warnings` arrays in replies.** A sentence that reaches
only the CLI's stderr, only the app's UI, or only the log file is outside it even when it fires, and
**whether such producers exist hasn't been checked**. The absence of a row is not evidence a note is
unreachable. Line numbers are `87c835a`'s. One suite run, so a count is how often a sentence fired in
that run, not a rate. `<n>` and `<path>` stand for numbers and paths.

**Placement was checked, not assumed** (Wren's read). A row is placed at the longest literal the
sentence contains. When that literal occurs more than once in `src/`, or another literal of the same
length also matches, the row is marked **ambiguous** and names the other locations: 3 rows.
**Reach** marks the rows no user sees: one fires only because the suite sets `OBSRV_TEST`, one only in
the dev lane.

**57 rows fired** across 110 distinct sentences and 301 replies that carried at least one. **55 of the rows are ones a user can see.** 3 of those are ambiguous between producers, so the number of distinct producers behind the 57 rows is between 57 and 61:

| written at | fired | surfaces | reach / placement | the sentence, shaped |
| --- | --- | --- | --- | --- |
| `src/cli/audit.ts:159` | 1 | cli | user | no screen diagonal, so no millimetres: pass --diagonal <inches> with custom dimensions, or use a pre… |
| `src/cli/audit.ts:35` | 1 | cli | user | <n> more findings past the <n> listed; the summary and the groups count them all |
| `src/cli/capture.ts:317` | 6 | cli, mcp | user | page kept painting steadily for <n> ms after its first full frame (animation or video); capturing th… |
| `src/cli/capture.ts:332` | 1 | cli | user | page kept painting for <n> ms (animation?); capturing the current frame |
| `src/cli/lint.ts:514` | 25 | cli, control, mcp | user | <n> text element sits on an image or gradient and got no contrast verdict: the pixels under it are n… |
| `src/cli/lint.ts:521` | 1 | cli | user | <n> images are a file of a pixel or two on a side stretched into a gap — a spacer, not a picture — a… |
| `src/cli/main.ts:257` | 5 | cli, mcp | user | load did not finish within <n> ms under --throttle <n>g: <path> — measured the page as it stood; a p… |
| `src/cli/main.ts:393` | 1 | cli | user | load did not finish within <n> ms under --throttle <n>g (a slow load is what a throttle is for): <pa… |
| `src/cli/main.ts:533` | 2 | cli | user | hid chrome stuck inside the scroller for the bands after the first: div#toolbar (sticky, <n> px) |
| `src/cli/main.ts:562` | 1 | cli | user | this page hides the document's overflow and scrolls nothing the capture can reach — no scrollable co… |
| `src/cli/main.ts:570` | 1 | cli | user | the document itself does not scroll — this page keeps its content in an inner scroller <n> CSS px ta… |
| `src/cli/main.ts:630` | 2 | cli | user | hid chrome stuck to the viewport for the bands after the first: header#fixed-bar (fixed, <n> px), di… |
| `src/cli/main.ts:649` | 2 | cli | user | full page is <n> CSS px tall; clamped to <n> (device pixels are capped at <n> per axis) |
| `src/cli/main.ts:676` | 1 | cli | user | the page had not taken the <n> CSS px surface within <n> s, so whether it lays out against the viewp… |
| `src/cli/main.ts:688` | 2 | cli | user | this page lays out against the viewport height — on a surface <n> CSS px tall it is <n> CSS px, agai… |
| `src/cli/main.ts:881` | 1 | cli | user | the panel profile (budget-tn) is not applied to a diff: the comparison is about rasterisation and is… |
| `src/main/controlServer.ts:592` | 1 | control | user | the page rect is off screen at the current scroll (<n>, <n>); scroll it into view first |
| `src/main/frameCheck.ts:23` | 4 | control, mcp | user | the pane may show an older frame: the renderer drew frame <n>, the latest sent to it is <n> |
| `src/main/ipc.ts:1145` | 15 | control, mcp | user | the frame is one colour end to end and stayed that way for the capture's <n> ms: the page painted it… |
| `src/main/ipc.ts:1699` | 1 | control | user | the target was still resizing when the capture budget ran out; the PNG may show a transitional frame |
| `src/main/ipc.ts:1701` | 1 | control | user | the page keeps painting steadily (animation or video); this is one frame of it, taken after two seco… |
| `src/mcp/lib.ts:416` | 3 | mcp | user | this call waited <n> s for a render slot: the server runs at most <n> headless renders at once (OBSR… |
| `src/mcp/lib.ts:430` | 1 | mcp | user | this call waited <n> s for Electron <n>.<n> to download: the first headless call after an install do… |
| `src/mcp/lib.ts:576` | 1 | mcp | dev-only: the dev lane | the dev app was relaunched to run the lane's current build: it had started before that build was mad… |
| `src/mcp/lib.ts:617` | 21 | mcp | harness-only: fires because the suite sets `OBSRV_TEST` | the Obsrv app is not running and cannot be launched here (OBSRV_TEST=<n> is set (the e<n>e harness m… |
| `src/mcp/lib.ts:680` | 1 | mcp | user | fullPage is headless-only; rendered headlessly instead of driving the app. |
| `src/mcp/server.ts:1054` | 1 | mcp | user | the app did not confirm the navigation before capture; the PNG may show the previous page. |
| `src/mcp/server.ts:1251` | 1 | mcp | user | the PNG is <n> MiB, over the <n> MiB inline cap, so it is not inlined; read the file at <path> or re… |
| `src/mcp/server.ts:1486` | 19 | mcp | user | `groupsOnly` left the per-finding list out on request: `findings` is empty and `truncated.findings`… |
| `src/mcp/server.ts:1528` | 2 | mcp | **ambiguous**, same literal at `src/mcp/server.ts:1832`, `src/mcp/server.ts:2516` | `preset` is headless-only and was ignored in live mode; the app's own screen was used. |
| `src/mcp/server.ts:2400` | 1 | mcp | user | the tab was still loading after the preset change when the settle budget ran out; the status, and an… |
| `src/mcp/walk.ts:113` | 4 | cli, mcp | **ambiguous**, same literal at `src/cli/walk.ts:105` | the walk was cut short before it began (the page did not answer a scroll within <n> s (its main thre… |
| `src/preload/sync.ts:176` | 1 | control | user | scrollSelector "aside" matched an element that could not reach (<n>, <n>); it stopped at (<n>, <n>) |
| `src/preload/sync.ts:182` | 3 | control, mcp | user | scrollSelector "#absent" matched no element; nothing was scrolled |
| `src/shared/droppedEntries.ts:54` | 3 | cli, control, mcp | user | <n> of <n> text element the page sent was dropped: a value in it was outside what the measurement ac… |
| `src/shared/emptyDocument.ts:112` | 1 | cli | user | nothing to measure in the light DOM: the page had no visible text and no targets, and none arrived i… |
| `src/shared/emptyDocument.ts:128` | 9 | cli, control, mcp | user | nothing to measure: the page the server sent had no visible text and no targets, and none arrived in… |
| `src/shared/emptyDocument.ts:133` | 31 | cli, control, mcp | user | nothing to measure: the page had no visible text and no targets, and none arrived in the <n> s it wa… |
| `src/shared/inspectReadout.ts:151` | 4 | cli | user | this element is not drawn: display: none on it or on an ancestor. The measurements below are of a bo… |
| `src/shared/inspectReadout.ts:218` | 5 | cli, control, mcp | user | "p[" is not a valid CSS selector, so nothing was looked for — found: false is about the selector, no… |
| `src/shared/inspectReadout.ts:244` | 3 | cli, control | user | the point (<n>, <n>) is outside this screen's CSS viewport, <n>x<n>, and a point is read inside the… |
| `src/shared/layoutScale.ts:45` | 29 | cli, control, mcp | user | the page lays out <n> CSS px wide where the screen gives it <n> and is drawn at <n>× to fit — what a… |
| `src/shared/measureBudget.ts:122` | 10 | cli, control, mcp | user | the page navigated after it loaded (to the same address): a bot challenge, an interstitial, a redire… |
| `src/shared/measureBudget.ts:144` | 16 | cli, control, mcp | user | the server answered <n> Not Found for <path> the figures are of the error page it sent, not of the p… |
| `src/shared/measureBudget.ts:145` | 1 | cli | user | the server answered <n> Not Found for <path> the figures are of the error page it sent — check the r… |
| `src/shared/measureBudget.ts:186` | 26 | cli, control, mcp | **ambiguous**, same literal at `src/shared/measureBudget.ts:187` | the load of <path> ended at <path> a login wall, a route that has moved, or a redirect the server ch… |
| `src/shared/measureBudget.ts:187` | 1 | cli | user | the load of <path> ended at <path> a route that has moved, or a redirect the server chose — the figu… |
| `src/shared/measureBudget.ts:76` | 7 | cli, mcp | user | the page did not answer the audit within <n> s of loading: its main thread was busy or blocked — a b… |
| `src/shared/onionSkin.ts:63` | 3 | control, mcp | user | the onion skin was left off: it blends a <n>x render of the page over the target, and at this <n>x<n… |
| `src/shared/pageMotion.ts:165` | 12 | cli, control, mcp | user | this page was still moving when it was measured: <n> of the <n> elements re-measured had moved, by u… |
| `src/shared/paint.ts:156` | 26 | cli, mcp | user | the frame is one colour end to end (#<n>ff) and stayed that way for <n> ms: the page painted its bac… |
| `src/shared/shadowShare.ts:122` | 9 | cli, control, mcp | user | <n> shadow roots hold <n> of this page's <n> interactive elements, which the measurement does not en… |
| `src/shared/walkCoverage.ts:105` | 7 | cli, mcp | user | the page measures <n> CSS px (<n> screenfuls); the walk reached the first <n> px of it |
| `src/shared/walkCoverage.ts:151` | 13 | cli, mcp | user | this page hides the document's overflow and has no scrollable container in its light DOM, so the wal… |
| `src/shared/walkCoverage.ts:253` | 18 | cli, mcp | user | the walk scrolled a dialog, not the page itself: this page hides the document's overflow while a dia… |
| `src/shared/walkCoverage.ts:92` | 4 | cli, mcp | user | the walk saw the end after <n> screenful (<n> CSS px), but the page measures <n> CSS px (<n> screenf… |
| `src/shared/walkCoverage.ts:94` | 1 | cli | user | the walk saw the end after <n> screenfuls (<n> CSS px), but the page measures <n> CSS px (<n> screen… |

**Four sentences had no literal of 16 characters or more to attribute them to**, and none counts
towards C5. One is the dev-lane stamp (`obsrv-dev lane: <branch> @ <sha> · server built …`, dev-only).
The other three are `throttle slow-4g not applied: refused by the harness` variants (`full page:`,
`reference:`, and bare), which are harness-only: the suite forces the refusal. They fired, but they
aren't placed in the table.

**Against the hand-checked live table above**, these now have an observation: the resizing verdict
(then `ipc.ts:1605`, now `:1699`), the steady-painting verdict (`:1701`), and `scrollSelector` matching no
element (`sync.ts:182`). Also `scrollSelector` matching an element that could not reach the offset
(`sync.ts:176`, reworded since that table) and the stale-frame note (`frameCheck.ts:23`).

**Still to do (c5):** the other half, every note that can be written but didn't fire here. Each one
needs a fixture that provokes it, a finding that it can't be provoked (and then the sentence goes), or
a named reason it stays unobserved.

## What is left

- The 14 live-surface notes above with no observation. Each needs a fixture that produces
  the state or a finding that it cannot be produced — and where it cannot, the honest
  resolution is removing the sentence, not leaving it admitted.
- The headless and MCP call sites (41 of the 58) have not been hand-checked. The sieve's
  guesses are in the branch history, not here, because a guess recorded as a result is the
  failure this file exists to prevent.
