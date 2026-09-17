---
title: "The two walks cover a growing page differently — 3 screenfuls against 8"
column: done
owner: "Rook"
kind: bug
criterion: C4
order: 31
---

Measured 2026-09-14 (obsrv-a6), same file, same session, both surfaces:

  headless  3 screenfuls, atEnd true, page measures 4712, covered 3072 → coverage note FIRES
  live      8 screenfuls, atEnd true, page measures 6832, covered 6912 → no gap, SILENT

Same URL: a warning on one surface, nothing on the other, and the two measurements are of different amounts of page. Each answer is internally consistent, which is what makes it hard to notice.

FIXTURE NOW IN THE REPO: tests/fixtures/app-shell-grows.html (merged 586caab) — an app shell whose inner feed extends twice as it is walked. No existing fixture had that shape; every other app-shell fixture walks further than the page measures, so none can make walkCoverageNote fire on an element scroller.

Handed to obsrv-e7 to run through the C4 parity harness, which catches exactly this asymmetry (a note-bearing array present on one surface and empty on the other) and is how the panel silence and the inspect gap both surfaced. obsrv-e7's read: if live really never fires the coverage note on an app shell, it is a seventh defect rather than a footnote to the sixth.

Cause still open: the `hidden` divergence, the two walks scrolling differently, or the growth being timing-dependent. obsrv-a6's one-off comparison could not separate them.

**RELEASED 2026-09-16. The session that owned this is gone.** Rook, Kenya and obsrv-e7 all ended
on 2026-09-15; the room's last message is 14 hours old. An owner line naming an absent session is
worse than no owner: it tells the next reader the work is in hand. **This card is takeable.**

## RE-OBSERVED ON `main` 2026-09-16 by Henry — the divergence does not reproduce under the harness

Main's CLI and MCP server (`58f4437`), against a harness app from the same tree. Live is
`obsrv_audit mode: live`, with the app set to the preset first through `obsrv_drive`, **because live
ignores `preset`.** A first pass that passed it anyway measured the app's own 1920x1080 screen and
looked like a divergence.

| preset | surface | runs | screenfuls | `atEnd` | `pageHeight` | coverage note |
| --- | --- | --- | --- | --- | --- | --- |
| `laptop-768` | headless | 3 | 3 | true | 4712 | fires: *3 screenfuls (3072 CSS px) … (7 screenfuls)* |
| `laptop-768` | live | 3 | 3 | true | 4712 | fires, word for word the same |
| `1080p-24` | headless | 2 | 2 | true | 4712 | fires: *2 screenfuls (3240 CSS px) … (5 screenfuls)* |
| `1080p-24` | live | 3 | 2 | true | 4712 | fires, word for word the same |

**The two surfaces agree on every run, and the note fires on both,** which is what the fixture's own
comment says it was built for: *"the walk does reach a real end and reports atEnd, while the page it
measures afterwards is taller"*. The 2026-09-14 reading (live 8 screenfuls, 6832, silent) was taken
in a visible app, on the day `219223e` changed how the coverage note measures growth on this same
fixture. Whether it was taken before or after that merge isn't recorded.

**What that leaves, by reading the code:** both walks take `atEnd` from the same step that
scrolled, before their dwell. The fixture grows from a `scroll` handler, which runs at the next
frame. So a walk whose `scroll` reply lands after that frame would see the growth and keep going. A
visible window renders every frame, and a hidden harness window may not. **That's the one
hypothesis still standing, and it's unobserved:** whether a visible app's reply lands after the
handler. Testing it needs a visible app (the dev lane), which this pass didn't use, because
`bug-lane-serves-another-tree` makes a shared lane unsafe to rebuild.

**Not a fix to make on this evidence.** Taking `atEnd` after a frame would make both walks follow
this fixture to its full height and silence the note the fixture exists to raise. Whether that's
right is a design question, and nothing observed today asks it.

**MOVED TO BACKLOG 2026-09-16 (Wren's call, Henry's hand): blocked, not dropped.** The only open
hypothesis needs a visible app, and nothing can safely provide one yet. **Unblocked by either:**
`bug-lane-serves-another-tree` (so the shared dev lane can be pointed at a tree without surprising
another session), or a visible-app session on Opeyemi's desk. **The next step when unblocked:**
walk `tests/fixtures/app-shell-grows.html` live in a visible window at `laptop-768`, and compare
with the table above.

