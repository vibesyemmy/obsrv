---
title: "a measurement reply carries the address asked for beside `url`, for machines"
column: backlog
kind: feat
criterion: C5
order: 135
waiting: "Opeyemi: keep the `asked` field, knowing it is breaking (docs/compatibility.md:12) and needs a breaking-changes.md entry, or drop it now that the note has cleared the class 1"
---

SPLIT 2026-10-12 from `bug-measured-page-is-not-the-asked-page`. The shape relayed from Opeyemi for that card was
"Note + `asked` field". The note shipped in `#621` and cleared the class 1 on its own. This card is the field.

## What it is

An `asked` field beside `url` in the live measurement replies: the address the last navigate asked for. A machine
reading the reply could then compare without parsing the note's prose.

## What it costs

`docs/compatibility.md:12`: "On the MCP surface, adding a field is a breaking change." Every tool's output schema
is `additionalProperties: false`, so a client holding the old shape rejects a reply carrying a field it does not
know (line 14). So it needs a `docs/breaking-changes.md` entry, and it moves the gated `docs/public-shape.json`
snapshot. 0.64.0 already carries one breaking change (the orientation removal), so a second costs little more in
that release than in a later one.

## Open if it is kept

- which replies carry it (snap, audit, lint, inspect, report, drive), and its type and nullability;
- whether the CLI's JSON carries it too.

Henry's sequencing (room `#4719`): the note first, then the field as a second, small PR with its register entry.

