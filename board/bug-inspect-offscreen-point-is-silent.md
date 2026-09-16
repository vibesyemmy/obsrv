---
title: "`obsrv_inspect` answers an off-screen point exactly as it answers an empty one"
column: done
owner: "Henry"
kind: bug
order: 44
---

FOUND BY ROOK in run 19, 2026-09-16. Not live-specific: the headless path does the
same, and the card says so rather than claiming a live finding.

**Surface observed**, added 2026-09-16 by Henry on Rook's own catch: the `obsrv` MCP tools in this
repo run the package pinned in `.mcp.json`, `getobsrv@0.60.0` (tag `v0.60.0`, `31b77e8`), not `main`
or a local build. **So this was observed on the 0.60.0 release.** **Expected to hold on `main`, by
diff and not by observation:** between `v0.60.0` and `main` at `3552349`, no changed line in
`src/shared/inspect.ts`, `src/shared/inspectReadout.ts` or `src/mcp/server.ts` matches `found`,
`outside`, `off-screen` or `viewport`. The diff over those files is not empty, the pattern matches
`main`'s source, and the same method finds #49's routing change, so the result is not a blind
search. It is still a reading, not an observation: behaviour can change through lines that do not
use these words. **Re-observe on a local build before fixing.**

## The defect

`obsrv_inspect` at `(1000, 500)` on a 412-wide screen:

    found: false    readout: null    notes: []

**No note that the coordinate is not on this screen.** So `found: false` carries two opposite
facts — *nothing is painted there* and *that point does not exist here* — and an agent that
arrived at the bad coordinate honestly (see `bug-drive-status-race-at-launch`) concludes the
page is empty.

## The same app already does this right, two calls away

`obsrv_drive`'s `highlight`, given a page rect scrolled out of view, answers:

    drawn: false
    warnings: ["the page rect is off screen at the current scroll (0, 1536); scroll it into view first"]

**The reason, the state that caused it, and the fix.** Same class of caller mistake, same tool
family, opposite treatment. This is not a missing design — it is a design applied in one place
and not the other, which is the cheapest kind of fix to argue for.

## What a fix has to decide

`found: false` is documented as "not an error", and that should not change. The question is only
whether a **note** is added when the point lies outside the target viewport. `notes` already
exists in the reply and is already an array of strings, so nothing in the schema moves.

Worth checking while there: the same silence on a `selector` that matches nothing versus one
that matches a hidden element.

## RESOLVED 2026-09-16 by Henry — one sentence in `notes`, on both surfaces

**Re-observed on a local build of `main` (`f362898`) first**, through the CLI's JSON, which the
MCP's headless reply relays. On `pixel-8`, 412x915:

| `--at` | `found` | `readout` | `notes` |
| --- | --- | --- | --- |
| `1000,500` | false | null | `[]` |
| `5,900` (on screen, blank) | true | `html` | `[]` |
| `100,40` | true | `button#big` | `[]` |

**So on this page `found: false` for a point meant off the screen.** A blank stretch of page answers
`html`, not `found: false`. Nothing in the reply said so.

**The fix:** `pointOffScreenNote` in `src/shared/inspectReadout.ts`, said by the headless inspect
(`src/cli/main.ts`) and the live one (`src/main/ipc.ts`), so both surfaces use the same words. For
`(1000, 500)`: *"the point (1000, 500) is outside this screen's CSS viewport, 412x915, and a point is
read inside the viewport, so nothing can be found there — found: false is about the point, not the
page; to read an element that is not on screen, use --selector (selector)"*. Live, the viewport is
the tab's as it is now. It goes in `notes`, a sentence about the call, in an array already declared,
so the schema doesn't change.

**The edge is the click's:** `[0, width) x [0, height)`, the rule `parseClick` in
`src/shared/control.ts` already refuses clicks by. A unit test walks a grid of edge points through
both functions and requires them to agree, with both answers occurring.

**One limit, measured and left in place.** Chromium reads a point at the nearest whole page pixel:
on this screen `411.49` finds `body` and `411.5` finds nothing. Under `--text-scale 1.5` the
boundary moves to between `411.5` and `411.8`. So a point in roughly the last half pixel before the
edge answers `found: false` without the sentence. The sentence is keyed on the geometry, so it is
true wherever it is said. Modelling that rounding under a text scale and a layout scale would trade
that for a sentence that could be wrong.

**A second limit, the same shape and wider: a classic scrollbar.** On a desktop preset, a page that
overflows gets a scrollbar strip inside the viewport. With one styled in on `laptop-768`, `(1365, 100)`
finds nothing and `(1350, 100)` finds the page. Without it, both find the page. A point on the strip
answers `found: false` with no sentence, because it *is* on the screen. CI's macOS runners draw these
without being asked (overlay scrollbars need a trackpad), which is how the first CI run of the live
test found it: its last-pixel control sat on the strip. The control now asks a page that doesn't
overflow. Whether a phone preset draws a strip on CI is unchecked. The CLI test's last-pixel control,
on `pixel-8`, passed there, and that is all it shows.

**Tests:** `cli-inspect.spec.ts`, *a point off the screen says so…*: off to the side, one row below
the bottom edge, and the last pixel on the screen as the control (found, no sentence).
`live-drive.spec.ts`, *an inspect point off the screen says so…*: below the fold on a tall page, the
viewport read from `status`, and the same last-pixel control. **Both passed with the fix (the whole
`cli-inspect` file, 7/7) and both failed with `main`'s `cli/main.ts` and `ipc.ts`**, at the note
assertion, where `notes` was empty.

**The last line of this card, checked, and it found two more silences on the `selector` path.** A
selector matching a **hidden** element (`visibility: hidden`, `display: none`) answers a full
readout with a passing contrast verdict and no note. A selector that **isn't valid CSS** (`p[`)
answers exactly like one that matches nothing. Both are filed together as
`bug-inspect-selector-silences`, because both change the same page ask, `inspectTarget`.
