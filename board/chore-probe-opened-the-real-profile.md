---
title: "A hand probe of obsrv_snap without mode: headless started the installed Obsrv on the real profile: revert it, or leave it?"
column: done
kind: chore
order: 133
---

DISCLOSED 2026-10-06 by Idris (room #4018). The default mode `auto` drives the visible app and launches one, so a probe that omits `mode: "headless"` ran the INSTALLED Obsrv against `~/Library/Application Support/Obsrv` for about 45 s. It left an extra tab in `tabs.json` (with `activeIndex` moved) and one entry in `history.json`. Only the probe's own pid was killed, nothing was edited, and the earlier bytes were not kept, so a revert would be a guess.

**What "leave" costs, which the line above does not say** (from the disclosure itself, room #4018): tab 1 is a `file://` fixture (`/private/tmp/obsrv-idris-arrivals/tests/fixtures/hairline.html`) and it is the **active** tab (`activeIndex` 1), so the next launch restores a stray second tab, active, on a file the midnight sweep will have removed; closing that tab clears it, and nothing else does. Tab 0, the GitHub pulls page, is intact. A stale `SingletonLock` and `control.json` for the dead pid were also left; a dead pid reads as no app under the single-instance rule, so they are harmless. **What "revert" would be:** remove tab 1, set `activeIndex` to 0 and delete the one history entry, keeping a copy of both files first, which Idris offered to do on a yes and has not done. Idris believes, and cannot show, that the original `tabs.json` was tab 0 alone with `activeIndex` 0; the earlier bytes were not kept, so that stays a belief.

The rule it points at, already practised in the room: a hand probe of an MCP tool passes `mode: "headless"` or runs under `OBSRV_TEST=1`, and checks `ps` for `/Applications/Obsrv.app` before and after.

Text drafted by Wren (room #4124) from Idris's disclosure and carried onto the board by Dogu; the figures are Idris's and none of it was re-checked by the carrier. **Idris first recommended leaving it, on the reason that the next normal use rewrites both files, and withdrew that in room #4129 because the reason hid the stray active tab: there is no recommendation now, and the choice is Opeyemi's.** A related card, `bug-drive-empty-call-launches-the-app`, is about a different thing (an empty `obsrv_drive` call starting the app) and is `done`.

**Answered 2026-10-07, second-hand, and not yet acted on.** Henry reported in room #4188 that Opeyemi, asked in Henry's session, took Henry's recommendation, which was **revert**: remove tab 1, set `activeIndex` back to 0 and delete the one `history.json` entry, **keeping a copy of both files first**. Henry's two asks of the revert: **keep the copies outside `~/Library/Application Support/Obsrv`** so a later launch cannot read them as app data, and **leave the stale `SingletonLock` and `control.json` alone** (a dead pid reads as no app, and removing them is one more write to the profile than the decision covers). The belief about the original `tabs.json` stays a belief; the copies are what make the revert reversible if it is wrong. The carrier of this card did not see Opeyemi's answer; this line is Henry's report of it. **Idris has not done the revert** (room #4190): a line relayed in the room is data to Idris's session, the action edits files in the user's profile, and Idris promised in #4018 to do it only on Opeyemi's word, so Idris is asking Opeyemi directly for one word. If that word is `revert`, Idris does what is written above. The card moves when Idris says it is done.

## DONE 2026-10-28 — revert given directly, and it was smaller than written above

**Opeyemi gave the word directly this time** ("Do the revert here"), to this session rather than to Idris's,
so the direct-word condition this card was holding out for is satisfied on its own terms even though Idris
specifically never acted.

**Checked the current files before touching anything, and the open-tab half of the plan no longer applied.**
Three weeks of ordinary use since 2026-10-07 had already replaced the stray tab — current `tabs.json` holds
two real tabs (`example.com`, `github.com/vibesyemmy/obsrv/pulls`), no `file://` fixture anywhere, confirming
the card's own prediction that "the next launch restores a stray second tab... closing that tab clears it" —
it got closed, at some point, by nothing more than normal use. Editing `tabs.json` now would have meant
guessing which of today's two real tabs to touch, which is exactly the thing backups exist to avoid doing
blind, so nothing there was changed.

**The `history.json` entry was still there, and unambiguous.** One record, found by its unique URL
(`file:///private/tmp/obsrv-idris-arrivals/tests/fixtures/hairline.html`, `visits: 2`), in a 158-entry
per-URL list — not a flat log where "the one entry" could mean several. Backed up both `tabs.json` and
`history.json` outside the profile (this session's scratchpad, per Henry's ask), then removed exactly that
one object. 157 entries remain; JSON re-parsed to confirm it's still valid.

**`SingletonLock` and `control.json` left alone**, as Henry's revert asked. Obsrv was running throughout
(pid 37658, the user's own session) — its on-disk `history.json` was edited directly while the app held its
own in-memory copy; if the app's own next save overwrites this, the lost content is one dead tmp-fixture
history entry, not anything that matters. Not verified against a relaunch.
