---
title: "A mirrored redirect's second commit can still be counted as an arrival"
column: doing
kind: bug
owner: "Kenya"
waiting: "decision: how to tell the bus's own mirrored chain from a page reloading itself"
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

**@Henry's `probe/live-walk-scroll-timeout` measures a neighbouring path from the other side** (run
`35158932493`, 4 of 12 apps): the native pane commits the redirect's destination first, the bus finds
no issued entry for it and mirrors it in, and the target then runs a **second** navigation to the
same address — `did-navigate` twice on the target, about 30 ms apart, with one first load ending
`did-fail-load -3`. His trace is of the double load; this one is of what the double load does to the
arrivals counter.

## CORRECTION 2026-09-16, same evening, by Kenya — my first headline was an overclaim

**The 20/20 above is not the defect, and calling those notes "spurious" was wrong.** Two further
arms, run on the same `main`:

    client-side redirect, `navigate` (BOTH panes driven)   20/20 notes
    server redirect (302), `navigate`                       0/20 notes
    client-side redirect, NATIVE PANE ALONE                19/20 notes

**Why the first is defensible.** `navigate` drives both panes, so the target's second commit is its
own redirect landing. `navigate` resolves when `redirect.html` has loaded, the arrivals count is
recorded at that moment, and the client-side `location.replace` commits *after* it. **The page really
did navigate after it loaded**, and a note saying so is true. The 302 arm fires nothing because both
its commits land before the count is taken — which is the same rule, working.

**The defect is the third arm, and it is the one `7d811f8` actually described.** Only the native pane
is driven, so every commit the *target* makes is the bus's doing. The target's trace:

    hairline.html    mirroring=false    the earlier navigate
    redirect.html    mirroring=true     the bus mirroring native's redirect — correctly marked
    hairline.html    mirroring=false    the bus mirroring native's landing — UNMARKED, and counted

And the note it produces names its own absurdity:

> the page navigated after it loaded **(to the same address)**: a bot challenge, an interstitial, a
> redirect, or a dev server reloading under an edit; the figures are of the page it arrived at

**The target was already on that page and nobody asked it to move.** It is Obsrv's own plumbing,
reported to the caller as the page moving under them — which is exactly what `watchArrivals`'s
`mirrored` check exists to prevent, and it is defeated because the mirror's own commit arrives
unmarked when the target is already showing that URL.

**A lead, not a conclusion:** the flag is set while `loadMirrored()` is in flight, and a load of the
address the pane already shows is the case most likely to commit outside that window. Not measured
yet, and it is the next thing to measure rather than the next thing to fix.

**So the card's own framing needs one correction.** It says the second commit's attribution is a race
and *"can still be counted"*. On this desk it is not a race and there is no *can*: the duplicate
commit arrives unmarked every time, and the note fires every time.

**Not yet established:** whether fixing the double load removes this, or whether a duplicate commit
still needs marking at the counter. That is the re-measurement below, and it is deliberately not
guessed at here.

**How to re-run:** branch `probe/arrivals-repro`, `tests/e2e/arrivals-repro.spec.ts`, kept off `main`
because a 20-iteration loop is the wrong shape for the suite.

Deferred 2026-09-14 in commit 7d811f8. Two causes race for that commit; when it lands unmarked the arrivals counter counts it, so the spurious 'navigated after it loaded' note can fire on a redirect.

## MECHANISM MEASURED 2026-09-17 by Kenya, and TWO CANDIDATE FIXES REFUTED by their own controls

**The mechanism, from the flag's own edges against the commit times** (temporary instrumentation on
clean `main`; timings relative to the first commit):

    +551  window open   redirect.html
    +559  commit        redirect.html   mirroring=true     inside the window
    +563  window open   hairline.html
    +565  window close  redirect.html
    +565  window close  hairline.html
    +569  commit        hairline.html   mirroring=FALSE    4 ms after it closed

**`mirroring` is keyed to `loadMirrored()`'s promise, and the commit can be delivered after the
promise resolves.** `targetSource.ts:405` already says this in its own comment — `7d811f8` fixed the
*withholding* and left the *attribution* on the same unreliable window. That is why the note fires
17–20 times in 20 rather than always.

**Candidate 1 — attribute by URL** (remember each mirrored load, claim the matching commit however
late it lands). It works on the spurious arm and **breaks the truthful one**:

    arm                                      main      candidate 1
    native pane alone (SPURIOUS)            17-20/20   0/20
    client redirect, both panes (TRUE)      20/20      7/20

The bus's mirrored load and the page's own redirect go to **the same URL at the same moment**, so a
URL claim cannot tell them apart and eats real movements. Refuted.

**Candidate 2 — the counter ignores a commit to the address it already recorded.** Every arm came out
right: 20/20 true notes kept, 0/20 spurious, controls 0/20. **And it breaks two existing tests that
deliberately assert the opposite** — `mcp-live.spec:722` and `:813`, *"a page that reloads to the
same address … says it moved"*, both red. A same-address reload is a real event the product reports
on purpose. Refuted.

**So the fix needs what neither candidate has: knowledge of which chain of commits the bus started.**
That is bus-side state, and it is next to @Henry's issued-marker work in `syncBus.ts` (#171), so it
should be agreed with him rather than written twice.

**A caution for whoever takes it, learned the hard way here:** the spurious note and the truthful one
are produced by the same code path on the same URLs, milliseconds apart. Any candidate must be run
against **all four arms** of `probe/arrivals-repro` — a fix that silences the spurious note is worth
nothing if it also silences the true one, and that is not visible from either arm alone.
