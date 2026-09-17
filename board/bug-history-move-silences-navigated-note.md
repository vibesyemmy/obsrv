---
title: "After back, forward or reload, a live audit or lint no longer says the page moved since the agent's navigate; 0.60.0 did"
column: review
owner: "Henry"
waiting: "Wren: the cold read of the fix PR, then Henry merges"
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

## Refined 2026-09-17 by Henry, after the red test and a read of the mechanism

**The red test exists** (local, `fix/history-move-note`, harness-only): `mcp-live` drives A, then B, then
`back`, then a live audit and lint with no `url`.
- **On `main`:** `url` is A, which is right, and there's no sentence.
- **Control:** with 0.60.0's listener (`if (inPage) return`) the note comes back, green in 1.8 s.

**But restoring 0.60.0 would restore a false sentence, so that's not the fix:**
1. **0.60.0's note misattributes a history move.** It says "the page navigated after it loaded, to A:
   a bot challenge, an interstitial, a redirect, or a dev server reloading under an edit". None of those
   happened. The tab went back, whether the agent's `drive { back }` or the toolbar did it (both reach
   `goBack`).
2. **Reload isn't lost to the mirror skip.** `reloadBoth` reloads the target directly, not through the
   bus. Its commit (same address, not started by the document) is skipped by `bug-arrivals`'
   same-address rule.
3. **A correction to this card's "fix constraint" line:** Kenya's two measured halves are the **address
   test and `byDocument`**. The `mirrored` skip is older (7d811f8). Counting mirrored commits again isn't
   an option either way: Kenya's repro (`redirect.html`, 20/20 spurious) is exactly a mirrored commit
   landing around the page's own redirect.

**The plan, an engineering decision recorded here so it can be overruled:** leave the arrivals counter
untouched and state the fact Obsrv already knows.
- Record each history move where it's issued: `goBack`, `goForward` and `reloadBoth`, the single path
  for toolbar and agent.
- A live inspect, audit or lint then compares it with the last navigate's record. It says, in one true
  sentence, that the tab moved through its history (or was reloaded) since that navigate, and names the
  page the figures are of.
- The sentences built from `asked` stop naming the stale address after a history move.
  `httpStatusNote`'s contrast is the one found.

**Not covered, and left open on purpose:** a link followed inside the native pane. The bus mirrors it,
the counter skips it, and telling it apart from a page's own redirect is `bug-arrivals`' hard problem.

**The test changes to match:** after A, B and back, the reply carries the history sentence naming A and
B, and never the challenge/redirect sentence.

## In review 2026-09-17: the fix, with the arms Wren registered and three controls

**What changed, as agreed on this card:**
- **Where the move is recorded:** `TabSession.historyMove` (`kind`: back, forward or reload; `by`: agent
  or app), set where each move is issued.
  - `goBack`/`goForward`/`reloadBoth` receive `'agent'` from the control server and `'app'` from the
    renderer's IPC.
  - The View menu's Reload (Cmd+R) records `'app'`. It reloads both panes directly, not through
    `reloadBoth`: a third issue point that reading the code turned up.
  - Back and Forward record only when `canGoBack`/`canGoForward` is true, so a Back with nothing behind
    it claims no move.
  - Every navigate clears the record.
- **One `whichPage` helper** in `ipc.ts` now writes the page sentences for inspect, audit and lint, which
  used to build them separately. After a move, `historyMoveNote` takes the landed-elsewhere sentence's
  place, because that sentence describes the page the move replaced. `httpStatusNote` needed no change:
  a stale `asked` already selects its short contrast.
- **The sentences** (`src/shared/measureBudget.ts`), read in all 12 shapes:
  - a different page: *the figures are of X, not of B, which the last navigate asked for: the tab moved
    after that navigate, most recently by a Back the agent issued*;
  - the same address: *the figures are of B after a Reload made in the app, not as the last navigate
    loaded it*.
  - "Moved", not "moved through its history": a Reload whose server redirects changes the address with
    no history step.

**Evidence (local, harness-only, desk-safe):**
- **The five `mcp-live` tests** covering arms 1–7 pass in 3.8 s. Arms: agent Back, app Back, agent Reload,
  no move, `redirect.html`, stale landed sentence, status contrast. Matchers are derived from
  `historyMoveNote`.
- **Control A, main's source:** the 4 move arms fail, and no-move/redirect passes.
- **Control B, `agent` and `app` swapped:** both issuer arms fail.
- **Control C, landed sentence kept after a move:** red at `not.toContain('ended at')`.
- **Regression:** typecheck 0; unit 1351, including 2 new for the sentence; `arrivals`, `history`, `sync`
  and `sync-mirror-mark` 24 passed; the `mcp-live` navigated-note cases 12 passed. `live-drive`'s
  back/forward/reload test has recorded desk activations, so it runs on CI only.

**Still open, as agreed:** a link followed inside the native pane is still silent (the bus mirrors it and
the counter skips it). That's `bug-arrivals`' hard problem, left for its own card if it matters.

**Limits named in Wren's read of #222:**
- **Wording:** the sentence says "the last move Obsrv recorded", not "most recently". A link clicked after a
  recorded Back isn't recorded, so "most recently by a Back" would have been false.
- **Two sentences can pair oddly:** after a Back to a page that then redirects or reloads itself, the
  history sentence and `navigatedAfterLoadNote` both appear, and the second names the stale navigate's
  address as its "from". Rare, and not fixed here.
- **Timing:** the measured address is the tab's `url`, the pane's last reported commit. If the mirror hasn't
  committed into the target when the measurement starts, the sentence and the figures could briefly
  disagree. Not measured.
