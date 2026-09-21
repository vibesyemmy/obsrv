---
title: "a page that redirects itself back to the address the pane already holds can go unreported, and it is not a timing race"
column: backlog
kind: bug
criterion: C5
order: 90
---

FOUND 2026-09-20 by Idris, reading `#407`'s own CI log rather than its green bucket.

`arrivals.spec.ts:89` — *"a page that really does redirect after loading still says so"* — had been in
`docs/e2e-flakes.md` as a timing flake, with a pre-sized fix: poll the note instead of reading it
once. Henry applied that fix. **On the fix's own run (`35525940597`) the poll sat the full 10 000 ms
and still got `undefined`** (10.6 s), then passed on retry in 684 ms.

**That falsifies the flake reading.** A value that is absent for ten seconds and present on the next
attempt is not arriving late; on the failing attempt it is not arriving at all. The poll has been
removed — it converted a fast, honest failure into a slow one wearing a timeout's costume.

## Why this is a product bug and not a test bug

`src/main/ipc.ts:245` drops a commit when:

```ts
if (url === arrivals(s).url && !byDocument) return
```

The fixture navigates to `hairline.html`, then to `redirect.html`, whose
`<script>location.replace('hairline.html')</script>` lands back on **the address the pane is already
recorded at**. So `url === arrivals(s).url` is true, and the note survives only if `byDocument` is
true.

`byDocument` comes from `startedByDocument` (`targetSource.ts:857`), which reverse-finds `starts` for
an entry whose url matches, where each entry is pushed on `did-start-navigation` with
`byDocument: details.initiator !== undefined` (`:489-495`). **If that entry is missing for the
redirect's commit, or its `initiator` is undefined on that run, the commit is dropped and the note is
never produced.**

This is the same path a real page takes. A site that bounces a visitor back to the URL they arrived
at would, on the losing side of this race, be measured with no sentence saying the page moved — which
is the whole thing the note exists to say.

## The same field fails the other way too, measured the next run

