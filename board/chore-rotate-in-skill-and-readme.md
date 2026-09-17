---
title: "`rotate` is in every tool's schema and `--help`, but not in the skill or the README"
column: review
owner: "Henry"
waiting: "Wren: the cold read of the docs PR, then Henry merges"
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

## In review 2026-09-17

- **Skill** (`skills/obsrv-screens/SKILL.md`):
  - a `--rotate` example in Commands (`iphone-61 --rotate`), with the deprecation and refusal lines;
  - a **Rotation (0.61.0+)** paragraph in The MCP tools: which six tools take `rotate`, the stored-form
    meaning `orientation` keeps, the refused pair, `rotated` and `screenShape` on snap and drive (not in
    the CLI JSON), and live audit/lint/inspect naming the fields they ignored.
- **README:** a `--rotate` example among the CLI examples, with the same deprecation and refusal line.
- **Every claim checked in code:**
  - the CLI's `--rotate and --orientation disagree` refusal (`args.ts`);
  - `rotated` and `screenShape` declared on `snapOutputShape` and `driveOutputShape`;
  - the six tools taking `orientation`/`rotate`, which `rotateDeprecated.test.ts` pins;
  - #207, inside 0.61.0 (`10cd219`), so `0.61.0+` holds.

