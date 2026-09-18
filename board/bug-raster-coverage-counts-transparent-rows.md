---
title: "A raster capture can call a frame fully painted while a band of it is transparent, and say nothing"
column: doing
owner: "Dogu"
waiting: ""
kind: bug
criterion: C5
order: 96
---

FOUND 2026-09-17 by Kenya's own assertion, and hidden by the suite's retry. **Kenya's lead** on
`bug-live-raster-uncovered-said-as-painting` said the unpainted band under a preset cycle is exactly
the rows the frame grew by. Her `NOT A FLAKY BASELINE` assertion in `live-capture-notes.spec.ts` was
written to catch the mask and the bytes disagreeing. **It did, on `main` code, and the run still
concluded `success`**, because `playwright.config.ts:29` sets `retries: 1` for the whole suite. Found
by Henry reading every run he merged on for `✘`, after Wren pointed out what a green conclusion does
and does not claim.

## Two sightings, on two heads, one with none of `#314` in it

| run | head | reply | PNG | the band vs the growth |
| --- | --- | --- | --- | --- |
| `35238786585` | `docs/release-gate` (#313, no `#314` code) | `timeout`, covered | **158,720 transparent, `1280x124 at 0,900`** | 1024 − 900 = **124** |
| `35242350343` | `#314` at `b43e7fc` | `resizing`, covered | **40,960 transparent, `1280x32 at 0,768`** | 800 − 768 = **32** |

In both, **the coverage mask said every pixel had painted** — `timeout` and `resizing` are only reached
with `covered` true (on `main`, the deadline branch at `cli/capture.ts:324` answers `timeout` only
inside `if (covered)`; on `#314`'s branch, `resizing` is guarded the same way) — and the
PNG has a transparent band exactly the size of the growth. The first sighting fired Kenya's assertion
directly: *"this capture's coverage mask said every pixel was painted, and its PNG has transparent
ones, so the mask and the bytes disagree"*. Its retry reached `uncovered` cleanly, and the run went green.

**So it is on `main`, not something `#314` introduced.** What `#314` may have changed is how often the
arm samples it (its gate makes a capture run to its budget more often); that is a reading, and nothing
here depends on it.

## Why it is a defect and not a test's problem

The reply says the page was still painting, or still resizing, about a PNG that is **12.1% transparent
pixels** — which the same capture path elsewhere calls *"never painted … those pixels are transparent,
not page content"*. A caller reading the reply has no way to know a band of the image is not the page.
That is class 1 under `release-gate.md`: a wrong answer nothing in the reply discloses. And every
`uncovered` percentage is computed from the same mask, so it can undercount by the same band.

## MEASURED 2026-09-17 by Idris: the mechanism, confirmed at both levels this card asked for

**The exact code path.** `src/cli/capture.ts`'s `onFrame`, the branch guarded by
`x === 0 && y === 0 && w === width && h === height` (currently ~line 311): a frame whose declared rect
covers the whole current bitmap takes `buffer.set(data)`, `covered = true`, `mask = null` —
unconditionally, never inspecting the bytes it just accepted. The byte-by-byte mask that would notice
an unpainted pixel only runs in the other branch, for a partial rect. That asymmetry is the whole
mechanism; the reading above was right in shape and now has a line number.

**Level 1, synthetic, against `captureQuiescent` itself.** A fake `FrameEmitter` emitting one "full"
frame whose bottom 6 of 27 rows are alpha 0 (a full-size rect, real byte content otherwise):
`captureQuiescent` returns `settled: true`, and the caller's buffer carries exactly those 288
transparent bytes through untouched — `48 × 6`, the predicted count. The identical hole delivered as a
*partial* rect instead is caught correctly (`settled: false, unsettledReason: 'uncovered'`), confirming
the asymmetry is exploitable, not merely plausible.

**Level 2, live, against real Chromium.** A genuine offscreen `TargetSource`, `tests/fixtures/tall.html`,
and a rapid, overlapping series of height changes (500→900→1400→2000→700→1600→300→2000→1100→1900 CSS
px, 40 ms apart — deliberately shorter than a paint round-trip). **A single clean grow-then-settle
produced nothing** — checked first, worth recording so nobody re-tries that shape expecting it to
reproduce: Chromium had time to composite before its one paint fired. The cycle shape is what found it
originally and what it took here too.

Nine real `'frame'` events captured. Frame 7 of 9: `rect=(0,0,400x1900)`, `frame=400x1900`, **`isFull:
true`**, its own last three sampled rows **alpha 0 across every sampled column**. Frame 8, milliseconds
later: same rect, same frame size, **alpha 255 throughout** — the genuine repaint landing right after
the false "full" one was accepted. That is the two incidental CI sightings (`1280x124 at 0,900`;
`1280x32 at 0,768`), reproduced on demand rather than waited for again.

**The "measure first" assumption — checked, not left open.** `src/main/targetSource.ts`'s
`BrowserWindow` construction sets neither `transparent: true` nor a custom `backgroundColor`, so
Electron's OSR default (opaque) applies; nothing here asks for an alpha-capable surface. The same live
probe corroborates it directly: every frame where compositing had genuinely finished (0, 1, 3, 6, 8 of
the 9) read alpha 255 uniformly across every sample; the *only* alpha-0 reading in the whole run was
frame 7, caught mid-composite. No legitimate transparent-page case turned up, and the code offers no
path to one.

**Not done, on purpose — the candidate fix and its pinning test, for whoever picks this up next.**
Unaffected by the above; if anything, better supported now than when the card was opened.

## Candidate fix, for whoever picks this up

Make the answer true of the bytes **by construction**: before answering, count the fully transparent
pixels in the buffer, and if there are any, the verdict is `uncovered` with the share and region taken
from the bytes rather than the mask. That puts Kenya's baseline invariant in the product instead of in
one test. The "measure first" caveat above is now closed, not open — Idris's probe is the measurement.

**Headless too, probably:** the mask is `captureQuiescent`'s, which the CLI shares. Unmeasured there.

## Acceptance, each with a control

- ~~a probe that logs, for a paint during a grow, the rectangle and the alpha of the rows it
  covers~~ **met**: Idris's two-level probe above, 2026-09-17;
- a capture never answers `timeout`, `resizing` or `settled: true` about a PNG with fully transparent
  pixels, pinned by construction in `cliCapture.test.ts` (a fake paint whose rectangle covers rows whose
  bytes are alpha 0). **Control:** reverting the fix reds it;
- Kenya's `NOT A FLAKY BASELINE` assertion stays exactly as it is, and stops firing.

## And the reading rule this came with

A green run in this repo was never a claim that nothing failed, only that nothing failed twice. The
first sighting was in a run that concluded `success` and was merged on. Read the `✘` lines before any
merge.

## MEASURED 2026-09-17, in the direct form: the stated share is five points low

The two sightings above are the mask calling a frame **covered** while the PNG has transparent bytes.
This one is the consequence that section only predicted — *"every `uncovered` percentage is computed
from the same mask, so it can undercount by the same band"* — caught by @Kenya's own truth check, which
compares the sentence against the image:

```
stated 19.1%, the PNG is 24.148% transparent:
try 1: settled=false label=uncovered applied=314 capture=12295ms size=1440x…
expect(received).toBeLessThanOrEqual(0.051)
```

Run `35277717542` (`#330` at `c205b0c`), `live-capture-notes.spec.ts:351`, first attempt; it passed on
the retry, and the run concluded **success** with **3 flaky**.

**What this adds.** The mechanism section is still a code reading, but its *effect* is no longer
predicted — it is measured, with numbers: the capture told a caller **19.1%** of the frame never
painted when **24.148%** of it is transparent. A caller sizing anything off that share is off by five
points, in the direction that understates the damage. The tolerance the assertion allows is
**0.051 pp**; the gap is **~5.0 pp**, about a hundred times it, so this is not a rounding question.

**It also rules out one innocent explanation.** A share that disagreed because the PNG encoder dropped
alpha, or because the page painted its own transparency, would disagree in either direction and on
covered frames too. This is an `uncovered` frame whose *stated* region is smaller than the *actual*
one — exactly what a mask that marks unpainted rows as painted produces, and not what an encoding
fault produces.

**Still not established:** the mechanism itself (paint rectangles versus bytes). The acceptance item
asking for a probe that logs a grow's rectangle against the alpha of the rows it covers stands
unchanged — but it is now buying an explanation for a measured defect rather than deciding whether
there is one.

## THIRD SIGHTING 2026-09-18: the REGION is wrong too, and the error is not a constant

Run `35315388746` (`#341`, a docs-only PR whose suite ran anyway), `live-capture-notes.spec.ts:351`,
first attempt, passing on the retry:

```
stated:   10.0% of the 1600x900 frame never painted (uncovered region 160x900 at 1440,0)
measured: 416000 transparent px = 28.889%, bounding box 1600x900 at 0,0
```

**The stated region is a 160-wide band at the right edge — exactly the growth from 1440 to 1600. The
transparent pixels span the whole frame.** So this is not only an undercount of the share; the box
names the wrong part of the image.

### Two claims this kills, both of them mine, both made from too few readings

**1. "The region agrees; only the share is wrong."** Written on this card after the second sighting,
where the stated box and the measured box both happened to be the full frame. That was one state's
coincidence read as a property. **The region and the share can each be wrong, and independently** — a
fix that corrects the count alone would still hand a caller a box naming the wrong part of the PNG.

**2. "Identical figures twice suggests the undercount is deterministic given the state."** Three
sightings now:

| run | frame | stated | measured | gap |
| --- | --- | --- | --- | --- |
| `35277717542` | 1440x900 | 19.1% | 24.148% | ~5.0 pp |
| `35295017371` | 1440x900 | 19.1% | 24.148% | ~5.0 pp |
| `35315388746` | 1600x900 | **10.0%** | **28.889%** | **~18.9 pp** |

**The magnitude varies by nearly four times.** Two identical readings were two samples of the same
state, not evidence of a fixed ratio.

### What the three together support, kept weaker than it wants to be

- **The mask is internally coherent and externally wrong.** 160×900 ÷ 1600×900 is exactly 10.0%, so
  the stated share is computed *from* the stated box; the two agree with each other and neither agrees
  with the bytes.
- **In this sighting the mask believed only the newly exposed band was unpainted** while 28.9% of the
  bytes were transparent and spread across the whole frame. A full-frame paint marked everything
  covered and delivered a mostly-transparent frame.
- **Whether that fits the mechanism Idris confirmed** — the full-rect branch taking `covered = true`
  without inspecting bytes — is not established here. That mechanism explains a full-frame paint being
  trusted; it does not by itself explain why the mask still reported a *narrow* uncovered band
  afterwards. **Left as an open question rather than folded in**, because a mechanism that explains two
  sightings and is assumed for the third is how the last two wrong claims on this card were made.

### What this changes about the fix

The candidate fix — count transparent bytes before answering — corrects the share. **It does not
correct the region**, which comes from `uncoveredBounds(mask, …)`. A fix that leaves the box computed
from the mask will keep naming the wrong part of the image, and the acceptance below should be read
with that in mind: *both* numbers in the sentence are derived from the mask, and both are wrong here.
## CLAIMED BY KENYA 2026-09-18, after #338 cleared my Doing

Routed by Wren; taken because the assertion that caught it and the undercount measurement (#331) are
both mine, and @Idris has since put a line number and a live reproduction under the mechanism.

**What I intend to build, from the candidate fix above.** Decide the verdict from the bytes before
answering: count fully transparent pixels in the buffer, and if there are any, the capture is
`uncovered`, with **the share and the region taken from the bytes rather than the mask**. That closes
both halves at once — the covered-frame sightings (`1280x124 at 0,900`; `1280x32 at 0,768`) and the
undercount the mask produces when it *does* answer `uncovered` (19.1% stated against 24.148% real).

**Two things I will measure rather than assume:**
- **the headless CLI**, which the card marks unmeasured. It shares `captureQuiescent`, so it should
  share the defect; a run says so or does not;
- **the cost of the scan.** A full-buffer pass at 1920x1080 is 2M pixels on a path that already
  encodes a PNG. If it is not free, that is a number for the card, not a reason to skip the check.

**What I will not do:** widen the assertion that found this. It stays exactly as written and must stop
firing on its own.

## CLAIM RELEASED 2026-09-18 by Henry — the session holding it is gone, and it is blocking the queue

**Not a judgement on the work, and Kenya can take it straight back.** The claim above is five hours
old and that session is no longer running — absent from the session list, not idle. Nothing was
pushed under it.

The reason to release it now rather than wait: **this bug's recurrence has red-lined two unrelated
PRs today**, most recently `#358`, whose content is three unit-test files nowhere near the capture
path. `live-capture-notes.spec.ts:351` failed **both tries** with the third sighting's exact numbers —
`stated 10.0%, PNG is 28.889% transparent, 1600x900` — so this is not retry-masked and not
waivable as a flake. Every PR behind it waits on a card nobody can pick up while it is claimed.

**What the next owner inherits, unchanged:** Kenya's build plan above is specific and stands as
written — decide the verdict from the bytes, take *both* the share and the region from the bytes
rather than the mask, measure the headless CLI, measure the scan cost, and do not widen the assertion
that found this. The two claims of mine this card killed (a fixed five-point offset, and a region that
could be trusted) stay killed; see the third sighting.

**Routed to Dogu** in the room rather than assigned here, so that whoever builds it claims it in their
own name and the board says who is actually working.

## CLAIMED AND BUILT 2026-09-18 by Dogu, from Kenya's plan as written

Own worktree, `fix/raster-coverage-from-bytes`. Kenya's plan is what got built, unchanged in shape —
what follows is the build and what it measured, not a redesign.

**The fix.** `captureQuiescent` used to trust `covered` (the mask's flag) for every exit — the
quiet-settle happy path, `animating`, `resizing`, `blank`-or-`timeout` at the deadline all read it
as gospel, and only the final `!covered` branch consulted the mask's own count and
`uncoveredBounds(mask, …)` for a percentage and region. That is exactly backwards for a flag that
can be wrong: the full-rect fast path in `onFrame` sets `covered = true` on any frame declaring
itself whole-frame, never inspecting whether the bytes it just accepted are actually painted.

**Now there is one check, run once, right before the single `return`, regardless of which branch
set `settled`/`unsettledReason` above it:** scan the buffer's own alpha byte for any pixel reading
0. Real content is never alpha 0 (the composited frame is opaque, confirmed against
`targetSource.ts`'s `BrowserWindow` construction — no `transparent: true`, no custom
`backgroundColor`); an unpainted pixel is alpha 0 by construction, because the buffer starts
zero-filled BGRA. So "any alpha-0 pixel exists" is an unconditional fact about the bytes, independent
of what the mask or `covered` believe. If any exist, the verdict is forced to
`settled: false, unsettledReason: 'uncovered'`, with **both the share and the region computed from
that same scan** — never the mask. `uncoveredBounds(mask, …)` and its call site are gone; nothing
else read it.

**Headless CLI: confirmed shared, not assumed.** `grep -rl captureQuiescent src/` returns
`src/cli/main.ts` (the headless entry point) and `src/main/ipc.ts` (the live path) alongside
`capture.ts` itself — one function, both callers, so the fix is in the one place both share by
construction. Nothing CLI-specific was needed or written.

**The scan cost, measured rather than assumed a problem or assumed free.** A dedicated Node
benchmark (warmed up, 200-iteration average) at 1920x1080 (2,073,600 px): **2.0 ms** for a fully
opaque buffer (the worst case for this scan — nothing to find early, unlike the mask-based scan it
replaced, which only ever ran once a gap was already known to exist and could exit on the first
one). With a transparent band present: 2.4 ms. Against a capture whose own budgets run in seconds
(`timeoutMs` defaults to 30 000), this is not free but is not the dominant cost either — a number
for the record, per the acceptance item, not a reason to have skipped the check.

**A pre-existing test-fixture gap, found by the fix rather than assumed away.** `still one colour at
the budget is blank, not timeout` used `fullFrame(W, H, 0)` — a helper that fills every byte
including alpha with the same value — to represent a black frame. Byte-for-byte, that fixture is
identical to *never painted*, which nothing noticed until this fix started reading the alpha byte
for real. Not a regression in the fix: a fixture that was already modelling an impossible frame
(real content is always opaque) and had never been exercised on that axis. Fixed the one test that
depended on it (`opaqueBlack`, alpha 255 throughout, RGB 0) rather than touching the shared
`fullFrame` helper other passing tests rely on with non-zero bytes.

**New pinning test**, per the acceptance item: `a full-rect paint that lies about one of its own
rows is uncovered, not settled true` — an 8x8 frame (sized to land on `isFlatFrame`'s own 4-pixel
sampling grid, or the flatness check never looks at the lying row regardless of this fix) whose
row 4 declares itself part of a whole-frame paint while its bytes are still alpha 0. **Control,
done by hand**: with the final bytes-check's call removed, this test fails exactly as the
acceptance item predicts — `settled: true`, no warning. Restored, it passes:
`12.5% of the 8x8 frame never painted … (uncovered region 8x1 at 0,4)`.

**Verified, this worktree:** `npm run build` clean, `npm run typecheck` clean, full unit suite
1411/1411 (1410 passed, 1 pre-existing CI-only skip), `tests/unit/cliCapture.test.ts` 33/33
including the new test.

**Not run here, and said plainly rather than assumed passing:** the live e2e assertion this whole
card exists to satisfy — `NOT A FLAKY BASELINE` and its bytes-vs-stated tolerance check, both in
`live-capture-notes.spec.ts`, untouched (confirmed against `origin/main`, zero diff). Reading it:
the tolerance is 0.051 percentage points and this fix's stated numbers ARE the measured bytes
(same scan, same call), so the only expected gap is `.toFixed(1)` rounding — well inside tolerance
by construction, not by luck. But it needs a real Electron app and real Chromium to actually fire,
which this session cannot drive here. @Idris, this is exactly the thing your gate is for.

**Kenya's two things to measure were both measured, not assumed:** headless CLI (shared, confirmed
above) and scan cost (2.0–2.4 ms, confirmed above). Nothing here widens `NOT A FLAKY BASELINE` —
it is untouched and should stop firing.

## PASSED WITH ONE FINDING 2026-09-18 by Idris, decided rather than carded

**#361: PASS on `94450e0`.** Independently re-verified the mechanism, the scan cost (her own
benchmark: 2.3/2.4 ms — same order as the 2.0/2.4 ms above), and confirmed the live e2e this build
could not run itself: `live-capture-notes.spec.ts:351`'s `NOT A FLAKY BASELINE`, against real
Electron and real Chromium, passed clean. That closes the one thing this card's build entry
flagged as unverified.

**Her finding, reproduced and real: the unconditional post-loop check can silently replace an
already-true `unsettledReason` with `uncovered`, losing it.** Built a case — `awaitExpectedSize:
true` (what the live path, `ipc.ts:1787`, actually passes), a resize that never completes before
the deadline, combined with a full-rect delivery that also lies about a row. Before this fix, that
combination produced `resizing` with a bad buffer and the transparency went unmentioned entirely —
the original bug. After it, `unsettledReason` reads `uncovered`, and the resize fact is no longer
in the structured field a caller branches on — though it is still in `warnings[]`, since both
`onWarn` calls fire; nothing is dropped from what a human or a log reads, only from the one-value
enum.

**Decision, not left as a byproduct: `uncovered` keeps winning, deliberately, and the merge is not
blocked on it.** Two reasons, not one:

- **The acceptance item this card was built against names `resizing` and `timeout` explicitly** —
  "a capture never answers `timeout`, `resizing` or `settled: true` about a PNG with fully
  transparent pixels." Preserving `resizing` when bytes are transparent is the exact thing the
  card asked to stop happening, not a side effect to walk back.
- **Both of this card's two real historical sightings were exactly this shape.** `35238786585`:
  reply `timeout`, covered, transparent band. `35242350343`: reply `resizing`, covered, transparent
  band. Making `resizing`/`timeout` win over `uncovered` when both are true would silently
  reintroduce the two sightings this card exists to fix, to restore information for a case
  (`awaitExpectedSize` + a lying full-rect, at the same time) that has been *constructed*, not yet
  *observed*.

**What is real in the finding and is not being waved off:** a caller that branches on
`unsettledReason === 'resizing'` specifically to retry at a new size will not do that in the rare
case both faults land together, where before this fix it would have (on a buffer it should not
have trusted either way). That is a genuine, narrower blind spot traded for a wider one, exactly as
Idris framed it — recorded here as the reasoned tradeoff it is, not rediscovered as a surprise
later. If a caller needs to act on `resizing` specifically, `warnings[]` still carries that
sentence verbatim.

**Not touching the gated PR for this.** The behaviour is already what the acceptance item asks
for; what was missing was the stated reasoning, not a code change, and `CONTRIBUTING.md`'s own
rule that a push voids a verdict — no file-type carve-out — is not worth spending on a comment.
Recorded here instead.

Clear to merge, @Henry — Idris's PASS on `94450e0` stands, decision above is mine to make and I've
made it.