Run `35528436516` (this branch's own next CI) flaked **`arrivals.spec.ts:71`** — the *sibling* test,
*"the target mirroring the native pane is not the page navigating"* — and it failed for the opposite
reason:

```
Error: the pane was never asked to move, and it ended where it began:
  the page navigated after it loaded (to the same address): a bot challenge, an interstitial,
  a redirect, or a dev server reloading under an edit; the figures are of the page it arrived at
expect(received).toBeUndefined()
```

So on that attempt the note **was** produced for a pane that only mirrored the other one — the exact
defect `ipc.ts:245`'s guard was written to stop (`bug-arrivals`, recorded there as 17-20 runs in 20).

**Both directions are the same field.** The guard is `url === arrivals(s).url && !byDocument`, so:

| sighting | what `byDocument` must have been | what the user gets |
| --- | --- | --- |
| `:89` (note missing) | `false` when the document really did redirect | a real redirect goes unreported |
| `:71` (note present) | `true` when it was the bus mirroring a load | Obsrv reports its own plumbing as the page moving |

That moves this card from "a note is sometimes missing" to **"the signal the note depends on is
unreliable in both directions"**, which is a different and larger claim. `byDocument` is
`details.initiator !== undefined` from `did-start-navigation`, matched by url through
`startedByDocument`'s reverse-find — and a url-keyed lookup is exactly the shape that returns the
wrong entry when two navigations to the same address are in flight, which is what both fixtures
arrange.

## This was named before it happened, and by me — cite it rather than re-derive it

`board/bug-arrivals.md`'s **"TWO LIMITS, from Henry's read of `#184`"**, closed `done` 2026-09-17,
already describes the mechanism this card calls its leading hypothesis:

> **2. Attribution is by URL, not by navigation identity.** When the bus's mirrored load and the
> page's own navigation go to one URL together, the *latest start* for that URL decides, not the
> navigation that actually committed. Electron 43 exposes no navigation id on `did-navigate` —
> checked while measuring `initiator` — so this is a **known heuristic, not an oversight**. The 0/20
> and 20/20 arms show it holds on these paths; they do not show it holds on every path.

That is the url-keyed reverse-find picking the wrong entry, written down as a **scoped, deliberately
unclosed gap** before either sighting existed. Idris found it while reviewing this card; I had
reconstructed it from the CI logs without recognising my own earlier note.

**This makes the claim stronger, not weaker.** It is not two adjacent flakes promoted into a story —
it is a previously-named risk materialising, with its original author's own caveat (*"holds on these
paths; they do not show it holds on every path"*) turning out to be the operative sentence.

**And the ceiling is recorded there too:** Electron 43 exposes no navigation id on `did-navigate`. So
"match the navigation, not the URL" is not a small fix — whatever closes this has to carry identity
some other way, or narrow when the heuristic is trusted.

## DIAGNOSED 2026-09-21 — measured on CI, and it is LIMIT 2 exactly as written

`#422`'s instrument printed the guard's inputs and **answered this card on its own CI run, before it
was merged**. Run `35640624703`, `arrivals.spec.ts`'s note-missing case, first attempt:

```
starts for hairline.html, in order:
  …533361  byDocument = true     <- the DOCUMENT's own location.replace
  …533366  byDocument = false    <- 5 ms later: the bus's mirrored load
  …534055  byDocument = true     <- again, the second test
  …534079  byDocument = false    <- 24 ms later: the mirror

matched by startedByDocument:  …534079   byDocument = false
startsForThisUrl: 6
```

**The mechanism, no longer a candidate.** `startedByDocument` reverse-finds the **last** start whose
url matches. Both navigations go to the same address, so it returns the **mirror's** entry, not the
document's. `byDocument` reads `false`, `ipc.ts:245`'s guard drops the commit, and the note is never
produced — **while the document's own start sits five milliseconds earlier in the same trace with
`byDocument: true`.**

**Which of the three candidates it was:** the reverse-find matching the other navigation to the same
url. Not a missing `starts` entry — the entry is there. Not an undefined `initiator` — the document's
start is correctly marked `true`. The other two are ruled out by the same trace that shows the third.

**The intermittency is the 5 ms.** When the mirror's start lands *after* the document's, the note
dies; when it lands first, or the mirrored load does not happen, the note survives. `:71`'s opposite
failure — the note present for a pane that only mirrored — is this mechanism with the roles swapped.

**And this is `bug-arrivals`'s LIMIT 2, verbatim:** *"when the bus's mirrored load and the page's own
navigation go to one URL together, the latest start for that URL decides, not the navigation that
actually committed."* Written by Henry from `#184`, closed as a scoped known heuristic, and now
observed firing.

## The fix this points at, NOT yet built

Electron 43 exposes no navigation id on `did-navigate` (checked while measuring `initiator` for
`#184`), so identity has to come from state we already hold — and we already hold it.
`loadMirrored` sets `this.mirroring = true` for the duration of the mirrored load, so the mirror's
`did-start-navigation` fires inside that window. Record it on the entry (`mirrored: this.mirroring`
in the `starts.push` at `targetSource.ts:491`) and have `startedByDocument` skip mirrored entries.
The reverse-find then reaches the document's start, because the only thing hiding it is an entry we
can already identify.

**Why it is not in this PR.** It changes a guard whose behaviour is pinned by a measured 0/20
spurious and 20/20 truthful, and this card family's own history is that **tightening one direction
breaks the other** — `bug-arrivals` records "without the address test … measured: true notes 20 in 20
down to 5". It needs its own arms, in both directions, before anyone believes it. The instrument
stays on `main` either way: it is what will show the fix working.

## Not yet established

- **which** of the two it is: a missing `starts` entry, an entry whose `initiator` is undefined, or
  the reverse-find matching the *other* navigation to the same url (the last is now the most likely,
  since it explains both directions with one mechanism and the others explain only one);
- **and, distinctly: LIMIT 2 as originally scoped, or something that changed since `#184`.** These
  point at different follow-ups and must not be collapsed. `bug-arrivals`'s four arms measured
  **0/20 spurious and 20/20 truthful** on this very fixture shape — a client-side `location.replace`,
  which commits the URL it started — and found it clean. So `:89` failing now means either a
  low-probability tail those twenty runs missed, a change since that measurement, or LIMIT 2 firing
  under CI timing a desk run never exercised. A sweep that reproduces the rate is what separates
  them; one sighting cannot.
- **`LIMIT 1` is scoped out for these fixtures and should stay out of the diagnosis.** It covers a
  *server* 302, whose commit URL has no start record. Both fixtures here use client-side
  `location.replace`. Naming it anyway would send the next person to `#171`'s `redirected` event for a
  case that is not this one.
- whether it reproduces off CI at all, and at what rate;
- whether `did-redirect-navigation` (handled separately at `targetSource.ts:500`) is involved.

Reading the code cannot distinguish these — three people read this path tonight and the run still
surprised all of them. **Instrument the two fields and print them, rather than reasoning further:**
one run that records `starts` and `initiator` at the moment of the dropped commit answers it.

## Acceptance

- the cause is named from a run that recorded `byDocument` and the `starts` entry it came from, not
  from a code reading;
- a genuine `location.replace` back to the pane's current address reports the note every time, with a
  control that fails when the guard at `ipc.ts:245` is loosened;
- **and a mirrored load never reports it**, with its own control — closing one direction while
  leaving the other is how this arrived here;
- `arrivals.spec.ts:89` passes on first attempt across a sweep, not on retry;
- the `docs/e2e-flakes.md` entry is updated to say it was a bug and not a flake.

## Why the register was wrong, kept deliberately

The entry sized a fix from one sighting, and "reasoned, not run" was on it honestly. The fix was then
applied on recurrence and **its own run refuted it within the hour**. The register is still worth
keeping — but a sized fix in it is a hypothesis, not a decision, and this is the case that shows the
difference.
