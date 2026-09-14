---
title: "Release notes and a register for 0.61.0's three breaking changes"
column: done
kind: readiness
criterion: C2
owner: "obsrv-a6"
order: 6
---

docs/breaking-changes.md — a durable register, newest first, each entry saying what breaks, what to do, and why. Holds 0.59.0's `url` change and 0.61.0's three (presetId/profileId removed; walk sentences notes->warnings; unsettledReason gains resizing, carrying the session-restart instruction because a stale MCP schema rejects a correct reply). Linked from README and the limitations page. Corrected readiness.md, which had the `url` change in 0.60.0 when git tag --contains puts it in v0.59.0. Merged 9f92351.

Still open, deliberately: the 0.61.0 entries are marked unreleased/pending — the fixes are obsrv-e7's and unmerged, and the `resizing` enum is a decision Opeyemi has not made. Draft release notes for 0.61.0 are in obsrv-a6's scratchpad, to be applied when the release is cut.