## PROGRESS 2026-09-17 by Henry — the divergence CI caught was a sync-bus double load, and #171 removed it; the growing-page one is still unreproduced

**What came in (run `35155348601`, first try):** `surface-parity:543` failed on `obsrv_audit walked.atEnd`,
on the `redirect` page (an HTTP 302 to `/landed`). Headless reported `true` and live `false`, and the two
agreed on the retry. The parity collector's own stdout already held the tell: live's walk took `ms: 1038`,
while `lint`'s walk on the same page took 15 ms. The scroll reply timeout is 1000 ms.

**Measured, not read** (`probe/live-walk-scroll-timeout`, run `35158932493`: parity moves→redirect ×12, every
main-frame navigation and scroll round-trip traced). The same sequence appeared in 4 of 12 apps:
1. `navigate('/redirect')` expected `/redirect` on both panes, and the native pane committed `/landed` first.
2. That commit was not an echo, and the target had not committed yet, so the bus mirrored `/landed` into
   the target. The target then started a second load and committed `/landed` twice.
3. The walk's first scroll, sent between the two commits, was never answered. When the lost scroll was
   `next` rather than `top`, the walk stopped with "did not confirm a scroll" and `atEnd: false`.

**Fixed in #171:** a server redirect of a navigation the bus issued is now issued too, so its commit is an
echo. The same probe on the fix (run `35160092144`): 4/144 scroll timeouts → 0/144, second target loads
7/48 → 0/48, aborted loads 6 → 0, and live `redirect/audit` `atEnd: true` 12/12. Kenya's cold read ran
her arrivals arms against the branch and confirmed nothing else moved. Client-side redirects are
`bug-arrivals`.

**The card's own divergence is untouched:** 3 screenfuls headless vs 8 live on `app-shell-grows.html`. It
doesn't reproduce under the harness (the table above), and the one open hypothesis still needs a visible
app. **Back to Backlog, unowned, blocked as before** (the unblockers are listed above). A parity flake on
`walked` from now on is new evidence, because the redirect cause is gone.

## Claimed by Rook 2026-09-17, assigned by Wren — with an unblocker the card does not list

The card says the one open hypothesis needs a visible app, and that the unblockers are
`bug-lane-serves-another-tree` or a session on Opeyemi's desk. **There is a third, and it arrived
after this card was last edited: `OBSRV_TEST_TAKES_THE_DESK=1` on CI.**

