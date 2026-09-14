---
title: "`orientation: landscape` produces a portrait screen on every desktop preset"
column: backlog
kind: bug
criterion: C2
order: 27
---

src/shared/calibration.ts:40 — the flag names which STORED form to use (as-listed, or rotated a quarter turn), not the shape you get. 1080p-24 is stored 1920x1080, so the default gives landscape and `orientation: 'landscape'` rotates it to 1080x1920. `screenShape` then correctly reports 'portrait' beside it; both fields are right and answer different questions (comment at calibration.ts:37). cli/args.ts:190-200 documents all of it. Not a behaviour bug — a name that inverts its plain meaning. Evidence it costs: obsrv-e7 hit it on 2026-09-14 while hunting C4 parity defects, measured two different viewports without noticing, and was about to file it as a parity defect. Renaming is a breaking change to a public flag and an MCP field, so it is C2's to schedule, not a quiet fix.
