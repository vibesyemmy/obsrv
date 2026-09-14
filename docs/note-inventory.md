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

## What is left

- The 14 live-surface notes above with no observation. Each needs a fixture that produces
  the state or a finding that it cannot be produced — and where it cannot, the honest
  resolution is removing the sentence, not leaving it admitted.
- The headless and MCP call sites (41 of the 58) have not been hand-checked. The sieve's
  guesses are in the branch history, not here, because a guess recorded as a result is the
  failure this file exists to prevent.