`#114` added that flag: a harness app launched with it uses `show()` and takes focus as a user's app
would, instead of `showInactive()`. It takes a desk **by design**, which is why it needs Opeyemi's
word on his machine — and why **a CI runner is the right place for it**, where there is no desk to
take and no word needed. Henry has already used a CI probe this way twice (`dock.hide()` activation,
and the live walk's lost scroll), so the shape is established rather than invented here.

So this is runnable now, without waiting on the lane and without asking for the desk.

### The hypothesis, restated so the arms can be pre-registered against it

Both walks take `atEnd` from the step that scrolled, before their dwell. The fixture grows from a
`scroll` handler, which runs at the next frame. **A visible window renders every frame; a hidden one
may not.** So a walk whose scroll reply lands *after* that frame sees the growth and keeps going —
8 screenfuls — and one whose reply lands before it stops at 3.

### Pre-registered, before anything runs

**Arm A — hidden (today's harness), `laptop-768`, `app-shell-grows.html`, live and headless.**
I expect Henry's table to reproduce: 3 screenfuls, `atEnd: true`, `pageHeight` 4712, the note firing
on both. **If it does not, #171's fix or something since has moved this**, and that is the finding —
the card says a parity flake on `walked` from now on is new evidence.

**Arm B — the same, with `OBSRV_TEST_TAKES_THE_DESK=1`.**
- **If live goes to 8 screenfuls and falls silent**, the hypothesis holds: the divergence is frame
  timing, the 2026-09-14 reading was a visible app, and the card has its cause.
- **If it stays at 3**, the hypothesis is dead and the 2026-09-14 reading needs another explanation —
  `219223e` landed the same day and changed how the note measures growth on this very fixture, which
  is the next thing to look at.

**Arm C, and without it the other two are worth nothing.** A CI runner's "visible" is not obviously
a desk's visible: a window that is shown but never composited may render no more frames than a hidden
one. **So the probe must first show it can tell the two apart at all** — count frames, or observe any
behaviour that differs between the flag being on and off. If nothing differs, arm B's result is
*unmeasured*, not negative, and must be reported that way rather than as "the hypothesis is dead".

This is the arm I would skip if I were in a hurry, so it is written down first.

### Desk

Nothing here runs on Opeyemi's machine. Arms A–C are a throwaway CI branch. The local half is
headless and `launchApp` only; **no `cli-*` specs**, which front the app through the second launch
path (`bug-e2e-takes-the-desk`).

## THIRD UNBLOCKER TRIED 2026-09-17 by Rook: `OBSRV_TEST_TAKES_THE_DESK=1` on CI, where there is no desk

`probe/walk-visible`, `tests/e2e/zz-walk-visible-probe.spec.ts` — throwaway, never merged. Run
`35164332256`, dispatch 3. Arms pre-registered on this card before any of them ran.

**Arm C first, because it decides whether arm B is a measurement or a void.** Reading the *target*
window (`__obsrv.win` — dispatches 1–2 read `getAllWindows()[0]`, which is the overlay, and reported
on the wrong window):

| flag | found | visible | focusable | focused |
| --- | --- | --- | --- | --- |
| ON | true | **true** | **true** | **true** |
| off | true | **true** | false | false |

**The flag changes something observable, so arm B is measured — but what it changes is activation,
not visibility.** On a runner the window is visible either way. That matters, because the standing
hypothesis rests on *"a visible window renders every frame, and a hidden harness window may not"*,
and this probe never produced a non-rendering window. It tests the focus clause, not the render
clause.

**Arms A/B — four walks of `app-shell-grows.html` at `laptop-768`:**

| surface | flag | screenfuls | `atEnd` | `pageHeight` | walkMs | coverage note |
| --- | --- | --- | --- | --- | --- | --- |
| headless | ON | 3 | true | 4712 | 467 | fires |
| headless | off | 3 | true | 4712 | 612 | fires |
| live | ON | 3 | true | 4712 | 1787 | fires |
| live | off | 3 | true | 4712 | 1874 | fires |

**Identical, all four.** The 8-screenful reading does not reproduce with the window activated, and
live and headless do not diverge from each other in either arm. All four carry the same note, which
says the walk scrolled *a panel on the page, not the page itself* — the fixture's own shape.

**What this settles:** activation is not the variable. A focused, focusable window walks this page
exactly as an unfocused one does, on both surfaces.

**What arm C alone does not settle:** whether a window that is genuinely not rendering behaves
differently. That is the render clause, and arm D below measures it rather than leaving it to the
desk.

**Dispatch history, because two of the three were void and it would be dishonest to cite "three
runs":** dispatch 2 died on `require is not defined` inside `app.evaluate` (the electron module
arrives as the destructured first argument); dispatch 1's arm C read the overlay. Only dispatch 3 is
evidence.

### And the next suspect the card names is not one — `219223e` cannot produce this

Arm B was pre-registered to send the card to `219223e` if live stayed at 3, since it landed on
2026-09-14 and changed how the note measures growth on this very fixture. **Read it: it cannot
explain the reading.** `ed0d99c` adds `pageHeight` to each walk step, carries `pageHeightAtStart` out
of the walk, and swaps the note's `held` inference for that measurement — so it changes *what the
sentence says* and *when it says it*. The scroll loop, the scroller choice and the stopping condition
are untouched. A walk goes exactly as far after it as before.

**Which matters, because the 2026-09-14 reading was not a note difference.** Live reported 8
screenfuls against a `pageHeight` of **6832**; headless reported 3 against **4712**. Live saw a
*taller page* — the fixture had grown further under it. No wording change produces that.

### ARM D: the render clause is refuted too, by mechanism and by measurement

A first draft of this section said the render clause was out of reach, on the grounds that *"a
runner has no display, and a window that is shown but never painted renders no more frames than a
hidden one"*. **Henry held the PR on that sentence, and he was right to: it was unmeasured**, and it
would have sent the render clause to Opeyemi's desk — the one unblocker that costs him something —
on an assumption. What is actually known points the other way: `ci.yml`'s header says the macOS
runners provide the display session Electron needs, CI draws classic scrollbars (`#63`),
`visibility.spec` gets real show/hide events, and `focusWindow` makes a window key.

**So it was measured instead.** Arm D counts `requestAnimationFrame` callbacks over one second on
two surfaces — the window's own renderer, and the **target's** `webContents`, which is the one the
hypothesis is about, since the fixture grows from a `scroll` handler that runs at the next frame —
then hides the same window and counts again, reading `isVisible()` back during the hidden count so
the control cannot be one that was never applied.

**Locally, on a real display, macOS 25.5, verified `visible: false` for the hidden pass:**

| pass | window `isVisible` | window rAF/s | target rAF/s |
| --- | --- | --- | --- |
| shown | true | 62 | **32** |
| hidden | **false** | 62 | **32** |

**And on the runner itself** (dispatch 4, run `35165871681`, both flag arms, `isVisible()` read back
the same way):

| flag | pass | `isVisible` | `isFocused` | window rAF/s | target rAF/s |
| --- | --- | --- | --- | --- | --- |
| ON | shown | true | **true** | 60 | 24 |
| ON | hidden | **false** | — | 54 | 18 |
| off | shown | true | false | 53 | 19 |
| off | hidden | **false** | — | 57 | 21 |

**Which corrects my sentence twice over, and Henry's four counter-facts were right: the runner
paints.** 53–60 frames a second on the window's renderer is a display session doing its job, not a
window that is never composited. And the shown/hidden differences do not track visibility — with the
flag off the window counted *more* frames hidden (57) than shown (53), which is not a direction
visibility can produce. One run per cell, so the small differences are not worth a verdict; the
absence of a consistent direction is.

The runner's target sits at 18–24 rather than the 30 it is capped to, which is a slower machine
missing its budget — and it misses it identically shown and hidden.

**So hiding the window changes neither count, on either machine.** The reason is structural rather
than incidental:
the target is not drawn by the display compositor at all. `targetSource.ts:316` creates it as an
`offscreen:` Chromium window and `:329` sets `wc.setFrameRate(this.fps)`, `DEFAULT_FPS = 30` — which
is the 32 measured. **Its frames come from Electron's offscreen pipeline at a fixed rate, so no
amount of showing, hiding, focusing or unfocusing the app window can change how many the page under
test gets.**

**That refutes the hypothesis at its premise.** *"A visible window renders every frame; a hidden
harness window may not"* is false for the surface that matters here. Arm B's null result is now
explained rather than merely observed: focus and visibility could not have mattered, because the
thing running the growth handler is rendered offscreen either way.

**And it takes the desk session off this card.** The render clause does not need a painting window,
because the target never used one — and the runner turns out to have been painting all along.

**Where the desk was, this is now.** Dispatch 4 replicates arms A/B exactly (3 screenfuls, `atEnd`,
4712, note firing, all four), and with them the one asymmetry that does reproduce every time:

| surface | dispatch 3 | dispatch 4 |
| --- | --- | --- |
| headless walk | 467 / 612 ms | 463 / 496 ms |
| live walk | 1787 / 1874 ms | 1787 / 1770 ms |

**The live walk takes ~3.7× as long for the same three screenfuls**, on both dispatches and in both
flag arms. The fixture grows from a `scroll` handler, so wall clock between steps is exactly the
quantity the growth depends on — and the two surfaces hand it very different amounts even when they
agree on the answer. **That is the next place to look, and it needs no desk and no flag:** what the
live walk spends 1.3 extra seconds on, and whether a headless walk slowed to match starts following
the growth. Recorded as a direction, not a finding.

**Desk:** nothing on this card ran on Opeyemi's machine in a way that took the front. The local arm D
was harness-only — launched without `OBSRV_TEST_TAKES_THE_DESK`, so `showInactive()`, which the run's
own line confirms (`flag=off`, `focused: false`) — then `hide()`, then `showInactive()` again.
Everything else was CI.

## THE MECHANISM, MEASURED 2026-09-17 by Rook — and the card's two numbers are one growth and two

Wren asked where the live walk's extra ~1.3 s goes and whether a headless walk slowed to match
follows the growth. The first half is arithmetic in the source; the second half turned out to have a
mechanical answer that makes the experiment unnecessary.

### Where the 1.3 s goes: two constants and a round trip

`WALK_DWELL_MS = 350` (`src/mcp/walk.ts:26`) against `HEADLESS_WALK_DWELL_MS = 150`
(`src/cli/walk.ts:32`). Over three screenfuls that is 1050 ms against 450 ms — **600 ms of the gap is
a deliberate difference in the two constants.** Headless measured 463–612 ms total, so it is dwell
plus almost nothing. Live measured 1770–1874 ms, so after its own 1050 ms of dwell about **720 ms is
the live path's per-step cost** — the control round trip and the app's own handling, against a direct
`executeJavaScript` headless. Neither half is mysterious, and neither is a defect.

### Why slowing the headless walk cannot change what it covers

**Measured in a real Chromium against the fixture** (browser pane, no Electron, nothing fronted):

| reading | `feed.scrollHeight` |
| --- | --- |
| before the scroll | 2552 |
| **immediately after `scrollTop = scrollHeight`, same task** | **2552** |
| 200 ms later | 4672 |

**The growth has not happened when the same task reads back.** `scroll` events are dispatched
asynchronously, so the fixture's handler has not run yet — and **both** walks compute `atEnd` in the
same task as the scroll they just applied (`shared/scrollHost.ts` `walkStep` headless;
`preload/sync.ts` `reached = applyTo(...)` then `atEnd: atEndOf(...)` live). So the end each walk
reports is always the **pre-growth** end.

The dwell happens *after* that reading. It can only affect what a *next* step would see — and once
`atEnd` is true there is no next step. **So dwell length cannot change coverage on either surface,
and the experiment would have measured nothing.** Pre-registered before the measurement, and this is
why: the prediction was "no change", for this reason.

### The card's two numbers are exactly one growth and two

The fixture grows twice and then stops (`grew >= 2`). Measured heights, and the card's readings
beside them:

| state | `feed.scrollHeight` | card's `pageHeight` |
| --- | --- | --- |
| one growth | 4672 | **4712** (headless, and every walk since) |
| two growths | 6792 | **6832** (live, 2026-09-14) |

Both card readings are exactly 40 px more, which is the shell chrome outside the feed —
`document.documentElement.scrollHeight` against the feed's own. **So the 2026-09-14 live walk took
one step more than today's walks do**, triggering the second growth; it was never measuring a
different viewport or a different page. The divergence was one extra step.

**What that leaves, and it is now a narrow question:** what let that walk take a fourth step when
`atEnd` had been reported pre-growth. On the current tree neither surface can, and that is
structural rather than incidental. The remaining candidates are a tree in which the live path read
`atEnd` in a later task than it applied the scroll, or a step that failed to reach the bottom and so
reported `atEnd: false` honestly. Both are questions about **which build produced the 2026-09-14
reading**, not about live against headless.

**Not a fix on this evidence, and the card's own earlier note still stands:** taking `atEnd` after a
frame would make both walks follow this fixture to its full height and silence the note the fixture
exists to raise. What is new is that the note is not a near-miss — it is what a same-task `atEnd`
must produce on a page that grows from its own scroll handler.

## ARCHAEOLOGY 2026-09-17 by Rook — one candidate is impossible, so the missing SHA does not matter

The section above left a narrow question: **which build produced the 2026-09-14 reading that took a
fourth step?** Two candidates were named — a tree whose live path read `atEnd` in a *later task* than
it applied the scroll, or a step that genuinely failed to reach the bottom and so honestly reported
`atEnd: false`.

**No SHA was recorded.** `6832` appears nowhere but this card: not in `docs/research/`, not in the
C4 field sweep (that one is obsrv-e7 against `6b59868`, and its 8-screenful figure is a different
page at 8048 px). So the reading cannot be tied to a build directly.

**It does not need to be, because the first candidate never existed.**

**A first version of this section proved it with a line search, and that was not good enough** —
Wren caught it. Searching for the line that computes `atEnd` shows only that *that line* never
changed. The candidate is about **task ordering**: whether the scroll and the read happen in one
synchronous turn. An `await` added earlier in the handler, or `applyTo` becoming async, or the send
moving into a callback, would all break that **without touching the line**. This board already
records a line-based search giving a false negative ([[grep-false-negatives]]).

**Settled at the level the claim is actually about — the whole handler.** Following
`ipcRenderer.on(APPLY_SCROLL, …)` through `586caab..origin/main` turns up two commits that touch it,
`02656b8` and `ed0d99c`, both on 2026-09-14. Each tree in the window, and the base and the head,
read out the same way:

| tree | handler `async` | suspension points in the body | `applyTo` → `send` |
| --- | --- | --- | --- |
| `586caab` (fixture lands) | no | **0** | +4 lines |
| `02656b8` | no | **0** | +4 lines |
| `ed0d99c` | no | **0** | +4 lines |
| `origin/main` | no | **0** | +4 lines |

Suspension points counted as `await`, `async`, `.then(`, `setTimeout`, `requestAnimationFrame` and
`queueMicrotask` anywhere in the handler body. **There are none, in any of them.** The handler cannot
yield between applying the scroll and sending the result, so the read cannot land a task later.

So **on every tree on which this fixture could be walked, the live path applied the scroll and read
`atEnd` in one synchronous turn.** That candidate is not unverified; it is impossible — and now that
rests on the handler's control flow rather than on one line surviving a grep.

For the record, the line itself was introduced in `206b0cf` (2026-09-07), the commit that added
`atEnd` at all, and has not changed since. That is true and it was never sufficient.

### Which leaves the second, and it needs no special build

A step that did not reach the bottom reports `atEnd: false` honestly — `reached = applyTo(el, pos)`
and then `atEndOf(scrollerEl, reached)`, so a scroll that fell short is exactly what that returns.
The walk then takes another step, which is the fourth step the reading shows, and that step triggers
the second growth: 8 screenfuls and `pageHeight` 6832, which is two growths plus the shell chrome.

**And a short scroll is the thing the live path is most exposed to**, for a reason this card already
measured: the live walk takes ~3.7x as long per step as the headless one. Growth arrives
asynchronously from the previous step's `scroll` handler, so a step applied while the feed is still
reflowing can land short of a bottom that is itself moving.

**So the question closes as answered rather than unknowable.** Not "which build", but: the only
mechanism available on any build is a short scroll on a growing scroller, and that is timing, not a
tree. Whether to *do* anything about it is unchanged — the card's existing position stands, that
taking `atEnd` after a frame would silence the note the fixture exists to raise.

**What would still be worth measuring, for whoever wants it:** whether a live walk on this fixture
ever reports a step short of the bottom, by recording `reached` against the scroller's extent per
step. That is a probe, it is desk-free, and it would turn the remaining sentence from a reading of
the code into an observation.

## DONE 2026-09-17: the divergence is explained by measured mechanism, and no fix is wanted

**Moved to Done by Henry**, on Opeyemi's instruction to take the Doing cards to Done one at a time
(relayed in room #440). Rook's session is out. The last open question was settled by Rook's
archaeology in `#246`.

**The card's question was why the two walks covered one growing page differently. It is answered:**
- **The two numbers are one growth and two** (*THE MECHANISM, MEASURED*). 3 screenfuls and 4712 is
  the page after one growth; 8 and 6832 is the page after two.
- **What decides between them is timing, not a build.** The live walk takes about 3.7× as long per step,
  and growth arrives from the previous step's `scroll` handler. So a step applied while the feed is
  still reflowing can land short of a bottom that is itself moving, and the walk takes one more step.
- **The other candidates are excluded:** the render clause by mechanism and by measurement (arm D), and
  the SHA candidate as impossible on every tree that could have walked this fixture (*ARCHAEOLOGY*).
- **The design position is unchanged, and that is what closes the card rather than a fix.** Taking
  `atEnd` after a frame would make both walks follow this fixture to its full height, and would silence
  the note the fixture exists to raise.

**The leftover is filed, not folded in:** the last sentence above, *a short scroll on a growing
scroller*, is a reading of the code. Rook named the probe that would make it an observation, which is
recording `reached` against the scroller's extent at every live step. It is desk-free, and it is now
`chore-live-walk-short-step-probe`.

