---
title: "The two walks cover a growing page differently — 3 screenfuls against 8"
column: backlog
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
