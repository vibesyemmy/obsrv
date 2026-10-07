---
title: "A hand probe of obsrv_snap without mode: headless started the installed Obsrv on the real profile: revert it, or leave it?"
column: backlog
kind: chore
waiting: "Opeyemi: revert (on your word Idris removes the stray tab and the one history entry, with a copy of each file kept first) or leave (the next launch shows one stray active tab on a fixture file that will be gone after tonight; closing it clears it)?"
order: 133
---

DISCLOSED 2026-10-06 by Idris (room #4018). The default mode `auto` drives the visible app and launches one, so a probe that omits `mode: "headless"` ran the INSTALLED Obsrv against `~/Library/Application Support/Obsrv` for about 45 s. It left an extra tab in `tabs.json` (with `activeIndex` moved) and one entry in `history.json`. Only the probe's own pid was killed, nothing was edited, and the earlier bytes were not kept, so a revert would be a guess.

**What "leave" costs, which the line above does not say** (from the disclosure itself, room #4018): tab 1 is a `file://` fixture (`/private/tmp/obsrv-idris-arrivals/tests/fixtures/hairline.html`) and it is the **active** tab (`activeIndex` 1), so the next launch restores a stray second tab, active, on a file the midnight sweep will have removed; closing that tab clears it, and nothing else does. Tab 0, the GitHub pulls page, is intact. A stale `SingletonLock` and `control.json` for the dead pid were also left; a dead pid reads as no app under the single-instance rule, so they are harmless. **What "revert" would be:** remove tab 1, set `activeIndex` to 0 and delete the one history entry, keeping a copy of both files first, which Idris offered to do on a yes and has not done. Idris believes, and cannot show, that the original `tabs.json` was tab 0 alone with `activeIndex` 0; the earlier bytes were not kept, so that stays a belief.

The rule it points at, already practised in the room: a hand probe of an MCP tool passes `mode: "headless"` or runs under `OBSRV_TEST=1`, and checks `ps` for `/Applications/Obsrv.app` before and after.

Text drafted by Wren (room #4124) from Idris's disclosure and carried onto the board by Dogu; the figures are Idris's and none of it was re-checked by the carrier. **Idris first recommended leaving it, on the reason that the next normal use rewrites both files, and withdrew that in room #4129 because the reason hid the stray active tab: there is no recommendation now, and the choice is Opeyemi's.** A related card, `bug-drive-empty-call-launches-the-app`, is about a different thing (an empty `obsrv_drive` call starting the app) and is `done`.
