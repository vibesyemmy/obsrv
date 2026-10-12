---
title: "a measurement reply carries the address asked for beside `url`, for machines"
column: done
kind: feat
criterion: C5
order: 135
---

SPLIT 2026-10-12 from `bug-measured-page-is-not-the-asked-page`. The shape relayed from Opeyemi for that card was
"Note + `asked` field". The note merged in `#621`. It made the wrong answer detectable, not fixed: that card
stays open and counted (`docs/release-gate.md:86-90`). This card is the field, which is a second way of saying
the same thing, for machines.

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

## DROPPED BY OPEYEMI, 2026-10-12, as relayed from the Resolver session; not built

Opeyemi was told the cost (breaking per `docs/compatibility.md:12`, plus a `docs/breaking-changes.md` entry) and that
the note in `#621` already makes the wrong answer detectable. Just before 22:51:14Z, in Resolver's session, they
answered: **"Drop the asked field and delete the probe branch"** (room `#4788`). Nobody else can read that session,
so this is Resolver's account. The field is not in 0.64.0 and is not planned. `done` here means decided, not
built. If a machine-readable "which page" is wanted later, it is a new card with this one's cost section as its start.

