---
title: "Make the server reject its own undeclared key — under OBSRV_TEST only"
column: next
kind: chore
order: 36
---

FILED 2026-09-16 by Kenya, from Henry's proposal (#154 and DM). **Unowned; Kenya wants it if Wren routes it that way.**

## The class, which three instances in one day have now demonstrated

    obsrv_inspect   colorPainted            undeclared since f8d734f (2026-09-15)
    obsrv_drive     three keys              found by Henry, fixed in #68
    obsrv_snap live onionSkin, loading      undeclared since v0.26.0 / v0.28.0

**Nothing catches an undeclared key at the moment it is added.** Each of these was found by a person reading an error, days or months later. `scripts/schema-emit-sweep.js` finds them on the paths it exercises, which is a floor rather than a guarantee, and nobody runs it on a schedule.

## Why the server does not catch it today, measured rather than assumed

`server/mcp.js:204` parses the reply against the zod output shape and **discards the parse result** — it checks `success` and then sends `result.structuredContent`, the original object. `readoutShape` and its siblings are plain `z.object`s, and **zod's default strips unknown keys rather than failing**, so the parse always succeeds and the extra key travels anyway.

The JSON Schema the server publishes says `additionalProperties: false`. **So the rejection is always the client's**, and only for clients that cached the schema via `listTools()`.

## The proposal: strict under `OBSRV_TEST=1`, and not in production

Henry's, and the reasoning is his: **strict in production turns a key that slips through into an error for every client, including the ones that do not validate today and work.** That is a real cost — a non-validating client currently receives an undeclared field harmlessly.

Under `OBSRV_TEST=1`, every e2e call has the server check its own reply loudly, users keep today's behaviour, and the whole class is caught in the suite.

**And it is independent of the thing that hid the last one.** Client-side validation only happens when the client cached the schema from `listTools()`; a retry, or a `-g` filtered run, skips that and the check vanishes. **A server-side strict parse does not depend on the client at all**, so it catches an undeclared key even in the runs where client validation is off. That makes it complementary to Rook's `listTools()`-in-`beforeAll` work rather than a substitute for it.

## What to check before believing it works

**It must go red on a tree that has an undeclared key**, not merely green on a clean one. `f32dbbb`'s parent, or any of the three instances above, is a tree where the check must fail — and a version that passes there is a check that is not running. That is the standard the trace config failed and had to be caught by watching a failure emit something.

## Not decided here

Whether strict should ever apply in production is a separate question and not this card's. This one is the test-surface version, which costs users nothing.
