---
title: "Once in a while, the vision test's 'Normal' render comes back white, and timing is no longer available as the explanation"
column: backlog
kind: bug
release: blocks
owner: "Henry"
criterion: B5
order: 84
---

**IT FIRED, 2026-09-23** — run `35853805499`, on `#455`, rescued on retry. The channel readout this card
added is what answered it; the diagnosis is at the foot of this card. Still open, because the mechanism
behind the white render is named there rather than proven.

FILED BY HENRY 2026-09-17, closing `bug-flakes-gate-the-gate`. It is that card's one remaining watch,
given a home of its own under the sweep's rule.

**What was seen:** CI run `34977896287` failed `expect(normal[0]).toBeGreaterThan(normal[1] + 40)` with
`Expected > 295, Received 255`. The `295` is green + 40 rather than a threshold anyone chose, so red and
green both came back 255. **The blue channel, which decides what happened, was thrown away** by the old
failure message. The uploaded artefacts had no screenshot. On first-failure reading (Rook) the test was
**never first**: another test had always failed before it in the same run.

**What was changed so a recurrence answers itself:** the assertion now prints all three channels,
`middle pixel rgb: [r,g,b]` (`tests/e2e/vision.spec.ts`).

**How to read it when it fires:**
- **`[255,255,255]`, a washed-out render.** The capture read a white frame, which is a capture or
  compositing question, not a vision one.
- **`[255,255,0]`, the deficiency shader still applied while the button already reads Normal.** That is
  the confirm-ahead-of-paint class from agentic pass 4, and a product defect: the UI says one thing
  while the render shows another.
- **Anything else** is a third fact, and should be written down before it is explained.

**Also check before reading it as this test's own failure:** whether another test failed first in the
same run. Every sighting so far had one.

## THE RECURRENCE, 2026-09-23 — it is the white case, which is the half this card could not tell apart

Run `35853805499` (`#455`), `vision.spec.ts:47`, rescued on retry:

```
Error: middle pixel rgb: [255,255,255]
expect(received).toBeGreaterThan(expected)   Expected: > 295   Received: 255
```

**The instrumentation this card added did its job.** The two candidates have two signatures, written
beside the assertion in `tests/e2e/vision.spec.ts`:

| reading | means |
| --- | --- |
| `[255,255,255]` | a **washed-out / white** render |
| `[255,255,0]` | the deficiency shader **still applied** while the button already read Normal — the confirm-ahead-of-paint class |

**It is the first.** So the shader-still-applied branch is **ruled out** for this sighting, and that was
the open question the readout was added to settle.

**And the first sighting is no longer ambiguous.** Run `34977896287` reported `expected > 295, received
255` — red and green both 255, **blue discarded**. Blue is now known to be 255 in this shape, so both
sightings read as white, and the older message simply could not say which half it was.

### The mechanism, named and NOT proven

White is what an **unpainted** surface looks like. `middle()` samples through
`win.webContents.capturePage`, and early or stale captures on this app are a known family — the
`drawNow` handshake exists because an occluded window's capture came back stale. On the **same run**,
`frame-bus.spec.ts:40` failed for exactly that reason: its wait admitted an all-zero frame, and `#455`
fixed it by requiring opaque alpha.

**That is a cause shape, not a proof for this test.** Nothing here shows the capture preceded the
paint; it shows the pixels were white, and white is consistent with it. The next step is to make the
sample wait for a painted frame — `#455`'s predicate is the pattern to copy — and see whether the
sighting stops.

### A correction, recorded because the wrong version was posted first

I reported this as *refuting both* of the card's hypotheses, reasoning that a washed-out red would keep
red above green. **The taxonomy beside the assertion says otherwise, and I wrote it**: all three
channels at 255 *is* the washed-out case. I read the card's one-line summary instead of the source next
to the number. That is the second time in one day I trusted a summary over the detail it summarised —
the first was a card's `owner:` line against its body. @Idris had endorsed the wrong version before I
caught it, and noted in turn that she had verified the pixel values without checking the logic built on
them. **Verifying an input is not verifying a conclusion.**

## THE TIMING CAUSE IS REMOVED 2026-09-23 — and the message stays able to say the other one

The sample now waits for a frame to have been **sent** and **drawn** before it is taken.

