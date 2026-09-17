---
title: "After back, forward or reload, a live audit or lint no longer says the page moved since the agent's navigate; 0.60.0 did"
column: doing
owner: "Henry"
waiting: ""
kind: bug
criterion: B2
order: 65
---

FOUND BY WREN'S RELEASE SWEEP 2026-09-17 as an unverified lead (a classifier's read of `56972c7` +
`640ddd3`). **Confirmed by Henry, by reading. Not yet measured in a live run.**

**The mechanism, on `main`:**
- History moves drive the native pane only (`ipc.ts`: `goBack = () => tab().native.back()`). SyncBus
  mirrors the native commit into the target through `target.loadMirrored` (`syncBus.ts`, since `56972c7`).
- `watchArrivals` skips a mirrored commit: `if (inPage || mirrored) return` (`ipc.ts`, since `7d811f8`).
- So after `navigate A`, then back to B, the arrivals count doesn't move. A live audit or lint then has
  `seen.count > askedHere.atCount` false, and `navigatedAfterLoadNote` isn't written.
- The same holds for any navigation that starts in the native pane, such as a link clicked there.

**In 0.60.0** the listener was `if (inPage) return` and the bus called `other.load(url)`. The mirrored
commit counted, and the note fired. That makes this a lost *true* warning relative to the released
version. It's the price of removing the false ones (`bug-arrivals`: 17–20 false notes in 20 runs).

**Why it isn't a 0.61.0 blocker:** the reply isn't wrong. With no `url` in the call, `answeredUrl`
returns the address the app is showing, so `url` names the page that was measured. What's lost is the
sentence saying that address isn't the one the agent navigated to, which matters most when the *user*
went back between two agent calls. The silence now fits two opposite facts: either nothing moved, or
the move reached the target as a mirrored commit.

**The constraint on a fix:** `bug-arrivals`' two discriminators (`mirrored`, and same-address-not-by-document)
were each measured wrong alone, so don't loosen either by reading. Two directions, both unmeasured:
1. Count at the source. A native-pane commit the bus mirrors because it didn't expect it *is* the page
   moving. Its echo into the target is plumbing. The count could key on the former.
2. Since #171, a server redirect of an issued navigation is issued, so the bus no longer mirrors it. Measure
   whether the `mirrored` skip is still needed for the case it was added for before touching it.

**First step:** an `mcp-live.spec` case (desk-safe harness): `drive { url: A }`, then `drive { back: true }`,
then a live `obsrv_audit` with no `url`. It should carry `navigatedAfterLoadNote`. It will be red on
`main`, and the control is v0.60.0's listener.

## Claimed by Henry 2026-09-17, routed by Wren

**A correction to "0.60.0 did" first, from the second fact-check of the 0.61.0 notes (Wren), checked
against the tag.** The three tools didn't decide this note the same way in 0.60.0:
- **audit** counted commits (`v0.60.0:src/main/ipc.ts:1699`, `seen.count > askedHere.atCount`), mirrored
  ones included. It flagged back, forward, reload and a link followed in the native pane.
- **lint** compared addresses (`:1765`, `st.url !== askedHere.landedAt`). It flagged back, forward and a
  native-pane link, since each changes the address. **It never flagged a reload.**
- **inspect** had no such note.

On `main`, all three count commits and skip mirrored ones (`ipc.ts`, inspect, audit and lint). So none of
the three flags a history move or a native-pane link. What 0.61.0 loses against 0.60.0 is back, forward and
native-pane links on audit and lint, plus reload on audit. Inspect gained the note in 0.61.0, but it's
silent for these moves too.

**Plan:**
1. The red test first, per the card: an `mcp-live.spec` case that drives `url: A`, then `back: true`, then
   a live `obsrv_audit` and `obsrv_lint` with no `url`. Both must carry `navigatedAfterLoadNote`. Red on
   `main`. The control is 0.60.0's audit listener, `if (inPage) return`.
2. Check `mcp-live.spec` against the desk-safe list before running it locally: no `cli-*` or throttle
   launch path, no `OBSRV_E2E_FRONT`/`OBSRV_TEST_TAKES_THE_DESK` gate, no recorded activation. Otherwise it
   runs on CI only.
3. Then the fix, which must not loosen `bug-arrivals`' two discriminators (see above).
