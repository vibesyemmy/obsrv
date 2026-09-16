---
title: "Run 19: the live app, which two runs excluded and both said so"
column: doing
kind: readiness
owner: "Rook"
criterion: B1
order: 18
---

**GO-AHEAD FROM OPEYEMI 2026-09-15. Rook starts.**

**One practical matter that has no equivalent in runs 17 and 18, and it is worth settling before
the first call: this run happens on Opeyemi's desktop.** The live path drives the window a
person is looking at. Launching or driving the app takes over part of his screen, and the
single-instance lock means the tools act on whatever Obsrv is already running rather than a
private one.

That cuts three ways and all three are the run's business rather than obstacles to it:

- **Timing is his.** Agree when, rather than starting and discovering he was mid-something.
- **He is the audience.** The whole question is what an agent watching the app is told; a person
  watching the same window at the same time is the cheapest possible check on whether the
  answers match what is on screen. That is a better instrument than any assertion, and it is
  available for exactly as long as he is there.
- **Anything that goes wrong is visible.** A headless run that misbehaves produces a bad PNG. A
  live run that misbehaves moves his window. Prefer small, reversible calls first.

ROUTED TO ROOK 2026-09-15 on Opeyemi's word, pending Rook's own go-ahead in Rook's session.

**This is B1's last documented gap, and Rook named it before being offered it:** *"the live app is
the one where my coldness is actually worth something. Every call I have made in two runs was
headless, so I have never seen the window, the drive surface, or what an agent watching the app
is told. Run 17 and run 18 both excluded it explicitly and both said so, which makes it the
documented gap now."*

Both runs wrote that exclusion into their own results rather than leaving it to be discovered —
run 17's *"nothing run live in the app — this run was headless throughout"*, and run 18's
*"nothing live, run 17's remaining sites unvisited."* Two promises to check later. This is later.

**Rook's coldness here is the last of it, and it is the strongest of the three.** Run 17 spent
its ignorance of `audit` and `lint`; run 18 spent `report` and `diff`, and Rook reported the
asset gone unprompted — *"whatever runs them next should be someone else."* The live app is the
only surface left that Rook has never seen. After this run there is no cold reader on this board
for any part of the product, and that is a thing to spend deliberately rather than let expire.

## What "the live app" means, so the scope is not invented at the keyboard

The headless path renders offscreen and returns a PNG. The live path drives **the window a
person is looking at**, and it is a different product with different failure modes:

- the visible window and its chrome — tabs, the URL strip, the toolbar, the agent-control toggle
- `obsrv_drive` — scroll, click, pan, highlight, onion skin, `capture: 'pane'`
- `audit`, `lint` and `inspect` in `auto` / `live` mode rather than headless
- what `status` tells an agent about the tab it is acting on, and whether that survives the user
  moving it

`src/mcp/server.ts` mentions `live` 140 times. None of it has been read by a cold reader.

## What this card is actually for, which is not "does it work"

**The product is what an agent is told.** `docs/read-the-output-not-the-code` is the standing
argument: the warnings ARE the product, and the way to check a sentence is to have a peer read
it cold. Headless answers have been read that way twice. **Live answers never have.**

So the question is not whether drive scrolls. It is whether an agent driving the app, reading
only what it is told, would form a correct picture of what the window is showing — and whether
it would notice when it had not.

## The known hazards, so a limit is not filed as a defect

- **A second instance clobbers `control.json`.** `fix/single-instance` landed a lock and stamps
  pid + startedAt; MCP discovery treats a dead pid as no app. If two Obsrvs are up, expect the
  drive to act on one and the reader to be watching the other — see `drive-instance-clobber`
  and `bug-lane-serves-another-tree`.
- **The tools act on the FRONT tab, resolved per command.** The user can move it under you.
  Every result names `tabId` and `tabIndex`; if state must hold across calls, check `tabId` did
  not change rather than assuming.
- **`focusWindow` / `app.focus({steal})` is refused on macOS 14+** unless the front app yields.
  That is the OS, not a bug.
- **`report` stays headless by design.** Not a gap in this run.

## Pre-register the vacuity check, which is house style

Before running, name the result that would mean *this run did not exercise the live app*.
Candidates worth deciding in advance: every call answering with `navigated: false` on a window
nobody was watching; a drive session where the app was never actually frontmost; or a run where
every finding read is one the headless path already produced, which would mean the live surface
was exercised but not *read*.

## What it does NOT close

Run 17's two remaining sites, and whether the report overview's pins and crops **land** where the
findings are — run 18 established only that the page explains what it could not locate. B1 is met
when a run finds nothing user-visible; runs 13 through 18 each found something.

Constraints are Rook's own: own worktree off current main, rebase early, Review not main, merge
on Opeyemi's word direct to Rook, design to him before writing.

**One thing that has changed since Rook last started a card:** the generated board views are no
longer committed. A card edit conflicts with nothing. `npm run board` writes them locally, and
if a branch still touches those two files its changes to them vanish on rebase, which is correct
and looks alarming the first time.

**RELEASED 2026-09-16. The session that owned this is gone.** Rook, Kenya and obsrv-e7 all ended
on 2026-09-15; the room's last message is 14 hours old. An owner line naming an absent session is
worse than no owner: it tells the next reader the work is in hand. **This card is takeable.**

**Run 19 was started and never delivered.** The go-ahead is on this card and the queue said *started*; nothing was produced. Whoever takes it starts from the card, not from a handover.

**THE RELEASE ABOVE WAS WRONG AND IS REVERSED. Rook is not gone — it is `obsrv-a2`, and it was
waiting exactly as this card instructs.**

Henry read *no delivery* as *abandoned*. It fits *waiting on the timing this card demands* at
least as well, and that is what it was. **The instruction being obeyed was Henry's own**, written
onto this card: *this run happens on Opeyemi's desktop — timing is his, agree when rather than
starting and discovering he was mid-something.* Rook presented the design and stopped, which is
the card working.

A silence read as absence, when the silence was compliance. Third instance of this family in two
days and the first where the author of the instruction was the one who misread the obedience.

**Still with Rook. Run 19 is not free.**