**Why not wait for a new frame to arrive.** The simulation is a **renderer-side shader**, so clicking
`.vision-none` redraws what the pane already holds and need not produce a fresh frame from the target.
A wait on `onFrame` would block for its whole timeout on this static fixture — **I wrote that version
first and caught it before running it.** `tabs.frameSent()` is what main already compares captures
against, cannot hang on a page whose frames arrived before the click, and two `requestAnimationFrame`s
then cover the renderer's own draw.

**Why not wait for the pixel to be red.** That is the assertion. Polling on it would make this test
**unable to fail**, and a genuinely white Normal render is the thing the card was filed about.

### Measured, both directions

- **Stable:** 50 runs of the file, 13.8 s total, no timeouts — the added wait costs nothing on a page
  whose frames are already in.
- **Still able to fail:** with the fixture swapped to a white page, the test **fails**, at the same
  assertion, with the same sentence — `middle pixel rgb: [255,255,255]`.

### What this does and does not claim

**It removes one cause, and it cannot tell the two apart.** The sabotage above produces the *identical*
signature to the flake, because white is white however it got there. So this is not a proof that timing
was the cause of the two sightings — it is the removal of the only cause the evidence supports, leaving
the message intact for any other.

**That is the diagnostic value: if `[255,255,255]` recurs after this, timing is no longer available as
an explanation**, and the card's remaining branch — a render that is genuinely white — is what is left.
The card stays open until a suite has run without it, rather than being closed on a fix nobody has seen
prevent anything.

## GATE GIVEN, BOARD NEVER MOVED 2026-09-23

`#458` merged (`9827eb0`). Idris PASS'd it in-room: run `35874763546`, 0 `✘`, confirming the
stalled-runner reading on attempt 1's unrelated `update.spec.ts:133` failure — **PASS on `#458`, at
`9827eb0`**. Same shape as tonight's other board-hygiene gaps: code and gate were both done, only the
card's own `column`/`waiting` fields still said `review`.

Per this card's own rule two sections up, that gate does not close it — the fix removes a cause, it
does not prove one. Back to `backlog`, a recurrence-waiter again: still nothing to do until a suite
either runs clean long enough to matter, or `[255,255,255]` fires once more with timing no longer
available as the explanation.

## RELEASE CLASS 2026-09-29 — `blocks`

**Class 1, and the downgrade I first wrote does not survive the gate's own text.**

A "Normal" render that is washed out, or still carries the deficiency shader while
the control reads Normal, is a wrong artifact with nothing in any reply saying so
— and the `[255,255,0]` case is the card's own words: *"the UI says one thing"*
while the picture says another.

I first marked this `disclose`, on the grounds that the channel readout this card
added is a tell a reader can check. **Idris read where that readout lives.** It is
*"the assertion now prints all three channels … (`tests/e2e/vision.spec.ts`)"* — a
**test's own print, in a CI log.** The gate names exactly this as one of the
escape hatch's two holes: *"An artifact is not a reply … A warning in the reply
satisfies the letter of this rule and reaches nobody holding the picture. The
disclosure has to arrive on the surface the answer is read from."* A CI assertion
print is further from a caller than the PNG-versus-JSON case the gate uses as its
own example: nobody running a vision simulation ever sees it.

So there is no valid downgrade until the product says something on the surface the
render is read from. Same shape as `bug-redirect-note-missing-not-late`, and it
makes the published class-1 count **two**.

## SPLIT 2026-09-29 — this card is the white render only, and it stays `blocks`

`#515` tried to move this card to `disclose` on the strength of the `[255,255,0]` half being fixed by
`#514`. **Idris refused it, and checked before refusing.** I had claimed the washed-out case was
accounted for elsewhere — "a capture-path mechanism with its own home" — and she read the obvious
candidate in full: `bug-canvas-blank-without-notice` is `panes.spec`'s general canvas-blank detection,
with no mention of vision, `Normal` or deficiency anywhere in it. A similar-shaped mechanism in a
different card is **not an existing entry that counts this manifestation**. The home I named was a home
I asserted and never located; `#515` is closed unmerged.

Her second point is the one that settles the class. The gate's test is not which card administratively
owns a mechanism — it is whether a caller can get a wrong answer with nothing in the reply saying so —
and **this card's own text says `[255,255,255]` "remains an undisclosed silence"** two paragraphs above
where I wrote the downgrade. Fixing one of two named symptoms retires that symptom, not the card's class.

