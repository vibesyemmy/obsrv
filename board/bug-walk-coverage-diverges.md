---
title: "The two walks cover a growing page differently — 3 screenfuls against 8"
column: doing
owner: "Rook"
waiting: ""
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

**What it does not settle, and the card should not be read as if it did:** whether a window that is
genuinely not rendering behaves differently. CI's window renders in both arms, so that clause is
still unobserved, and the desk-session unblocker above still stands. What is now unlikely is that
*focus* was ever the mechanism.

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

**So what is left is the growth timing itself, and the render clause this probe could not reach.**
CI's window answers `visible: true` with the flag off, which is a claim about the window and not
about compositing: a runner has no display, and a window that is shown but never painted renders no
more frames than a hidden one — the exact caution arm C was written to raise, now pointing at the
probe's own limit rather than at the flag's. **The desk-session unblocker stands, and it is now the
only one**: walk the fixture live in a window that is genuinely painting, and read `pageHeight`.
