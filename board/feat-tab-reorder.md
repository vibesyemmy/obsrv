---
title: "Drag tabs to re-arrange them, as every browser does"
column: backlog
kind: chore
order: 28
---

Requested by Opeyemi 2026-09-14. Nothing today: TabBar.tsx has no draggable/onDragStart, and the control server has openTab/closeTab/activateTab but no moveTab. Order is positional — StoredTabs keeps a list plus an active index (shared/tabsFile.ts), and that file already documents how badly indices behave when the list shifts: dropping an entry shifts every index after it and can strand the active one. A reorder shifts the list on purpose, so it must move the active index with it and survive a restore; the tabs-come-back-on-relaunch spec is where that gets proved. Open questions for whoever takes it: whether an agent gets a moveTab command too (C2 — a new control command is a surface change), and whether reordering while agent control is on can move the driven tab out from under a command, since the agent acts on whichever tab is in front.