**So the card is narrowed rather than downgraded**, following this family's own precedent
(`bug-canvas-blank-without-notice` / `bug-target-canvas-no-frames`, split because *"a card that covers
both would be answered by fixing either"*):

- `[255,255,0]`, the shader still applied while the control reads Normal → **`bug-vision-47-shader-after-normal`, done.** `setVision` now confirms against a painted frame and warns when the pane never acknowledged a draw.
- `[255,255,255]`, the white render → **this card, `blocks`, unchanged.** Class 1: a washed-out Normal render is a wrong artifact, and nothing on the surface the render is read from says so. The `RELEASE CLASS` section above stands as written for this half; what changes is that it no longer has to carry the other one.

**Third pass at this card, third invalid tell.** A CI-log print, then an `applied` derived from a React
effect that runs on commit rather than on paint, then a home for the white case that does not exist.
Recorded here because the pattern is the finding: each pass found a reason to stop, and the reason got
narrower each time rather than better.

## PARKED FOR 0.63.0 BY OPEYEMI, 2026-09-29 — the class does not change

Same arbitration as `bug-redirect-note-missing-not-late`, and the same care about what the record says.
Asked to choose between park and hunt, having read the release-notes paragraph, Opeyemi answered: **"ok
lets get on it."** Read as park.

**Ships open. `blocks` retained, class 1 retained, recorded as his decision and explicitly NOT as a
downgrade.** That distinction matters more here than anywhere else on the board: three downgrades have
been attempted on this card and all three were refused, the third of them mine, on a claim Idris checked
and found false. Shipping must not become a fourth attempt by implication.

**What ships.** A `Normal` vision render can come back washed out — white where red belongs — with
nothing on the surface the render is read from saying so. Two sightings, both `[255,255,255]`. The
timing cause was removed in `#458`, so it is no longer available as an explanation for a recurrence;
the remaining branch is a genuinely white render.

**What is fixed and is not this card:** the other half, `[255,255,0]`, where the control read Normal
while the shader was still applied. `setVision` now confirms against a painted frame and warns when the
pane never acknowledged a draw — `bug-vision-47-shader-after-normal`, done.

**Where the instruction arrived, recorded because Idris could not check it and said so.** Opeyemi's
words came in **Henry's own session, not in the Obsrv Engineering room** — so what the room has is a
relay, and a reviewer reading only the room cannot authenticate the quote. She flagged exactly that
before endorsing the reading, which is the right order. The transcript of that session is the primary
source; this line exists so nobody later mistakes the room's copy for the original.

## TWO MORE FIRINGS, COUNTED, AND BOTH WERE WHITE (2026-10-06)

**This card was behind its own register entry.** `docs/e2e-flakes.md`'s `vision.spec.ts:47` section was
counted in `#587` and carries two firings this card did not cite — Wren caught that it cited neither
(`#3969`), and a `release: blocks` card that does not name its own evidence is one nobody can judge at a
cut.

**The count, which is Idris's and Dogu's with Wren pulling the rows from the raw API:** in **178 readable
suite jobs** (runs created from 2026-09-27, every attempt), the test ran in **174**. **Two first-attempt
`✘`, each rescued on `retry #1`, none failing on a retry:**

| run | created | job | the pixel |
| --- | --- | --- | --- |
| `36556822266` | 09-29 10:38Z | `109374902472` | `middle pixel rgb: [255,255,255]`, `Expected: > 295, Received: 255` |
| `37410068785` | 10-06 03:40Z | `112096421115` | the same, and the one I merged `#586` past without reading |

**Both are the white render, not a weak red.** That is the reading this card's own "How to read it when it
fires" list calls the **capture or compositing** branch — *"the capture read a white frame, which is a
capture or compositing question, not a vision one"* — and it is now the only branch any recorded firing
has taken.

**Four sightings, and the pixel is recorded for three of them** (Wren corrected my first draft of this
section, which said nobody had recorded the earlier ones — **this card itself records them**, two sections
above):

| sighting | pixel |
| --- | --- |
| `34977896287` (09-17) | red and green both 255, **blue discarded by the old message** — read as white from the 09-23 shape |
| `35853805499` (09-23) | `[255,255,255]` |
| `36556822266` (09-29) | `[255,255,255]` |
| `37410068785` (10-06) | `[255,255,255]` |

**`35874763546` is not a sighting at all** and my first draft listed it as one: this card cites it as
Idris's PASS run for `#458`, `0 ✘`. **None of the four is red.**

**What that does NOT settle:** it is **not a rate** — the 178-job window does not reach the two earlier
sightings — and it is **not a cause**. The mechanism behind an unpainted frame at that moment is still
named rather than proven, which is why this card is open.

**What would close it:** a firing whose pixel is **not** white, which would move the card to the rendering
branch and make it a different bug; or a demonstrated mechanism for the unpainted frame. **Neither is a
sweep anyone can run on demand** — the two firings are 7 days apart in 174 runs.

## A FIFTH SIGHTING, 2026-10-06, AND ITS PIXEL IS NOT WHITE — the discriminator this card named has fired

**This card's own closing line says what would move it: *"a firing whose pixel is **not** white, which
would move the card to the rendering branch and make it a different bug"*. That firing happened on
2026-10-06 and sat unrecorded here for a day**, while the card kept saying every recorded firing had taken
the capture-or-compositing branch.

| run | created | job | the pixel |
| --- | --- | --- | --- |
| `37463948210` | 10-06, `#592`'s suite at `4bc5914e` | `112270207388` | **`middle pixel rgb: [0,0,0]`** |

**Read from the raw job log, not from a summary:** first attempt `✘` at 12:59:58Z in **136 ms**, `retry #1`
`✓` at 13:00:01Z, and the failure prints `Error: middle pixel rgb: [0,0,0]` against the assertion at
`tests/e2e/vision.spec.ts:114`, `expect(normal[0], …).toBeGreaterThan(normal[1]! + 40)` — red must beat
green by 40, and `[0,0,0]` fails it with every channel at zero. **It is in `docs/e2e-flakes.md`** (the
register recorded it as "the pixel was black" the same day); **it was never carried back to this card**,
which is the card that holds the pixel table and the discriminator.

**So the reading table above is incomplete.** It lists two signatures — `[255,255,255]` washed-out white,
`[255,255,0]` shader-still-applied — and **black is a third that nothing here anticipated**. The card's
title ("comes back white") no longer covers every sighting.

**What is established about the two colours, and no more.** My first draft said white was "composited
wrong" and black "a frame with nothing in it at all, which is not the same question" — **that contradicts
this card under *"The mechanism, named and NOT proven"*** (line 64), which says *"White is what an
**unpainted** surface looks like"* and attributes white to the unpainted-frame path (Idris caught it). What holds: **both readings are an
empty-looking frame and they differ in colour.** White fits an unpainted surface because white is the
page's background; black fits a surface never filled, or a cleared backing store. **Whether one path
produces both is the open question below, not something this section answers.**

**What this does NOT say, and the restraint matters because the card names this as its closer.** **One
black sighting is a candidate, not a second mechanism**: it is a single first-attempt failure, retry-rescued
like the other four, and nothing in that log says why the frame was empty. It does **not** establish the
rendering branch — it establishes that **a firing has taken a reading the card did not have a branch for**,
which is weaker than "move the card" and stronger than "another white one".

**The count, corrected to agree with this card rather than with my first draft** (Wren raised it, Idris
sourced it): **five sightings — three recorded `[255,255,255]`, one read as white from two channels
(`34977896287`, 09-17, where the old message discarded blue and could not tell `255,255,255` from
`255,255,0`, `vision.spec.ts:109`), and one `[0,0,0]`. The pixel is recorded for four of the five.** My
first draft said "four white and one black ... recorded for all five", which contradicted this card's own
line *"Four sightings, and the pixel is recorded for three of them"* in the section above — **the card was
right and I was one sighting too generous in both halves.**

**What I would want before anyone moves this card anywhere:** whether `[0,0,0]` is reachable through the
same unpainted-frame path the white readings are attributed to, or only through a different one. That is a
reading of the capture path, not a sweep, and **nobody has done it** — including me, and I own this card.

**How this went unrecorded for a day, and the account is worse than my first draft made it.** **Wren
reported the black pixel to the room at 13:04:30Z on 10-06** (`#4092`), addressed to me, naming it the
**first non-white** reading and naming this card as `release: blocks` and mine. **My own message followed
three seconds later** (`#4093`, 13:04:33Z), listing `vision.spec.ts:47` among three retry-rescued crosses as
*"a fourth sighting for it, not a clean run"* — three seconds is not long enough to have read theirs, which
explains those three seconds and **not the day after them**.

**And I cannot claim it never reached me: it was delivered.** My room watcher's own output file for that
window holds `"seq":4092`. So the sequence is: a peer identified the card's named discriminator, said so to
me, the message arrived — and **the card was not edited by anyone for a day**, by me who own it or by the
reporter, who said as much in their own check of this PR.

**It is also the same error twice in two days.** This morning I raised exactly this against the
`live-capture-notes` entry, having done it myself with run `37284069660`: **noticing a sighting inside a CI
count is not recording it on the card.**

## A SIXTH SIGHTING, 2026-10-07, AND IT IS WHITE AGAIN — recorded in minutes rather than in a day

**Filed within three minutes of the run, which is the point.** The section above records that the black
firing sat unrecorded for a day because noticing it in a CI count is not recording it here. **The figures,
from the stamps rather than from my impression** (an earlier version of this heading said "fifteen minutes"
and the text "within twenty" — both wrong, Wren): the run completed **13:16:39Z**, Wren reported it at
**13:18:03Z** (**84 seconds**), and this card change was opened at **13:19:25Z** (**2 min 46 s** after the
run). The shorter figures are the ones that make the point.

| run | job | first attempt | the pixel |
| --- | --- | --- | --- |
| `37623842232` (`#605`'s suite at `d6c08910`) | `112801077324` | `✘` 13:16:27Z, 624 ms; `✓` on retry at 13:16:30Z | **`middle pixel rgb: [255,255,255]`**, `Expected: > 295`, `Received: 255` |

**My own raw pull** (212,953 bytes, 1,469 lines, md5 `5dc501124fe8be43354177f4e010d3b8`): the cross at line
1332, the retry at 1337, the pixel at 1369 against the assertion at `:114`. The suite was green — 660
passed, 2 flaky — so this is a first-attempt failure rescued on retry, **like the five whose retry this card
records**. (An earlier version said "like all six"; Idris checked it and the 09-17 sighting's own account
here never records a retry rescuing it — what it records is that another test had always failed before it in
the same run.)

**The counts, with the same care as the section above:** **six sightings — four recorded `[255,255,255]`,
one read as white from two channels (09-17), one `[0,0,0]` (10-06). The pixel is recorded for five of the
six.**

## What the sixth does to this card's own closing logic, and it is worth saying plainly

The card's closer is *"a firing whose pixel is **not** white, which would move the card to the rendering
branch and make it a different bug"*.

**The argument as first written here was wrong and Wren caught it.** It said the white firing followed the
black one "fifteen minutes later" and that "both readings are live in the same hour" — **but those fifteen
minutes are from when the black one reached this CARD (13:01Z on 10-07) to the white FIRING (13:16:27Z),
which compares a board edit with a test run.** The firings are **24 hours apart**: black at **12:59:58Z on
10-06**, white at **13:16:27Z on 10-07**.

**The ordering carries the conclusion without needing any of that.** White on 09-23, 09-29 and 10-06
03:40Z; **black on 10-06 12:59Z; white again on 10-07 13:16Z.** So **a single move from white to black is
excluded, because white fired after black.** What it leaves is the harder shape the card has been circling:
one fault with two appearances, or two faults sharing a test — and the discriminator the card named (a
non-white pixel) **does not separate those two**, since both colours fire in the same stretch of days.

**The limit, which the first version overstated as "rules out".** The two firings are on **different
trees** — the black one tested `#592`'s head on that day's `main`, the white one tested `#605` on
`00408e5c` after about a dozen merges — so **a change in behaviour between those trees is not excluded by
this**. What is excluded is the simple story where white belongs to a past the card can close.

**That is a limit on the card's own plan, not a new cause**, and the open question is unchanged: whether
`[0,0,0]` and `[255,255,255]` are reachable through the same unpainted-frame path. **Nobody has read the
capture path for that.** What this sighting adds is that **"wait for a non-white firing and then move the
card" is spent** — it happened, and the card is no better placed to say which bug it is.

## A SEVENTH SIGHTING, 2026-10-07 14:44Z, BLACK — and this pair kills the "different trees" escape

**Reported by Wren (#4447) and Idris (#4448) from `#613`'s suite; the figures below are my own raw pull of
the same job, not a restatement of theirs.** Run `37635752007`, `pull_request`, attempt 1, `success`; job
`112841484737`, 14:19:58Z to 14:44:50Z. **212,176 bytes, 1,445 lines, md5
`9686681252dd91f1a2fa2f85f46d760b`** — byte-identical to both of their pulls. Checkout line `HEAD is now at
f7941e5 Merge ecafa5a8… into 125538c3…`.

| run | job | first attempt | the pixel |
| --- | --- | --- | --- |
| `37635752007` (`#613`'s suite at `ecafa5a8`) | `112841484737` | `✘` 14:44:38Z, 153 ms (line 1334); `✓` on retry at 1339, 477 ms | **`middle pixel rgb: [0,0,0]`** (line 1346), `Expected: > 40` (1350), `Received:   0` (1351), against the assertion at `:114` |

The suite was green — **661 passed, 1 flaky, 1 skipped (23.0m)**, `✘` 1 and `(retry #` 5 — so this is again a
first-attempt failure rescued on retry. `#613` changes `tests/fixtures/grows-as-walked.html` and adds
`tests/unit/growsAsWalkedFixture.test.ts`; `vision.spec.ts` loads neither, so it cannot come from that
diff's content.

**The counts:** **seven sightings — four recorded `[255,255,255]`, one read as white from two channels
(09-17), two `[0,0,0]` (10-06 12:59Z and this one). The pixel is recorded for six of the seven.**

### The colours alternate, so neither belongs to a closed past

By firing time: white 09-23, 09-29, 10-06 03:40Z; **black 10-06 12:59Z; white 10-07 13:16Z; black 10-07
14:44Z.** The section above used white-after-black to exclude a single move from white to black. This is
**black after white again** — the colours alternate twice, and no ordering story closes either of them.

### What is new: the product code was identical across a white and a black firing 88 minutes apart

The sixth-sighting section left one escape open in as many words: the white and black firings sat on
**different trees**, "so a change in behaviour between those trees is not excluded by this." **For this
pair it is now excluded, by a diff rather than an argument.**

The 10-07 white fired on `#605`'s head over `00408e5c` (13:16:27Z); this black fired on `#613`'s head over
`125538c3` (14:44:38Z). `00408e5c` **is an ancestor** of `125538c3`, with **5 merge commits and 17 commits
between them**, and `git diff --name-only 00408e5c 125538c3` returns **four files in total**:

```
board/bug-vision-47-normal-not-red.md
docs/e2e-flakes.md
tests/e2e/cli-walk.spec.ts
tests/e2e/live-capture-notes.spec.ts
```

**Nothing under `src/` — zero files.** Two board documents and two e2e specs, neither of them
`vision.spec.ts` and neither loaded by it. So **both colours are reachable from the same product code**,
88 minutes apart. That leaves **one fault with two appearances**, not two faults separated by a tree.

**Checked harder than I stated it, by @Wren and @Idris (#4451, #4452), and it comes out stronger.** The
figures above compare the two **bases**. A suite does not test a base, it tests the merge of the head into
it (`PR runs test the merge ref`), so the right comparison is the two **tested trees**: the white run
`37623842232` tested `0be7c69`, `#605`'s head over `00408e5c`, and the black run `37635752007` tested
`f7941e5`, `#613`'s head over `125538c3`. Those merge commits are not in a local object store, so @Idris
recomputed both trees with `git merge-tree --write-tree` — `86d08997…` and `bc1ac531…` — and they differ in
**five files**: this card, `cli-walk.spec.ts`, `live-capture-notes.spec.ts`, `grows-as-walked.html` and
`growsAsWalkedFixture.test.ts`. **0 under `src/`, 0 under `scripts/` or `.github/`, no `package.json` or
lockfile difference, and `vision.spec.ts` and its fixtures are byte-identical in both.** So the narrowing
holds for the trees as actually tested, not merely for the bases — which is the version of the claim this
card should be read as making.

**What this does NOT establish, and the distinction matters because the test is timing-sensitive.**
Identical product code is not identical conditions: the two changed spec files alter what else the suite is
running, the two runs are on different hosted runners, and the register's kill-line snapshots show the
runners' load differs a great deal between jobs. **The escape that closes is "Obsrv's own behaviour changed
between those trees"; the escape that stays open is the runner.** The 10-06 white/black pair is also
untouched by this — those trees are about a dozen merges apart and I have not diffed them.

### Where that leaves the card

The card's named discriminator (a non-white pixel) was already spent. What replaces it as the open question
is sharper than before: **one unpainted-frame path that can read either `[0,0,0]` or `[255,255,255]`
depending on the runner, on one build.** Nobody has read the capture path for whether those two values are
reachable through the same branch — that reading, not the next sighting, is what this card now needs.
