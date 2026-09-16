---
title: "Make the server reject its own undeclared key — under OBSRV_TEST only"
column: done
kind: chore
owner: "Kenya"
order: 36
---

FILED 2026-09-16 by Kenya, from Henry's proposal (#154 and DM). **CLAIMED BY KENYA 2026-09-16**, on Henry's routing (#164), with Henry's fold-in from #156: the sweep
skips `obsrv_drive` by design, and a server that rejects its own undeclared key checks every `drive`
call the suite makes — reaching the one surface the sweep cannot see.

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

## RESOLVED 2026-09-16 by Kenya — the sweep's own comparison, moved into the server

`src/shared/keyPaths.ts` holds the two walkers and the diff; `scripts/schema-emit-sweep.js` and the
server both run **that** code, so "what counts as declared" has one definition and cannot drift into
two. `src/mcp/strictOutput.ts` wraps `registerTool` — the hook `stampLaneResults` already uses, so
no tool can forget — computes each tool's declared paths once from the same JSON Schema the server
publishes, and fails any call whose reply carries a path that schema does not declare, naming the
tool and the full path.

**It compares paths rather than making the shapes strict, and that is not a detail.** A top-level
`.strict()` would have caught **none** of the three instances this card was filed for: `colorPainted`
sits inside `readout`, and `obsrv_drive`'s three inside a spread status. A check that is vacuous
against every instance in its own card is the failure this card exists to prevent.

## The control the card demanded, run first

**Historical, on `6755535` (`f32dbbb`'s parent — before #65, #68 and #75).** The check was copied onto
that tree and the real server driven over stdio:

    obsrv_inspect emitted 1 key its own output schema does not declare: readout.colorPainted.

So it catches a real shipped break, by name, on the tree where it shipped. `obsrv_drive` and live
`obsrv_snap` could not be reached there — both need a visible app, and a headless sweep cannot drive
one — so **one of the three instances is proven historically, not three.**

**In-suite and permanent.** `OBSRV_TEST_UNDECLARED_KEY=<tool>` injects a deliberate undeclared key
(fenced twice, like `OBSRV_TEST_THROTTLE_REFUSAL` in #81). Four arms: a poisoned headless reply fails
naming the key, the same call is clean unpoisoned, with the fence off neither hook nor check runs,
and **a poisoned `obsrv_drive` fails on the live surface**. Without these the check would be green on
a clean tree forever and nobody would learn whether it runs — which is exactly what `ci.yml`'s trace
upload did for a week.

## The gap this nearly shipped with, found by running the control rather than reasoning

**Fenced on `OBSRV_TEST=1` alone, the check was switched off across the entire live surface** —
`OBSRV_TEST=1` refuses to launch the app (`launch.ts:95`), so `mcp-live.spec` and
`surface-parity.spec` cannot set it. Measured: **16 `obsrv_drive` tests ran with a deliberate
undeclared key injected and all 16 passed.**

That is the surface `schema-emit-sweep.js` skips by design, and where two of the three shipped breaks
lived. The claim on this card — that a server-side check reaches every `drive` call the suite makes —
**was false as first built**, and it would have read as true. The fence is now
`OBSRV_TEST=1 || OBSRV_STRICT_OUTPUT=1`, and the live specs set the second.

## What it does not do

- **It cannot see a field emitted only on a path the suite never takes.** Same limit as the sweep,
  now on every reply the suite produces rather than on eight sampled calls.
- **It is weaker than a client's validator on purpose**: a union counts a key declared in any branch,
  and an object with free key names (a record) is open. A false red in a suite with flakes is how a
  check gets switched off.
- **A tool whose schema cannot be converted is skipped and says so on stderr**, rather than passing
  quietly as covered.
- **Production is untouched**, which is the card's own decision and now has a test.

## Verified

- unit 1361/1361 (9 new in `tests/unit/keyPaths.test.ts`), typecheck clean
- `mcp.spec` 33/33 with three new arms; `mcp-live.spec` 41/41 with the check running on every live
  reply and one new arm; `surface-parity` + `mcp-electron` 13/13; `schema:sweep` clean on the shared
  walkers
