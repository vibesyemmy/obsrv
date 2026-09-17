---
title: "`rotate` is in every tool's schema and `--help`, but not in the skill or the README"
column: doing
owner: "Henry"
waiting: ""
kind: chore
criterion: C2
order: 74
---

FOUND BY WREN'S 0.61.0 RELEASE SWEEP 2026-09-17, where it's listed under the notes' known issues. Claimed by
Henry on Wren's routing.

`rotate` (#178, with #207's gaps closed) reaches agents through the MCP descriptions and people through
`--help`. The skill, which ships in the plugin, and the README, which is npm's page, still say nothing about
it or about `orientation` being deprecated.

**What to write, each claim checked against the code first:**
- `rotate: true` / `--rotate` turns the screen a quarter turn, however the preset is stored.
- `orientation` is deprecated and keeps its meaning: it names the stored form, so `landscape` on a desktop
  preset gives a portrait screen.
- A disagreeing pair is refused (the CLI's `--rotate and --orientation disagree`, and every MCP tool that
  applies rotation).
- `obsrv_snap` and `obsrv_drive` answer `rotated` and `screenShape`. The CLI's JSON doesn't carry `rotated`.
- Live audit, lint and inspect measure the screen in force, and say they ignored either field.
- Marked `0.61.0+`, as the skill's convention asks.
