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

**Still to do (c5):** the other half, every note that can be written but didn't fire here. The next
section lists it.

## Written but not seen to fire: the producer list, 2026-09-17

**What this adds.** The section above lists what fired. This one lists everything the code can put in
a reply's `notes` or `warnings`, by producer, at `b43a272`, and splits it by whether run
`35166342003` saw it. It is mechanical, and this section says where the mechanism stops.

**How the list was made.** A TypeScript-compiler pass over `src/` (not `src/renderer`, which builds no
reply) found **173 sinks**:
- a `push` or `unshift` onto an array named `notes` or `warnings` (or `…Notes`, `…Warnings`);
- a `notes:` or `warnings:` property (not the zod schemas);
- the `warn(…)` and `onWarn(…)` callbacks, which land in the CLI's warnings (not `log.warn`, which writes
  the log file, and not `strictOutput.ts`'s `warn`, which defaults to stderr);
- `orientationNote`.

From each sink it followed the value back through conditionals, concatenations, variables and what is
pushed onto them, helper calls (to their `return`s), parameters (to every call site), destructured
results, and injected dependencies (to the implementation of the same name).

**A producer is one sentence:** a string literal, a template or a concatenation, placed at its first
literal. A literal inside a template's `${…}` is a value, not a producer. **The pass found 121, and
left nothing unresolved.** Every value it followed ended in a literal, or in an array read from
another result, which is counted where that array was built. A producer **fired** when a sentence in
the run's log contains all of its literal pieces of 8 characters or more, in order.

**Checked against the run, not assumed.** Of the 110 distinct sentences the run logged, **109 place at a
producer**. The one that doesn't is the dev-lane stamp (`laneStamp`, `src/mcp/devLane.ts:29`, dev-only).
`withStamp` adds it under a key computed from the tool's output shape, and a pass that reads names
can't see that.

**Run that check before trusting any count this pass produces, and treat it as the instrument's own
baseline.** A pass that misses a whole class of sink reports a smaller, perfectly plausible number,
and a plausible number is the case where nothing prompts a check. This one was only run because 121
producers could not be reconciled with the 84 call sites the earlier sieve had counted — the tell was
a delta nobody could account for, not a number that looked wrong. It then earned its keep twice: it
found that `log.warn` and a stderr `warn` were being counted as replies (ten sentences), and that a
`note` property reached a reply through a shorthand the first pass could not follow.

**Where it stops:**
- **Placement is by text.** An identical sentence written at several places matches all of them, so
  those are listed as ambiguous below, not as fired.
- **A branch inside one sentence isn't its own row.** A `${cond ? 'a' : 'b'}` clause belongs to its
  producer, so a producer that fired can have a branch nobody saw.
- **Line numbers are `b43a272`'s, and the run measured `87c835a`.** Four producers were written or
  reworded since, so the run couldn't have seen them. They're listed apart from the unfired ones.
- **The net is still replies' `notes` and `warnings`**, as above. A sentence that reaches only stderr,
  the app's UI or the log is outside it, such as the eight `log.warn` sentences in `src/main`.

**The split:**

| | producers | after #256 and #258 | after #270, #273, #274, #282, #283, #292 and #293 |
| --- | --- | --- | --- |
| fired, and placed at exactly one producer | 55 | 73 | **89** (2 of them since deleted with `#293`) |
| fired, but the same text is written at several places | 7 (3 groups) | 4 (2 groups) | **4** (2 groups) |
| not seen to fire | 54 | 39 | **14** |
| a named reason, not an observation | 0 | 0 | **9** |
| written or reworded after the run | 4 | 4 | **7** |
| too short to match (`src/cli/main.ts:859`, the `target: ` label) | 1 | 1 | 1 |

**The third column counts 124 where the first two count 121, and that is a different population
rather than an error.** 121 is what the pass found at `b43a272`. `#293` **wrote three producers**
that did not exist then (they are the last three rows of the written-or-reworded table), so 124 have
now been counted. **Two of the 89 have since been deleted** with `#293` — the share note and the
empty-page note's web-components branch — and they stay counted as fired, because they did fire and
the runs that carried them are named. So: **124 counted, 122 in the tree today.** Whoever adds the
next producer adds to both.

The right column is this file's state after `#256` and `#258`, below. The left is what the run of
2026-09-17 saw, and it does not change: a test written afterwards says the sentence can be produced,
not that that run produced it.

