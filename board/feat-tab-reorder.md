---
title: "Drag tabs to re-arrange them, as every browser does"
column: review
kind: chore
owner: "Rook"
order: 28
---

Requested by Opeyemi 2026-09-14. Nothing today: TabBar.tsx has no draggable/onDragStart, and the control server has openTab/closeTab/activateTab but no moveTab. Order is positional — StoredTabs keeps a list plus an active index (shared/tabsFile.ts), and that file already documents how badly indices behave when the list shifts: dropping an entry shifts every index after it and can strand the active one. A reorder shifts the list on purpose, so it must move the active index with it and survive a restore; the tabs-come-back-on-relaunch spec is where that gets proved. Open questions for whoever takes it: whether an agent gets a moveTab command too (C2 — a new control command is a surface change), and whether reordering while agent control is on can move the driven tab out from under a command, since the agent acts on whichever tab is in front.

INTO REVIEW 2026-09-15, branch `feat/tab-reorder` off 5c0a660, commit 79d899b. Unit 1150/1150, typecheck clean across three configs, tabs.spec 35 passed.

THE CARD'S CENTRAL WORRY DOES NOT EXIST, and reading the code first is what showed it: `activeIndex` is DERIVED, not stored — TabManager computes it with findIndex on the active id at save time — so identity already carries the active tab through a shuffle. The feature is smaller than the card feared and the job became proving that rather than building around it.

`moveTab` in shared/tabList.ts is pure and sits beside closeTab, keyed by id like its neighbour. Removes before inserting, because the other order duplicates the dragged tab and drops whatever it landed on — and a strip with a tab twice in it still looks like a strip of tabs; a permutation test over every from/to pair asserts every tab survives exactly once. Destination clamped rather than rejected: a drag can end past the end of the strip and losing a tab because the pointer went too far is the worst outcome available. parseTabMove refuses a non-integer index, which would otherwise reach the clamp as NaN and come out as position 0 with nothing having gone wrong.

THE RELAUNCH SPEC WAS MADE TO FAIL TWICE BEFORE BEING BELIEVED, per Henry's condition: (A) persist a position rather than the active tab's own — invisible until the restart; (B) pin the active id to the old position after the shuffle. Both go red on "the right tab is in front" rather than on "tabs came back".

AND THE FIRST CUT OF THAT SPEC WAS THE DEFECT IT GUARDS. It moved the ACTIVE tab to position 0, where a persisted activeIndex of 0 is accidentally correct — it passed against a deliberately broken save. Mutation A is what exposed it. The active tab now moves to position 1, where the front tab can be wrong. This is sync.spec.ts:138's shape reappearing in a test written three hours after diagnosing it.

OPEN AND UNMEASURED, deliberately: no moveTab control command — a new control command is a surface change and C2's to schedule, and the UI feature does not need it (Opeyemi's call). Whether a re-order can move the driven tab out from under an agent command is NOT measured; the agent resolves the front tab per command, so the question is real and wants a probe before any design.
