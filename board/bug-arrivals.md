---
title: "A mirrored redirect's second commit can still be counted as an arrival"
column: done
kind: bug
owner: "Kenya"
criterion: B2
order: 23
---

CLAIMED BY KENYA 2026-09-16 on Wren's routing, pulled from Backlog: it is the ground
`bug-sync138-no-url-changed` and `sync-mirror-mark:41` sit on — a redirect's two commits, 13 ms
apart — and the native-pane load trace from #129 reads that pane from the other side.

**The card records what was deferred, not what was observed, so the first day's work is to
reproduce it.** If it does not reproduce, that is the answer and it is written down as one.

## REPRODUCED 2026-09-16 by Kenya, on `main` before any `syncBus.ts` change — and it is not a race here

**20 runs of 20 fired the note.** Driven through the control server: navigate away, navigate to
`redirect.html` (which redirects itself), then `inspect`.

    spurious notes: 20/20        second commit unmarked: 20/20
    CONTROL, a page that does not redirect: 0/20

The control is the half that makes the first line mean anything: a page that does not redirect
produces no note at all, so the note is about redirects rather than about every navigation.

**The note that fires:**

> the page navigated after it loaded, to …/hairline.html: a bot challenge, an interstitial, a
> redirect, or a dev server reloading under an edit; the figures are of the page it arrived at

**Why it fires — the target commits the same page twice.** Its own commit trace, one run:

    redirect.html    mirroring=false     the target's own load
    hairline.html    mirroring=true      the bus's mirrored load: marked, and correctly NOT counted
    hairline.html    mirroring=false     a SECOND commit of the same page, unmarked, and COUNTED

`watchArrivals` in `src/main/ipc.ts:230` skips `mirrored` commits precisely so Obsrv's own plumbing
is never reported as the page moving. It works. **What defeats it is that there are two commits of
the same arrival, and only one of them is the mirror's.**

**This matches @Henry's `probe/live-walk-scroll-timeout` measurement from the other side** (run
`35158932493`, 4 of 12 apps): the native pane commits the redirect's destination first, the bus finds
no issued entry for it and mirrors it in, and the target then runs a **second** navigation to the
same address — `did-navigate` twice on the target, about 30 ms apart, with one first load ending
`did-fail-load -3`. His trace is of the double load; this one is of what the double load does to the
arrivals counter.

**So the card's own framing needs one correction.** It says the second commit's attribution is a race
and *"can still be counted"*. On this desk it is not a race and there is no *can*: the duplicate
commit arrives unmarked every time, and the note fires every time.

**Not yet established:** whether fixing the double load removes this, or whether a duplicate commit
still needs marking at the counter. That is the re-measurement below, and it is deliberately not
guessed at here.

**How to re-run:** branch `probe/arrivals-repro`, `tests/e2e/arrivals-repro.spec.ts`, kept off `main`
because a 20-iteration loop is the wrong shape for the suite.

Deferred 2026-09-14 in commit 7d811f8. Two causes race for that commit; when it lands unmarked the arrivals counter counts it, so the spurious 'navigated after it loaded' note can fire on a redirect.

## RESOLVED 2026-09-17 by Kenya — two discriminators, because each alone was measurably wrong

The fix is one line in the counter and one field on the event:

    if (url === arrivals(s).url && !byDocument) return

**A commit to the address the pane is already recorded at, which the document did not start, is not
the page moving.** It is the bus's mirrored load landing after `loadMirrored`'s flag came down.

**Both halves are load-bearing, and each was refuted alone before this:**

| candidate | spurious arm | truthful arm | verdict |
| --- | --- | --- | --- |
| claim a mirrored load by URL | 0/20 | **7/20** | eats real movements |
| same address, ignoring who started it | 0/20 | 20/20 | **breaks `mcp-live:722`/`:813`** |
| same address **and** not document-started | **0/20** | **20/20** | every gate green |

`byDocument` comes from Electron's `initiator`, which is present only on a navigation a page began
itself. There is **no `isRendererInitiated`** on Electron 43's event — measured across both arms, and
the probe is on `probe/arrivals-repro` — so nothing here rests on a field that does not exist.

**Why the counter and not the attribution.** Marking those commits `mirrored` in `TargetSource`
would also change what the BUS sees, and the bus drops what is marked when deciding whether to
mirror back — the loop breaker's own test caught that shape once already (`7d811f8`). So `mirrored`
is left exactly as it was, and the new fact travels beside it.

**The regression test is `tests/e2e/arrivals.spec.ts`**, its own file with its own app, and it holds
both halves: the mirrored pane says nothing, and a page that really redirects still says so. With the
rule removed the first test fails both attempts and the second still passes — so it cannot go vacuous
in either direction.

**Gates, read from the full summary line rather than a tail:** the four arms above; `mcp-live` 41
passed including `:722` and `:813`; `sync` + `sync-mirror-mark` + `history` 22 passed; unit 1403/1403.

## TWO LIMITS, from Henry's read of #184 — recorded because neither is visible from the fix

**1. A document-started navigation that is SERVER-redirected reads as not document-started.**
`startedByDocument(url)` looks up a start recorded *for the committed URL*. On a 302 the commit URL
has no start record of its own, so `byDocument` reads false — and a page reloading itself **through a
302** back to the recorded address would be silenced, which is the case `mcp-live:722`/`:813` exist
for. Not measured, and not a case the four arms cover: they use a client-side `location.replace`,
which commits the URL it started. **#171 gives `TargetSource` a `redirected` event**, so recording the
redirect's URL in `starts` with the in-flight start's `byDocument` would close it. A cheap follow-up,
and it needs its own arm before anyone believes it is fixed.

**2. Attribution is by URL, not by navigation identity.** When the bus's mirrored load and the page's
own navigation go to one URL together, the *latest start* for that URL decides, not the navigation
that actually committed. Electron 43 exposes no navigation id on `did-navigate` — checked while
measuring `initiator` — so this is a **known heuristic, not an oversight**. The 0/20 and 20/20 arms
show it holds on these paths; they do not show it holds on every path.

**And a question Henry raised that this card does not answer:** mirrored commits into the target are
never counted, which was true before #184 as well. So if a user moves the *native* pane to a
different page mid-measurement, does the agent's reply say so anywhere — through `landedAt`, or at
all? Nobody has checked. It is not a defect until someone does, and it is not this card's.