**Ambiguous: at least one place in each group fired, and text can't say which:**
- `src/cli/main.ts:860` and `:1511`, the `reference: ` label.
- `src/cli/walk.ts:105` and `src/mcp/walk.ts:113`: "the walk was cut short before it began". A
  headless MCP call relays the CLI's own sentence, so an `mcp:` surface does not prove the MCP copy
  ran.

**One group is no longer ambiguous.** `src/mcp/server.ts:1543`, `:1849` and `:2538` are the identical
"`preset` is headless-only and was ignored in live mode" in `liveAudit`, `liveLint` and `liveInspect`.
The run's log tags each MCP entry with the tool that answered, and only `mcp:obsrv_audit` and
`mcp:obsrv_lint` carried it — so `liveInspect`'s copy had never run. `#258` pins it
(`mcp-live.spec:417`), and each of the three is now attributed to a tool.

**Not seen to fire (14).** "Pushed in" is the directory of the sink, not every surface that relays it.
Forty rows have left this table: thirty-one to the fired list below, nine to the named reasons after
it.

| written at | pushed in | the sentence, shaped |
| --- | --- | --- |
| `src/cli/capture.ts:347` | cli | <…>% of the <…>x<…> frame <…>never painted within <…> ms<…>; those pixels are transparent, not page… |
| `src/cli/lint.ts:94` | cli, mcp | <…> image finding<…> sit<…> below the <…> CSS px the walk reached <…>before its budget ran out, and… |
| `src/cli/main.ts:529` | cli | the page scrolls an inner container <…> CSS px tall; captured the first <…> <…>bands of <…> CSS px (… |
| `src/cli/main.ts:620` | cli | full page is <…> CSS px tall; captured the first <…> bands of <…> CSS px <…>(<…> at most) — what lie… |
| `src/cli/main.ts:1479` | cli | the <…> finding<…> worth featuring all <…>, so this screen has no <…>"where the problems are" sectio… |
| `src/cli/walk.ts:98` | cli | the walk could not return to the top afterwards (<…>); measured where it stopped. |
| `src/cli/walk.ts:125` | cli | the walk stopped after <…> screenful<…> at its <…> s budget without reaching the end of the page; th… |
| `src/cli/walk.ts:179` | cli | the walk was cut short after <…> screenful<…> (<…>); |
| `src/mcp/lib.ts:581` | mcp | the user turned agent control off in Obsrv, so this ran headlessly; ask them to enable it (the AGENT… |
| `src/mcp/walk.ts:105` | mcp | the walk could not return to the top afterwards (<…>); measured where it stopped. |
| `src/mcp/walk.ts:143` | mcp | the walk stopped after <…> screenful<…> at its <…> s budget without reaching the end of the page; th… |
| `src/mcp/walk.ts:184` | mcp | the page did not confirm a scroll during the walk; the walk stopped there. |
| `src/mcp/walk.ts:211` | mcp | the walk was cut short after <…> screenful<…> (<…>); |
| `src/shared/walkCoverage.ts:174` | cli, mcp | <…> <…>% of the viewport, and what <…>scrolls is either inside it or scrolls by transform (a virtual… |

**Fired since, pinned by a test (40).** Thirty-nine of these left the list above; the other is
`liveInspect`'s copy, which leaves the ambiguous group. Each test asserts the **whole** sentence, and
each was shown to fail when that sentence is altered in `src/` — the control runs are
`35192500426` (#256), `35194537378` (#258, v2 on the corrected head), `35199207359` (#263),
`35200051529` (#264, v2; see below), `35203138455` (#270), `35205639766` (#274), `35212544441`
(#282, v2), `35213404787` (#283), `35218471058` (#292's raster arm), `35231440742` (#308) and, for #273 and the
rest of #292, a local run of the same shape: the producers reworded in `src/main`, every arm red,
restored, every arm green. **#338's controls were local** and are recorded on
`bug-walk-return-note-names-budget`: each of the three faults restored alone reds a different count of
arms (1, 2 and 4), and the fix as written reds none.

| written at | pinned by | seen firing in |
| --- | --- | --- |
| `src/mcp/lib.ts:679` | `mcp.spec:164`, `obsrv_snap` in auto mode with custom dimensions | `35192541543` |
| `src/mcp/server.ts:1639` | `mcp.spec:164`, `obsrv_audit` | `35192541543` |
| `src/mcp/server.ts:1947` | `mcp.spec:164`, `obsrv_lint` | `35192541543` |
| `src/mcp/server.ts:2599` | `mcp.spec:164`, `obsrv_inspect` | `35192541543` |
| `src/mcp/lib.ts:584` | `mcp.spec:172`, `capture: 'pane'` on a headless render | `35192541543` |
| `src/mcp/lib.ts:646` | `mcp.spec:180`, `OBSRV_HEADLESS=1` on a second client | `35192541543` |
| `src/mcp/lib.ts:681` | `mcp-live.spec:176`, `waitMs` on a live snap | `35192541543` |
| `src/shared/inspectReadout.ts:134` | `cli-inspect.spec:147`, both routes and an opaque twin | `35194508818` |
| `src/cli/lint.ts:517` | `cli-lint.spec:181`, text at 1:1 | `35194508818` |
| `src/shared/layoutScale.ts:52` | `cli-layout-scale.spec:137`, `initial-scale` above 1 | `35194508818` |
| `src/shared/calibration.ts:165` | `mcp.spec:211`, the `orientation` word inverting | `35194508818` |
| `src/mcp/server.ts:2538` | `mcp-live.spec:417`, live inspect's headless-only key | `35194508818` |
| `src/cli/audit.ts:215` | `cli-audit.spec:331`, a page past the collection caps | `35199168099` |
| `src/cli/lint.ts:526` | `cli-lint.spec:270`, the same shape for text, edges and images | `35199168099` |
| `src/cli/lint.ts:78` | `cli-lint.spec:270`, the list's own cap | `35199168099` |
| `src/preload/sync.ts:167` | `live-drive.spec:531`, a selector the browser refuses | `35199881465` |
| `src/cli/walk.ts:165` | `cli-walk-limits.spec:91`, a page that locks its scroll mid-walk | `35211676500` |
| `src/mcp/walk.ts:197` | `cli-walk-limits.spec:174`, the same page, live | `35211676500` |
| `src/shared/walkCoverage.ts:245` | `cli-walk-limits.spec:107`, a dialog that scrolls only sideways | `35211676500` |
| `src/shared/walkCoverage.ts:168` | `cli-walk-limits.spec:116`, an app shell whose content is behind one open root | `35211676500` |
| `src/main/ipc.ts:1796` | `live-capture-notes.spec:71`, the onion skin on, a raster capture | `35218827856` |
| `src/main/ipc.ts:1790` | `live-capture-notes.spec:88`, an animating page, a raster capture | `35218827856` |
| `src/main/ipc.ts:1759` | `live-capture-notes.spec:99`, an animating page with the skin on, a window capture | `35218827856` |
| `src/mcp/control.ts:350` | `mcp-launch.spec:92`, a launch that loses the single-instance lock | `35205619883` |
| `src/mcp/control.ts:356` | `mcp-launch.spec:116`, a consent nobody answers | `35205619883` |
| `src/mcp/server.ts:871` | `mcp-live.spec:878`, a page whose load never finishes | `35210865781` |
| `src/mcp/server.ts:1070` | `mcp-live.spec:878`, the same page's settle budget | `35210865781` |
| `src/cli/walk.ts:157` | `cli-walk-limits.spec:157`, a page taller than the walk's budget | `35242092672` |
| `src/mcp/walk.ts:145` | `cli-walk-limits.spec:287`, the same page, live | `35242092672` |
| `src/cli/walk.ts:211` | `cli-walk-limits.spec:183`, a page that stops answering once scrolled | `35242092672` |
| `src/mcp/walk.ts:187` | `cli-walk-limits.spec:303`, the same page live, where the scroll is never confirmed | `35242092672` |
| `src/cli/walk.ts:130` | `cli-walk-limits.spec:199`, the return to the top after a spent budget | `35293771341` |
| `src/cli/main.ts:620` | `cli-snap-tiled.spec:344`, a full page past the twelve-band cap | `35331754234` |
| `src/cli/main.ts:528` | `cli-snap-tiled.spec:356`, an app shell whose feed outruns the bands | `35331754234` |
| `src/cli/main.ts:1472` | `cli-report.spec:218`, every finding out of the capture's reach | `35331754234` |
| `src/cli/stuckProbe.ts:98` | `cli-snap-tiled.spec:229`, a page that replaces its document once during the probe | `35213379890` |
| `src/cli/stuckProbe.ts:76` | `cli-snap-tiled.spec:239`, the same page replacing it twice | `35213379890` |
| `src/main/controlServer.ts:531` | `live-capture-notes.spec:234`, a scroll a page holding its main thread cannot answer | `35218827856` |
| `src/main/ipc.ts:1755` | `live-capture-notes.spec:115`, an animating page under a throttle, a window capture | `35218827856` |
| `src/main/ipc.ts:1793` | `live-capture-notes.spec:147`, a raster capture under a paused preset cycle | `35218827856` |

**Two of those rows changed meaning the same day (`#293`, open shadow roots).** The measurement
enters open roots now, so:
- **`walkCoverage.ts:184`** — *"the page has N open shadow roots, which the walk does not enter"* —
  fired in `#270` and is now reachable only from an app between 0.58.0 and `#293` driven by a newer
  MCP. It stays in the fired table, because it did fire and the run that carried it is named; what
  changed is that nothing in this tree can produce it again. It joins `chore-minimum-app-version`.
- **`walkCoverage.ts:210`**, the older walk's *"no iframe covers the viewport and the page has no
  open shadow roots"*, is on the same footing and joins it too.

**Two producers left this file entirely.** `shadowShare.ts`'s share note and `emptyDocument.ts`'s
web-components branch were deleted with the gap they described, along with `shadowContent`, the
counts behind both. A producer that no longer exists is not an unfired row; it is removed, and this
paragraph is the record that it was.

**Named reasons, not observations (9).** Each is written for a state this tree cannot reach, and each
says why here rather than leaving a row that reads as work nobody has done. They are not counted as
fired, and none of them is proposed for removal.

| written at | pushed in | why it stays unobserved |
| --- | --- | --- |
| `src/main/frameCheck.ts:20` | main | **Measured, 12 launches and 3 reloads.** The earliest call an agent can make — the control file polled every 5 ms, 423–866 ms on a laptop and 1263–6854 ms on a runner (`35216434021`) — never produced it, and neither did three captures fired while the app's own window reloaded. Both checks run after the capture settles, which is ≥ 700 ms on a quiet page and 3 s on a blank one, and the renderer subscribes on mount. Kept as the guard for a renderer slower than any measured (`chore-live-app-race-sentences`). |
| `src/main/ipc.ts:1752` | main | The same measurement. A report dropped at the tab-switch early return leaves the bounds main already holds, so it cannot make them null after the first report. |
| `src/main/ipc.ts:1753` | main | The same measurement, one field narrower. |
| `src/main/frameCheck.ts:21` | main | **Reachable, and proven once** by removing the `drawNow` send (#139's control). A test needs an `OBSRV_TEST` fence in `src/`, and this file's own decision is that the inventory buys no fences: a fence is bought by a defect. If a stale capture nobody was warned about turns up, that defect buys it. |
| `src/mcp/control.ts:318` | mcp | The lever exists (`OBSRV_ELECTRON_PKG_DIR`) and the control showed it cannot serve this arm: the same resolver serves the headless render, so the call errors instead of answering with the note (`35207583374`, red at `isError`). Reachable in the field, not here without machinery whose only purpose is the arm. |
| `src/mcp/control.ts:357` | mcp | Needs an app that comes up and never answers, which is a fake of our own making rather than a state a page can produce. |
| `src/mcp/server.ts:1092` | mcp | Version skew: an app older than the capture's settle verdict. `chore-minimum-app-version`. |
| `src/mcp/walk.ts:41` | mcp | Version skew: an app older than page-wise scrolling (0.41.0). Same card. |
| `src/shared/walkCoverage.ts:194` | cli, mcp | Version skew: an app that sends no `blocked` field (pre-0.58.0). Same card, and a unit test pins the whole sentence as a construction guard. |

**A fourth fixture followed for the caps (#263):** `over-caps.html`, 2100 buttons, 3100 paragraphs and
600 upscaled images, past `AUDIT_MAX_TARGETS`, the 3000 text cap on both tools, and `LINT_MAX_IMAGES`
— every fixture until then fitted inside every cap. The control's received values are the numbers it
was sized for (100 targets, 2200 text, 100 images, 300 findings past the list), and they also
corrected an assumption: `edges` is **0**, since a button's own border is not counted, so the test
asserts text and images alone.

**The live `scrollSelector` (#264) needed no fixture, only the fourth question.** The suite had asked
for a selector that matched nothing, one that matched something unscrollable, and an empty one — never
one that is not a selector. **Its first control was invalid and said so by how it failed:** run with
`-g` on that one test, it went red in 79 ms at the test's *first* assertion, because the test depends
on state its predecessors leave. A filtered control removes the predecessors, not the product. v2 ran
the whole file and bit at the arm's own assertion.

**Three needed a fixture that did not exist:** text that is not opaque, text exactly the colour of
its background, and a page asking for `initial-scale=2` — every fixture until then either had no
viewport meta tag (0.37×) or asked for 1×, so the scale-**above**-1 branch could not be produced.
The rest needed only a call nobody had made.

**One of those tests was wrong, and its control said so.** It expected `screenShape` on a headless
snap reply; the key is declared `Live only` (`src/mcp/server.ts:406`). The control's red landed on
the shape assertion rather than the sentence, which is how a control tells you the test is wrong
rather than the product. The test now pins the key's **absence**, and the skill and the `rotated`
description, which both overstated it, were corrected (`#259`, `#260`).

**Two sink classes checked and cleared** (Wren's read of the pass):
- **Report HTML.** One sink is HTML-only: `runReport`'s `lint.warnings.push(unwalked)`
  (`cli/main.ts:1404`), since the report JSON carries lint's summary and not its warnings. Its
  producer (`cli/lint.ts:94`) also reaches the CLI lint JSON and MCP lint, so **no producer is
  HTML-only**. The throttle banner is built inline in the HTML, never in an array, so the pass never
  counted it.
- **The cut-load router.** `explainedByCutLoad` (`cli/capture.ts:64`) drops only `animating` and
  `timeout`, and both producers fired. The unfired `capture.ts:347` is `uncovered`, which passes
  through, so the router cannot explain an unfired row.

**Written or reworded after the run (7).** These need their own observation, not a place on the list
above. The last three are `#293`'s: the walk note's opening and its ruled-out wording for a walk that
entered the roots, and the capture's reworded sentence. Each has a test asserting it
(`cli-walk.spec`, `mcp-live.spec`, `cli-snap-tiled.spec`, on `app-shell-unreachable.html`); what none
has is a run of the note log that saw it, which is what this column counts.

| written at | pushed in | the sentence, shaped |
| --- | --- | --- |
| `src/cli/main.ts:278` | cli | <…>; and <…>, so `throttle` names the conditions put back, not ones known to be in force |
| `src/shared/measureBudget.ts:154` | main | the figures are of <…>, not as the last navigate loaded it: the last move Obsrv recorded since was a… |
| `src/shared/measureBudget.ts:155` | main | the figures are of <…>, not of <…>, which the last navigate asked for: the tab moved after that navi… |
| `src/shared/uninstallPlan.ts:100` | mcp | Obsrv's data locations have only been measured on macOS <…>(docs/research/2026-09-14-a4-install-rema… |
| `src/shared/walkCoverage.ts:165` | cli, mcp | this page hides the document's overflow and has no scrollable container in its light DOM or its ope… |
| `src/shared/walkCoverage.ts:200` | cli, mcp | <…>no iframe covers the viewport, so what scrolls is a container that scrolls by transform (a virtu… |
| `src/cli/main.ts:542` | cli | this page hides the document's overflow and scrolls nothing the capture can reach — no scrollable c… |

## What is left

**After #256, #258, #263, #264, #270, #273, #274, #282, #283, #292, #293, #308, #338, #348, #358, #360
and #389: ZERO unfired producers, eight written or reworded after the run, two ambiguous groups, and
nine named reasons.**

**The unfired column is closed and the card is not.** `#389` pinned the last one — `capture.ts`'s
`uncovered` sentence, which was produced on every uncovered capture and asserted by its opening and
one middle clause, leaving the region and the closing unheld. That is the same shape as the walk four:
produced every pass, with the words that matter checked by nobody.

**What remains is the eight written or reworded after the run**, and they are unobserved in this
column's own sense rather than untested: each has a test asserting it, and none has a run of the note
log that saw it — which is what this column counts. Closing them means a note-log run that reaches
them, or a named reason each, per step 3 of the card's plan. The two ambiguous groups are the other
open thing. Neither is an unfired producer, and neither is nothing.

**What the last two folds changed about this column, beyond its count.** Of the six producers `#358`
and `#360` closed, **one had never been produced** and five ran on every green build while nothing
asserted the words that make them those sentences. "Unfired" was two populations wearing one label,
and they take different work: the first needs a lever, the rest need somebody to write the sentence
down. Three of the five were singular/plural gaps — a producer asked only ever for the count it
happened to get.

**What #308 and #338 moved, and the one thing that is not a subtraction.** `#308` fired four — the
budget pair and, on the cut-short page, the headless cut-short sentence and the live "did not confirm
a scroll". `#338` fired one, and **created another in the same change**: the return-to-top note used
to be a single producer, and fixing it split it in two — a spent-budget sentence (fired, pinned) and
the original wording, kept because it is true when the step failed with budget left (**still
unfired**). So fourteen minus five is nine, plus one new branch is **ten**, and the reworded count
goes from seven to eight. A fold that only subtracted would have reported nine and been wrong by the
sentence the fix wrote.

- **Each of the 14 gets one of the same three outcomes:** a fixture that fires it on CI, a finding
  that it can't fire and then the sentence goes, or a named reason it stays unobserved.
- **The two ambiguous groups left:** which of the identical places fired.
- **Sentences outside the net** (stderr-only, UI-only, log-only): nobody has listed them, beyond the
  ten this pass set aside (eight `log.warn`, and two stderr lines in `strictOutput.ts`).
- **What the 14 would take:**
  - ~~**Walk limits (4).**~~ **Closed by `#358`**, and only one of the four was unfired in the sense
    this column means. `cli/walk.ts:129` — the return note's branch for a step that failed with budget
    left — was genuinely never produced, and needed a target that answers the walk and then rejects
    the second `top`. The other three ran on every green build with fragments asserted instead of
    sentences: `mcp/walk.ts:108` under `/return to the top/` (which also matches the cli walk's *other*
    return note), `mcp/walk.ts:213` under `/cut short.*socket hang up.*partial walk/`, and
    `walkCoverage.ts:174` under `toContain('20% of the viewport')` (which the wall sentence contains
    too). Control `35377131422`-era run on the branch: five sentences altered, five reds, each at its
    own assertion. **A test can execute a sentence thoroughly and check none of it**, which is the
    thing this cluster is worth remembering for.
  - ~~**Truncation and caps (3).**~~ **Closed by `#348`**: `cli/main.ts:620` on `lazy-tall.html`
    (which already produced it — the probe found that before a fixture was written for it), `:528` on
    a new app shell whose feed is 20,000 px, and `:1472` on a new page whose only findings sit past
    the cap. Control `35335246705`, each red at its own sentence.
  - **The rest (3 → 1).** `#360` closed two. `cli/lint.ts:94` had its **plural** pinned and its
    singular never spoken (`1 image finding sits` against `2 image findings sit`). `mcp/lib.ts:581`
    was **asserted against itself** — three tests compared `DECLINED_NOTE` with the constant, proving
    it is *routed* and unable to fail on any rewording; prefixing it left the whole unit suite green,
    1559 passed, with no file under `tests/` containing the sentence. `#362` and `#363` then pinned it
    against the UI it names, since a literal still only fixes the constant against itself and would
    not catch the Settings section being renamed underneath it.
    **`capture.ts:347` is the one left, and is parked on purpose:** `#361` moved the `uncovered`
    verdict to the bytes, taking the share and the region with it, so pinning today's words would
    either be rewritten by that or quietly constrain it.
- **The named reasons are a standing list, not a backlog.** Two of them are version skew and share
  `chore-minimum-app-version`; the three live-app ones are measured; `frameCheck.ts:21` waits for a
  defect to buy its fence.
- **The 17-row live table at the top is history.** Of its 14 unobserved rows:
  - 7 are `log.warn` lines, which no reply carries, so they're outside the list above;
  - `sync.ts:175` has fired since (reworded, now `:176`), and `sync.ts:167` in #264;
  - `ipc.ts:1606`, `:1610` and `:1647` — still painting at the budget, the onion skin blending, and
    the raster being the target's own frame — fired in #273 and #292 (now `:1755`, `:1759`, `:1796`);
  - `ipc.ts:1603` and `:1604`, the two bounds, are named reasons now (`:1752` and `:1753`), measured
    over 12 launches and 3 reloads.
