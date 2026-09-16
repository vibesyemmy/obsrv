---
title: "A mirrored redirect's second commit can still be counted as an arrival"
column: doing
kind: bug
owner: "Kenya"
waiting: "Henry: the syncBus redirect-mirror fix, which this re-measures on top of"
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
