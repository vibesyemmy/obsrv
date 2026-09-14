---
title: "C5 is the criterion that catches what field comparison cannot"
column: done
kind: readiness
criterion: C5
owner: "Kenya"
---

MERGED 2026-09-14 on Opeyemi's word, as 3f92680 on main, pushed. Verified here before pushing rather than taken on the branch's report: typecheck clean across all three configs, and live-drive 45 passed, 58.4 s against Kenya's 58.1 s.

And checked that the NEW TEST ACTUALLY RAN, which on this card of all cards is not a formality — a suite passing 45 while the one new test was skipped is exactly the defect being closed. `tests/e2e/live-drive.spec.ts:963`, listed as 35/45 in both runs, no skips, no flakes. Two runs, and unlike the retina verification these are genuine corroboration: the test provokes pane RESIZING, which is independent of the desk's display scale, so a second run on the same machine is not the same measurement twice.

C5 remains PARTLY MET and the merge does not change that: the 41 headless and MCP call sites are still unchecked, and readiness.md says so rather than implying otherwise.

DELIVERED 2026-09-14 by Kenya, into Review. Branch `docs/c5-note-inventory` (as of 856d268 + 5c6ad3d, rebased onto 98d3f82). THE BRANCH IS THE ADDRESS; the shas are a timestamp and do not survive a rebase — these are already the second set, the first being 6b7acb4 + d1706f0. Rebase was clean, no conflicts, and re-verified after it: live-drive 45 passed, 58.1 s, the same count and the same duration as before. Kenya confirmed 98d3f82 was in origin/main by merge-base before rebasing onto it rather than reading it off a message. NOT merged, NOT pushed — waits on Opeyemi's word given to Kenya directly. Split out from bug-retina at Henry's request so that one can merge first; no file appears in both branches, so they merge in either order.

Touches docs/breaking-changes.md, docs/note-inventory.md, docs/readiness.md, tests/e2e/live-drive.spec.ts. live-drive: 45 passed, 58.1 s.

d1706f0 also rewrites the 0.61.0 entry in docs/breaking-changes.md: `Decided 2026-09-14 rather than arrived at` now reads as OBSERVED, three of three. It keeps the eight-viewport cycle AND the 30,000-flip negative result, because the obvious two-preset test returns `animating` and reads as proof the value is unreachable — so the negative result is the load-bearing half of the record, not a curiosity.

THE CARD'S FALLBACK WAS WRONG AND IS NOW INVERTED. `unsettledReason: 'resizing'` FIRES. Seen 3 runs of 3, on a real page, in the app. KEEP THE VALUE — do not remove it. This also retro-justifies shipping the enum in 0.61.0: docs/breaking-changes.md says the state is real, and it now has an observation behind it rather than a decision.

Why it looked unreachable, which is the part worth keeping: settleTarget (ipc.ts:1093) exits on two EQUAL consecutive 80 ms viewport reads inside a 4 s budget. Flipping between TWO presets gives each pair of reads a coin-flip chance of agreeing, so it exits `settled` almost at once — Kenya measured that first, 30,000 flips deep, and got `animating`. EIGHT distinct viewports in rotation keep consecutive reads disagreeing across the whole budget, and only then does it fall through to 'resizing' at ipc.ts:1105. So the real-world shape is not `a capture that caught a resize` but `the viewport changing on essentially every read for four continuous seconds` — a window dragged by its corner while a capture runs. The card's guess that it needed a harness fixture rather than an HTML one was right; the guess that a preset flip would do it was the part that hid it for a day.

Delivered:
• tests/e2e/live-drive.spec.ts — the positive case beside the existing negative assertion at :955, so the pair reads `this is when it fires` and `this is when it must not`. Full spec 44 passed, 1 skipped, 55.6 s, unfiltered.
• docs/note-inventory.md — 58 emitting call sites; the 17 on the live surface hand-checked: 3 observed, 14 never seen, published as such with file and line.
• docs/readiness.md — C5 PARTLY met, with the 41 unchecked headless/MCP sites named as unchecked rather than implied done.

THE FOURTH SHAPE OF THE DAY'S DEFECT, named by obsrv-91 against its own shipped proposal, and the one that belongs highest on this card: A VALUE NEVER OBSERVED FITS TWO FACTS — either it cannot happen, or nobody has provoked it hard enough. Removing it on the first is right; removing it on the second is data loss. The two are indistinguishable until someone designs an experiment to make it fire.

obsrv-91 added `resizing` yesterday, told its user plainly it had never seen it fire, and proposed removing the value if it proved unreachable — suggesting a preset flip as the way to try. The flip is exactly what cannot produce it. So a CHEAP attempt to provoke a value feels like a test of reachability and is not: `nobody has made it happen` was never evidence it could not, and the error was reasoning as though one honest try settled it. obsrv-91's own words: its verification habit is to make checks fail on purpose, and this is the same move pointed at a value rather than an assertion.

TWO METHOD FINDINGS Kenya asked be kept out of the commit message:
1. A phrase sieve over the suite UNDERCOUNTS. Matching note text mechanically said `55 of 58 never asserted`; spot-checking six found four that ARE asserted, through regexes and partial phrases the matcher cannot see (cli-snap-tiled.spec.ts:102, cli-walk.spec.ts:137, others). The sieve is in the file as a pointer to where to look, explicitly not as a result. A number that reads as measurement and is not is the same defect as the note that had never fired. Anyone automating C5: this is the trap.
2. live-drive.spec sets `info` (control port and token) in the FIRST test of the file, so any -g filtered single-test run dies on `Cannot read properties of undefined (reading 'token')`. It reads like a bug in whatever test you just wrote. Cost a run.
