---
title: "a page that redirects itself back to the address the pane already holds can go unreported, and it is not a timing race"
column: doing
owner: "Henry"
kind: bug
release: blocks
waiting: "Henry: re-check the other acceptance items on today's tree — the throttled control is met, 280 runs, 2026-10-06"
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
dies; when it lands first, or the mirrored load does not happen, the note survives.

**`:71` is INFERRED, not measured, and the distinction is the point of saying it here.** The reading
is that a note *present* for a pane that only mirrored is this mechanism with the roles swapped.
That is symmetry, not evidence — **only the `:89` direction has a trace.** `:71` flaked again the
same evening, on `#424`'s run `35641299420`, and produced nothing: that branch was cut **before**
`#422` merged, so its tree carried no instrument (checked: `main` has it, that branch does not), and
`ci.yml` discarded the screenshots because the suite went green. Two independent reasons the evidence
was lost, both now closed — `#422` is on `main` for every branch cut after it, and `#425` keeps the
artefacts from a green run that flaked. **The next `:71` sighting confirms the symmetry or refutes
it. Until then this card has one direction measured and one assumed.**

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
  *(2026-10-05: now `arrivals.spec.ts:218`, "a page that really does redirect after loading still says so" —
  dated rather than rewritten, because this is the line the tally is measured against and a log search for
  `:89` returns nothing, which reads as "no result" and not as "pass".)*
  ***(2026-10-05, later: THIS ITEM IS UNSOUND AND IS WITHDRAWN AS A GATE — see "The sweep was measuring the
  machine" below. The test's premise holds only when the target's script wins a race by single-digit
  milliseconds, so a sweep of it measures the machine rather than the fix. Left in place because it is what
  the card promised; replaced, not deleted.)***
- the `docs/e2e-flakes.md` entry is updated to say it was a bug and not a flake.

## Why the register was wrong, kept deliberately

The entry sized a fix from one sighting, and "reasoned, not run" was on it honestly. The fix was then
applied on recurrence and **its own run refuted it within the hour**. The register is still worth
keeping — but a sized fix in it is a hypothesis, not a decision, and this is the case that shows the
difference.


## CLAIMED 2026-09-22 by Henry, on Opeyemi's pick for the next release

Taking this because I hold the diagnosis and wrote the `bug-arrivals` LIMIT 2 note it turned out to
be. `chore-scroll-host-budget-is-silent`, the other half of the release, is routed to Kenya — its
budget cut-off feeds lint's and audit's page coordinates and she has been inside that shared rect
logic.

**The shape, written before any code so it can be argued with rather than reviewed after:**

1. `starts.push` (`targetSource.ts:491`) records `mirrored: this.mirroring` beside `byDocument`.
2. `startedByDocument` skips mirrored entries, so the reverse-find reaches the document's start
   instead of the bus's — the exact failure the trace above shows.
3. **Two controls, each of which must go red when the guard is loosened:** the redirect case and the
   mirrored case. The acceptance says so, and this card family's history is that closing one
   direction opens the other.
4. **A sweep of `arrivals.spec.ts`, with the count stated** — not one green run. The bug fires on a
   5 ms race, so a single pass proves nothing, and this repository has spent two days on single
   passes read as evidence.

**The risk carried in, named first:** `mirroring` is a flag with a window, and this card exists
because a *different* flag's window was raced — `loadMirrored`'s promise resolving 4 ms before a
commit landed (`bug-arrivals`). So the first measurement is whether the mirror's
`did-start-navigation` genuinely fires **inside** that window on a real run. Reasoning about this
exact window is what produced the original defect; it gets measured.


## SWEPT 2026-09-22 — the fix trades one direction for the other, and must not ship

**`#431`'s `startedByDocument` change is withdrawn.** A single green CI run, two mechanism controls,
a measured trace and an independent PASS all said it was ready. **Twenty repetitions said otherwise.**

`arrivals.spec.ts` × 20, retries kept (so a `✘` is a first-attempt failure), run `35725663287`:

```
 4x  :71   REAL BUG    note PRESENT for a pane that only mirrored
 3x  :71   MY CONTROL  "the last commit for this address is the bus's" — false
 1x  :89   REAL BUG    note MISSING after a real redirect
       8 of 40 first attempts
```

### The fix causes the `:71` failures

The probe printed the guard's inputs on every repetition, so no further run was needed. The four
failing attempts carry a commit the passing ones do not:

```
hairline   mirroring: false    <- the setup navigate
redirect   mirroring: true     <- the bus
hairline   mirroring: true     <- the bus
hairline   mirroring: FALSE    <- a fourth commit, and not the bus's
matched: byDocument = true
```

That fourth commit is **the target's own `location.replace`** — the mirrored `redirect.html` running
inside the target and redirecting itself — **committing after `loadMirrored`'s window has closed.** It
is therefore not marked mirrored, `ipc.ts:230` does not suppress it, it reaches the address guard, and
**with the fix** `startedByDocument` answers `true`, so the note fires for a pane nobody asked to move.

**Before the fix that commit was saved by the bug.** The reverse-find matched the mirror's start,
`byDocument` read false, and the guard dropped it. Removing the wrong match removed the thing
accidentally holding the other direction — which is what `bug-arrivals` recorded as this family's
signature failure, and what this card's own acceptance demanded two controls for.

### `:89`'s remaining failure is a different guard

Its last hairline commit came back `mirroring: true`, so `ipc.ts:230` returned early and nothing
reached the attribution logic at all. **No change to `byDocument` can affect it.**

### What this means for the fix

`byDocument` cannot serve both directions, because the same signal that says *"the document
redirected"* also says *"the document redirected **because we mirrored a page that itself
redirects**"*. `mirrored`-on-the-start does not separate them: it covers the mirroring window, and the
commit that matters lands after the window closes.

**What a real fix has to distinguish** is a document-started navigation the *page* chose from one the
*bus* caused by mirroring a redirecting page. Nothing currently recorded says which. That is a
bigger change than one predicate, and it needs its own design before any code.

### What stands

- The diagnosis in the section above is unaffected: the reverse-find **does** match the mirror, and
  that **is** a defect. It is just not the only one on this path.
- `#429`'s `mirrored` field is merged, changes no behaviour, and is what made all of this visible.
- The instrument stays. Every future sighting arrives with the guard's inputs attached.

### The method note, because it is the transferable part

**One green run, two controls, a trace and a reviewer's PASS were all consistent with a change that
makes a live defect fire four times in twenty.** The sweep was in the acceptance because a 5 ms race
cannot be settled by a single sample, and it earned its place on its first use. A control written
from **one** trace is a model with extra steps — mine was wrong 3 times in 20, and I had described it
as "written from measurement, not a model".


## MEASURED 2026-09-22 — a baseline at last, and two corrections it forces

Six sweeps into this card nobody had run one on **unmodified `main`**. Every "before" number quoted
in the sections above came from a branch that already carried the skip-mirrored change, so a
treatment was being compared against another treatment and called a control.

`arrivals.spec.ts` × 20 on each, first-attempt failures (a `✘` counts even when the retry rescues it):

| build | `:89` note missing | `:71` note present |
| --- | --- | --- |
| **`main`** (run `35756415745`) | **3 / 20** | **0 / 20** |
| skip mirrored starts alone (`#431`) | 1 / 20 | **4 / 20** |
| provenance as a pane-level flag | 17 / 20 | 0 / 20 |
| **provenance on the navigation** (`#434`) | **0 / 20, then 2 / 20** | **0 / 20** |

**Correction 1: `:71` was never broken on `main`.** It is 0/20 there. The 4/20 was `#431`'s own
regression, described on this card as the baseline because no baseline existed.

**Correction 2: the fix does improve the real symptom.** `:89` goes from 3/20 to 2 failures across 40
— roughly 15% to 5%. That was doubted in the section above, on the strength of a comparison that had
no control in it.

### What still fails, and why the card stays open

**2 in 40 is not zero.** The residual is the mode named before any sweep ran: the bus's mirror landing
*after* the page's own redirect, suppressed at `ipc.ts:230`, where no attribution logic executes at
all. **A user can still lose the note.** Nothing in `#434` touches that path, and nothing should
without its own measurement.

### And a note on the tests, because four of them were mine and wrong

Four mechanism controls were written for the mirrored direction and a sweep refuted every one:

```
"no non-mirrored start exists for this address"       refuted 35668477308
"the last commit for this address is the bus's"       refuted 35725663287  3/20
"every commit after the setup is the bus's"           refuted 35754437200  3/20
"everything at or after redirect.html is the bus's"   refuted 35755066599  5/20
```

Each asserted an **order** in a log written by two actors at once. The orderings vary run to run, so
every one was true most of the time. **The behaviour assertion is the control here**, and it is the
only one with a red build behind it: `#431` regressed this direction and `toBeUndefined()` caught it
4 times in 20. A control that has failed on a broken build outranks a mechanism claim nobody can
state correctly.

## `#434` is in as `4e210fc`, 2026-09-22 — and the residual now has a mechanism, not a shrug

`#434`'s ordinary suite, run `35759060900` on `41cd572`: **619 passed, one `✘`** —
`arrivals.spec.ts:181` (this card's `:89`), retry-rescued. Idris byte-counted the same log and passed
it. **The `:140` direction did not fire at all**, so the trade `#433` recorded and refused to ship is
gone. One first-attempt failure in an ordinary suite is consistent with the 2-in-40 the sweep
measured. An improvement, not a cure — which is why this card stays in `doing`.

**The probe answered what six sweeps could not, on the run that failed.** The attribution was
*correct*:

```
matched {"at":…413917,"url":…hairline.html,"byDocument":true,"mirrored":false,"fromBusDocument":false}
```

`startFor` reached the document's own start; `byDocument` `true`, `fromBusDocument` `false`. **Every
predicate this card has argued about was right on the failing attempt.** The commit log says why that
did not help:

```
…413905  redirect.html   mirroring: false     ← the navigate the caller asked for
…413944  hairline.html   mirroring: TRUE      ← the page's OWN redirect, stamped as the bus's
```

The same two commits on a passing attempt:

```
…417180  redirect.html   mirroring: false
…417219  hairline.html   mirroring: false     ← attributed correctly, note fires
```

### The mechanism, stated exactly

`this.mirroring` is a bare boolean raised for the life of `loadMirrored`'s promise. It means *"the bus
is loading something right now"*, and `did-navigate` applies it to **whatever commits during that
window** without asking whether that commit is the navigation the bus requested.

On the failing attempt the bus was still inside `loadMirrored(redirect.html)` when the page ran its
own `location.replace('hairline.html')`. That commit is the page's, to an address the bus never asked
for, and it was stamped `mirroring: true` — so `ipc.ts:230`'s `if (inPage || mirrored) return` dropped
it before any attribution ran. **A 39 ms window is the entire remaining defect.** `#434` is real and
orthogonal: it corrects which start a commit answers, and this commit never reaches the code that
asks.

This supersedes the earlier reading in *"`:89`'s remaining failure is a different guard"*, which was
right that `ipc.ts:230` returns early and wrong to leave it there — the early return is a consequence,
and the bare window is the cause.

### The design this points at

`mirroring` must stop being a time window and become a claim about a **specific navigation**.
`loadMirrored(url)` knows the address it asked for; the commit carries the address it reached. A
commit is the bus's only if it is *the one the bus requested*:

- bus asked `redirect.html`, commit is `redirect.html` → the bus's, suppress
- bus asked `redirect.html`, commit is `hairline.html` → **not what the bus asked for** → the page
  redirected itself, and that is the note

It also reads correctly for `:140`, where the bus mirrors *both* hops: it asks for `redirect.html` and
then for `hairline.html`, so the hairline commit matches a request and stays suppressed. That is the
direction all four earlier attempts broke, which is the reason to write the design down before the
code.

**Candidate, not a conclusion.** A redirect chain can reach an address the bus also asked for on a
different hop, and two mirrored loads can overlap, so url-equality alone may not identify a
navigation — Chromium's own navigation id may be needed instead. This is one reading of two traces
from one run. By this card's own method note it earns nothing until a sweep says so: `--repeat-each=20`
on **both** directions, `main` measured first.

### CORRECTION, same day, before anyone builds on it

**The section above gives the right mechanism and the wrong reason for the `:140` half.** I wrote
that keying `mirroring` to the requested navigation "reads correctly for `:140`, where the bus mirrors
*both* hops — it asks for `redirect.html` and then for `hairline.html`, so the hairline commit matches
a request and stays suppressed."

**That is not what suppresses it, and the sentence would send an implementer at the wrong term.** In
`:140` the target's own copy of `redirect.html` runs its own `location.replace`, and that commit is the
*page's*, not a hop the bus asked for. Url-keying alone would let it through and the note would fire
for a pane nobody asked to move — the exact regression `#431` shipped and a 20x sweep caught 4 times
in 20.

What actually holds that direction is the **other** term already in `did-navigate`:

```ts
const fromBus = this.mirroring || (byDocument && start?.fromBusDocument === true)
```

`fromBusDocument` says the navigation began inside a document the bus placed, so a chain the bus
started stays the bus's however late it lands. The traces in hand show both halves without a new run:

| run, attempt | the document's own start for `hairline.html` |
| --- | --- |
| `:181` failing | `byDocument: true, mirrored: false, fromBusDocument: **false**` — caller's navigate placed it, so the note *should* fire |
| `:140` baseline | `byDocument: true, mirrored: false, fromBusDocument: **true**` — the bus placed it, so silence is right |

### So the change is smaller than the section above implies

Only the **first** term is wrong. `this.mirroring` is a window; it exists to suppress the bus's *own*
load commit, and it should be a claim about that one navigation:

- `mirrorRequested: string | undefined` in place of the boolean, set to the url `loadMirrored` asked
  for and cleared in the same `finally`
- suppress on the window term only when the commit's url **is** that url
- leave `byDocument && fromBusDocument` untouched — it is already the term that carries a redirect
  chain, and `#434` is what made it trustworthy

`fromBusDocument` is not redundant with the narrowed window and must not be folded into it: one
answers *"is this the load the bus asked for"*, the other *"did this navigation begin in a document the
bus placed"*. The four failed attempts all came from making one field answer both.

**Unchanged by this correction:** the diagnosis, the 39 ms window, and the requirement that none of it
ships on reasoning. Both directions still need `--repeat-each=20` with `main` measured first.

**Why this is written down rather than quietly fixed.** The card is the thing the next session reads.
I authored a wrong justification in the same hour as a right diagnosis, which is this repo's own
recorded pattern — the N+1th defect gets written while fixing the first N — and a correction that
leaves no trace teaches nobody.

## BUILT 2026-09-22 — `#440`, and a 75-second measurement that priced the sweep

`#440` implements the candidate `#438` narrowed to. `mirrorRequested` holds the address the bus asked
for; `isMirrorCommit(url, byDocument)` answers whether *this* commit is that load — the requested
address, **or** a different one with no document initiator. That second arm is a case no test covers:
a server-side redirect of the bus's own load, where the bus asked for A and Chromium committed B with
no page involved, which url-equality alone would read as the page navigating. `fromBusDocument` stays
a separate term, and the start-time `mirrored` flag narrows the same way — the mirror's **own** start
rather than any start concurrent with it, so a start to another address during the window stays
findable by `startFor`.

### The local sweep, and why its silence is the finding

| arm | `arrivals.spec.ts --repeat-each=20`, same machine, each rebuilt |
| --- | --- |
| `#440` | 40 passed, **0** first-attempt failures |
| `origin/main` | 40 passed, **0** first-attempt failures |

**`main` is silent too, so the treatment arm says nothing.** `main`'s CI rate on this direction is 3
in 20; locally it is 0 in 40. The race does not reproduce on this hardware, so a green branch arm fits
*"the fix works"* and *"there is nothing here to fix locally"* equally — and the baseline says which.

Two things the 75 seconds did buy, and they are not small:

- **no regression** across 40 runs of both directions, which is the cheapest thing a local run can
  ever be asked for
- **the answer to whether the CI sweep is worth three suites.** It is, and that is now measured rather
  than argued. Discovering it from CI would have cost the three suites first.

### The gate, stated so a green suite cannot be mistaken for a pass

The ordinary suite runs each of these tests **once**, against a `main` rate of 3 in 20. A single green
run on `#440` is the expected outcome whether the fix works or not. **`#440` must not merge on its own
suite.** What qualifies it is `--repeat-each=20` on both directions, on the branch *and* on `main`,
with `✘` byte-counted — the shape Dogu used on `#439`, and the shape this card has demanded since its
acceptance was written.

### Two defects I authored while building it, both caught before the push

- `prettier --write` on `targetSource.ts` reformatted **the whole file**: 617 insertions against a real
  change of 59. There is no `.prettierrc`, no format script and no prettier step in `ci.yml` — the tree
  is not prettier-formatted, and running it would have buried the change. Reverted, re-applied the
  semantic edits from a script.
- I kept a `mirroring` getter "for the places that legitimately ask whether a load is in flight", then
  grepped: **nothing reads it.** Removed. That is the dead-code defect Idris found in
  `startedByDocument`, authored again, by me, in the act of fixing what sat next to it.

### The third defect, found by trying to close the test gap Idris named

Idris read `#440` and flagged **no test changes**. `isMirrorCommit`'s second arm — a commit to a
different address with no document initiator is still the bus's — had none, and the PR body claimed
url-equality alone would misread that case.

`file://` cannot express a server-side redirect, which is **why the case went untested**: every
fixture on this path redirects from inside the page, the one kind of redirect that carries an
initiator. So the spec grew a 302 from `/from` to `/to` and drove `loadMirrored` directly.

**Then the line was weakened to url-equality only, and the sabotaged build passed 3/3.**

- **The test is reverted.** It passes on `main`, on the fix and on the sabotage. A test that cannot
  fail is not a control, and this card already carries four refuted mechanism assertions.
- **The arm stays, relabelled `conservative, not measured`** (`91a4924`). The boolean it replaces did
  suppress that commit via the window, so dropping the arm changes behaviour no spec covers — the safer
  of two unmeasured options, and now written as such in the code and in `#440`'s body.

So `#440` is **one measured fix plus one labelled conservative arm**, not two claims that both looked
measured.

**That is twice in one day a comment of mine outran its evidence** — the `:140` justification in `#437`
was the first, and `#438` corrected it. Both were caught by doing what this card demands rather than
what I had written about it, which is the argument *for* the CI sweep and not against it. The
transferable form: **the sentence explaining a line is a claim, and it needs buying at the same rate
the line does.** See `docs/note-inventory.md`'s method entries and `bug-arrivals`.

### REVERSED, an hour later: the arm is measured, and the refutation was the bug

The section above is wrong where it matters, and the way it went wrong is worth more than the
conclusion it reached.

`mirror-302.spec.ts` — **its own file, its own app** — serves the 302, drives `loadMirrored`, and
**fails when the arm is removed**, on the first attempt and on the retry:

```
the bus asked for this load and a server moved it: {"url":"http://127.0.0.1:PORT/to","mirroring":false}
notes: ["the page navigated after it loaded, to http://127.0.0.1:PORT/to: …"]
```

So the case is real, the arm is bought, and the code comment says *measured* rather than
*conservative* (`0eb7e8c`).

**Why the first attempt said the opposite.** That control lived in `arrivals.spec.ts`, whose app is
shared with two tests that drive several commits — **its own header says they perturb whoever runs
next**, and names `sync-mirror-mark.spec` as the pattern for a test that needs a clean record. Mine
needed a clean arrivals record and did not get one, so it passed on the sabotaged build and detected
nothing.

**The failure mode to keep.** A test that detects nothing is indistinguishable, from the outside, from
a case that cannot happen — and I read it the second way and wrote the arm off. This card already
holds *"a control nobody has watched fail is not a control"*; the corollary is now measured: **a
control that has been watched pass on a broken build is evidence about the control, never about the
code.** The file header records both attempts so the next person does not rediscover it by writing the
same shared-app test.

There is also a plainer lesson. Twice today I ran a probe against the wrong branch's build — once
measuring `main` while believing I was measuring the fix — and both times the tell was a number that
was too tidy. `grep -c mirrorRequested` on the file under test costs nothing and would have caught it
the first time.

## `#440` is in as `785498e5` — and the sweep it was waiting for is retired

Merged on Opeyemi's pick of options 1 and 2, **as titled and not as this card's fix**. Suite
`35808181483`: **620 passed, 1 `✘`** — `throttle-live.spec.ts:48`, a `beforeAll` app-launch timeout,
retried green in 20 ms, from a documented flake family (×11 in `bug-ci-main-red-37pct`).
`arrivals.spec.ts` did not fire at all; `mirror-302.spec.ts` passed on CI in 838 ms.

**A neighbouring spec's app launch timed out on the run where I added a spec that launches an app.**
That is the shape of *my change did this*, so it was checked rather than dismissed: `playwright.config.ts`
sets `workers: 1`, so specs run sequentially and mine cannot contend with `throttle-live`. Ruled out by
the config. Runtime moved 21.3m → 27.1m, which one sequential 838 ms test cannot account for; the run
also queued 11 minutes.

### The sweep is obsolete, and that is option 1's real result

Driving the collision directly — `target.load(redirect.html)`, then the bus's `loadMirrored(hairline)`
at a chosen offset — **reproduces a missing note on demand, locally, in 8 seconds**:

| mirror fired | hairline commits | note |
| --- | --- | --- |
| never (control) | 2 | present |
| **+0 ms** | 4 | **MISSING** |
| +5 / +15 / +30 / +60 ms | 3 | present |

**~60 CI repeats were the plan for bounding a 10% race. A defect that fires on demand needs none of
them** — a candidate either stops `delay=0` or it does not. That spend is off the table and it cost no
runner time to retire.

### And the supersede hypothesis is refuted

I proposed that the bus's mirror *cancels* the page's own navigation, so no commit exists to carry the
note. **Wrong: at `delay=0` there are four hairline commits, the page's own among them at
`mirroring: false`.** Nothing is cancelled. My reading of `35759060900` as a supersede was an artifact
of looking at a six-entry window.

### What is NOT established, in Idris's framing, which is the one to scope from

| | culprit commit | what failed |
| --- | --- | --- |
| `35759060900`, `35807960696` | stamped `mirroring: TRUE` | attribution said the **wrong** thing |
| the `delay=0` repro | page's own commit at `mirroring: false` | attribution said the **right** thing and the note still went missing |

**Two different shapes, and I reported the second as a reproduction of the first because it produced
the symptom I was hunting.** Symptom match is not defect match — the same error as reading a control's
green as a fact about the product, made twice in one day.

The discriminator is the **arrivals counter, sampled after each commit**: if it never moves at
`delay=0`, something drops a commit whose address plainly differs and Idris's `#1896` replay remains
the correct account of the CI collision; if it moves and no note appears, the defect is in the note's
own condition. `arrivals` is a `ControlServer` **dependency**, not one of its commands — the server
lists its command set back at you — so this needs a test-only hook in `src/`, bought by this defect,
as its own change. **That is what `waiting:` now names, and it is a measurement, not a fix.**

## CORRECTION to the section above: the repro was a cancelled load, and the sweep is NOT retired

**`#442` is wrong where it matters most.** It says a deterministic repro makes ~60 CI repeats
unnecessary. There is no repro. What `delay=0` produces is **my probe cancelling a navigation**, and
the missing note there is correct behaviour.

The counter was exposed to tests to settle Idris's question, and it answered a different one within
two runs. **One fresh app per case** — the earlier table shared an app, so each case inherited the
previous one's count, which is the `arrivals.spec` mistake made a second time:

| mirror fired | commits | arrivals | note |
| --- | --- | --- | --- |
| never | `about:blank`, `hairline`, **`redirect`**, `hairline` | 3 | present |
| **+0 ms** | `about:blank`, `hairline`, `hairline*` | **1** | MISSING |
| +5 ms | …, `redirect`, `hairline` | 3 | present |
| +15 ms | …, `redirect`, `hairline`, `hairline*` | 3 | present |

`*` = recorded as the bus's.

**At +0 ms there is no `redirect.html` commit at all.** Firing `loadMirrored` zero milliseconds after
`load()` starts cancels that load before it commits. The page never navigated itself, so there is
nothing to report. **Not a defect — an artifact of the probe.**

So: **the sweep stands as the only instrument for this card**, and `#442`'s claim that it was retired
is withdrawn. No offset tried (`0`, `5`, `15`, `30`, `60`) reproduced the shape the CI failures show —
a `redirect.html` commit present and the note missing anyway.

### What was built and then deliberately not shipped

A `testState.arrivals` accessor (four lines in `ipc.ts`, two in `testHooks.ts`) and an invariant spec:
*the page's own navigation committed ⟺ the note is there and the count moved*. Both were reverted.

- the spec is **not a control**: sabotaged back to the pre-`#440` bare window it still passed **20/20**,
  because at `+0 ms` the load is cancelled and the invariant's other branch holds. An assertion watched
  passing on a broken build is evidence about the assertion.
- with no reader, the accessor is a test-only surface in `src/` bought by an audit rather than a
  defect, which this repo refuses on purpose.

**Re-adding it is four lines** when a real investigation needs it: `testState.arrivals = () => ({
...arrivals(tab()) })` beside the `arrivals` closure in `registerIpc`, the matching field on
`testState` and on `TestHandle`, published by `testHooks.ts` under `OBSRV_TEST=1`.

### The pattern, stated once

Five corrections on this card in one day, and every one has the same shape: **I stopped at the first
result that matched what I expected.** The supersede reading, the `:140` justification, the arm
declared unmeasurable, the ownership of a card I had handed away, and now a repro that was my own
probe. The instrument that caught the last one existed for ninety minutes and paid for itself twice;
the standing lesson is not about counters, it is that **a result agreeing with me is the one to
re-run under isolation.**

## The `waiting:` line was stale, corrected 2026-09-23

It named **me**, for *"expose the arrivals counter to tests, to settle whether the `delay=0` repro is
this defect or a second one"* — **work that was finished hours earlier** and recorded in `#444`: with
one fresh app per case the `+0 ms` case has **no `redirect.html` commit at all**, so the probe was
cancelling the page's load and the missing note there is correct behaviour rather than any defect.

**So this card has not been waiting on me since then.** It waits on a decision, and the line now says
so:

1. **a forcing route** — hold the bus's mirrored load open behind a test-only seam so the page's
   redirect always lands inside it, making the CI shape reproducible on demand. That is a fence in
   `src/` bought by this defect;
2. **park it** in `backlog` with everything measured written down, and wait for a third sighting.

**Why it cannot proceed without that choice:** no offset tried reproduces the shape the CI failures
show — a page's own redirect stamped as the bus's. `main` measured 3-in-20 and 1-in-20 across two
sweeps; the fix's clean 20 is the one-in-eight computed from the pooled rate. There is no instrument
short of sampling CI, and building one means putting a seam in production code for a defect only CI has
ever seen.

## A candidate mechanism, dated 2026-09-28 — still waiting on the same choice above

While reviewing unrelated QA-flow PRs the same night, Henry noticed `arrivals.spec.ts:181` (the
current line for this card's test — renumbered since `:89` above) failing on **four runs across
three PRs, two of those runs on `#478`'s identical tree** (confirmed from each log's checked-out
head against GitHub, not from labelling) — **`#477` once, `#483` once, and `#478` twice on one
unchanged tree, where it failed three of its four attempts** (run one's first try and its retry,
then run two's first try again) — none of them touching redirect code, and pulled the candidate
count (`startsForThisUrl`, the reverse-find's pool of same-URL navigation starts) from every saved
log:

| starts for the URL | outcome across 4 sightings |
| --- | --- |
| 6 | fails, 4 of 4 |
| 2–3 | passes, 3 of 4 (the one exception: `#478`'s retry, failed at 3) |

Read together with `ipc.ts`'s reverse-find (documented above, in `docs/e2e-flakes.md`'s
`arrivals.spec.ts:89` entry, which this table was added to in `#486`): with six candidate starts for
the same URL, the reverse-find lands on one with no redirect provenance and the note is never
produced — not late, genuinely never made. `fromBusDocument` alone does **not** discriminate
(checked: the passing blocks carry `false` too); the count is the signal.

**This promotes the mechanism from *unproven* to *supported, with a stated way to force it* — not to
proven, and not to a forcing route that exists yet.** It is a reading of six logs, one exception
unexplained, not a run. The two options above are unchanged; what this adds is a concrete, checkable
prediction either option can now be tested against: **splice extra same-URL navigations in before the
redirect to reach six starts, and see if it fails on demand.**

**Whoever runs that test: it must be a CI run with both arms baselined in the same run — the spliced
spec and the unmodified one — not a local repeat.** This card already measured why, above, in
*"The local sweep, and why its silence is the finding"* (`#440`, 2026-09-22): 20x local repeats of
both the fix and `main` came back 0-in-40 on each arm, same machine, against `main`'s actual CI rate
of 3-in-20 on that direction. Same reasoning applies unchanged to a spliced-vs-unmodified pair: a
local-only result here cannot distinguish "six starts doesn't force it" from "this machine never
reproduces the race either way" — the exact shape that already burned this card once (the
`expect.poll` fix that a reading suggested and a CI run refuted). A green local splice would look
like a refutation and would not be one. Don't re-run the local sweep to check this — it's the
paragraph directly above.

## RELEASE CLASS 2026-09-29 — `blocks`

**Class 1.** A page redirects itself and no note is produced, so the silence fits "it did not redirect" and "we did not see it" equally — the gate's definition verbatim. The timing reading is already falsified on the card: the sized poll sat 10 s and still got `undefined`. A downgrade would have to name the warning that makes it detectable, and **there is no such warning — that is the defect.**

## BOTH FORCING ROUTES ARE BUILT, AND BOTH REFUTE THE MECHANISM THIS CARD NAMED, 2026-09-29

> **Overstated — see "CORRECTION 2026-10-02" at the foot of this card.** Route one failed once in CI
> three days later. The text below is left as written.

The ask on the `waiting:` line above was a forcing route. Two exist now, and neither reproduces the
failure.

**Route one — `tests/e2e/redirect-forcing-route.spec.ts`** forces six same-url starts before the
redirect and asserts the property that must hold either way: the start a commit is answered with
belongs to **that** navigation, by a boundary timestamp the test owns rather than by a url match,
which would restate `startFor`'s own predicate. In CI run `36578277923` the forced arm **passed**
while the natural `arrivals.spec.ts:181` **failed** in the same run — and the failing arm's matched
start carried **`byDocument: true`**, which is the one value at which `ipc.ts:245`'s
`if (url === arrivals(s).url && !byDocument) return` **cannot fire**. So the drop this card has named
since it was filed is not what silenced the note on that attempt.

**Route two — `tests/e2e/redirect-mirrored-pool.spec.ts`**, built for the question route one left:
the failing pool held **two mirrored starts among its six** and the forced pool held none, and
`startFor` skips mirrored starts, so two pools both counted as six were never the same pool. Route
two forces the composition through the bus (driving `native.load(redirect.html)`, whose mirrored hop
lands on the address under test). It builds a pool **deeper and more mirrored than the failing one** —
9–12 starts, 6–7 of them the bus's — and the find still answers correctly in all 11 local runs, every
time with a start recorded 9–12 ms **after** the boundary.

**What is now established, and what is not.**

- Pool depth and the presence of mirrored starts are **not sufficient** to make `startFor` answer with
  a stale start. Two independent routes aimed at the named mechanism both pass.
- The **correlation survives** — seven sightings, every failure at six candidates, every pass at two
  or three. It was always a correlation, and it is now a correlation with its stated explanation
  refuted.
- **No replacement mechanism is offered.** This card has burned two fixes on the shape of reasoning
  that would offer one, and the earlier local-sweep warning on this card applies to route two's local
  nulls exactly as written: 0-in-11 here cannot distinguish "the condition does not force it" from
  "this machine never reproduces it either way". Route two's value is that it now runs in CI on every
  PR and prints its pool on pass as well as failure, so the next CI sighting of
  `arrivals.spec.ts:181` comes with a forced pool beside it from the same runner.

**The class does not move.** Still class 1, still `blocks`: a page redirects itself and no note is
produced, and nothing in the reply distinguishes that from a page that did not redirect. Two refuted
mechanisms make the cause less understood than this card claimed, not more detectable.

## EIGHTH SIGHTING 2026-09-29 — the drop is ruled out for its own attempt, and the next instrument is in

Run `36596468138` (`#516`'s suite), `arrivals.spec.ts:181`, note missing, retry-rescued,
`startsForThisUrl: 6` — the correlation's eighth. **And the matched start was the redirect's own.** The
six hairline starts in order are `690242`, `690758`, `690763`, `691065`, **`691453` (matched)**,
`691478`; `redirect.html`'s start is at `691421` and its commit lands at `691443`, so the match is the
next navigation start after the redirect page committed, `byDocument: true`, `mirrored: false`, ahead of
the later mirrored start at `691478`. (The first version of this section said the `redirect.html`
**start** was at `691443` — that is the commit's timestamp, stitched onto a start's fields while reading
the print as text rather than parsing it. Idris parsed the array and caught it; the reading is unchanged
and stronger stated correctly.) At `byDocument: true` this card's named drop
(`if (url === arrivals(s).url && !byDocument) return`) **cannot fire**, so the commit was counted and
the silence is downstream of it — the second sighting in a row saying so, this time with the chosen
start visibly right rather than merely carrying a surprising flag.

**Where it can still come from, as a candidate only.** `ipc.ts:274` is the only other gate on the
sentence: `if (seen.count > asked.atCount && seen.url)`. `atCount` is snapshotted at `ipc.ts:321`,
**after** `await Promise.all([native.load, target.load])`. A client-side redirect commits inside the
load it belongs to, so whether its arrival is counted before or after that snapshot is a race; if
before, `atCount` already includes it and the note is never made, with every field this card prints
looking correct. The `settle` hook below it arms only when the count did *not* move — the opposite case.

This card has named two mechanisms and had both refuted by routes built to force them. A third reading
that fits one trace is worth what those were worth at this stage, so **no fix is proposed on it.**

**What went in instead, and it needs no product seam.** If the arrival preceded the snapshot then
`landedAt` was already `hairline.html`, so `landedElsewhereNote` should have fired — a *different*
sentence about the same journey. Nobody has ever looked, because `movedNote()` returned only the match
for *"navigated after it loaded"* and discarded the rest of the reply. `tests/e2e/arrivals.spec.ts` now
reads every note, prints them on pass as well as failure, and names them in the failure message.

| the next failing reply carries | what it means for this card |
| --- | --- |
| no notes at all | the class-1 silence stands, and the `atCount` race is the live candidate — which needs the two counts exposed to go further, and that is a product seam to be bought then, not now |
| a `landedElsewhere` note | the product did say something, the test has been looking for the wrong sentence, and **this card's class is not what it says** |

Watched green locally before shipping, which is this card's own rule for an instrument: `:71` baseline
prints `notes: []`, `:89` baseline prints exactly one sentence — the navigated-after-load one, and no
`landedElsewhere`. The arms differ, so the next sighting answers rather than accumulates.

**Class unchanged at class 1 / `blocks` until that answer arrives.** A downgrade needs the warning that
makes the wrong answer detectable, and "there might be a different note" is not a measurement.

## PARKED FOR 0.63.0 BY OPEYEMI, 2026-09-29 — the class does not change

**His words, quoted rather than paraphrased**, because this is an arbitration and the record should
carry what was actually said. Asked to choose between *park* (ship with the two class 1s open, recorded
as his decision) and *hunt* (hold the release), having been shown the release-notes paragraph a user
would read, he answered: **"ok lets get on it."** I read that as park. If that reading is wrong, this
section is the thing to correct — the cut can be undone, and a downgrade written into the class cannot.

**`release:` stays `blocks` and the class stays 1.** Nothing about the defect changed. What changed is
that the release goes out with it named, in the release notes, in the user's words rather than the
board's. This is deliberately not a downgrade: a later reader must not be able to mistake "it shipped"
for "it was resolved".

**What ships.** A page that redirects itself back to the address the pane already holds can produce no
note, so a caller reading the reply cannot tell *"it did not redirect"* from *"we could not see it"*.
The guarded test fails about 3 runs in 20 in CI; 0 in 40 locally.

**Why no fix went in instead.** Two mechanisms have been named on this card and both were refuted by
routes built to force them — `redirect-forcing-route.spec.ts` and `redirect-mirrored-pool.spec.ts`. The
third reading (`ipc.ts:274`'s `seen.count > asked.atCount`, with `atCount` snapshotted after the load
resolves) is a candidate and is written as one. Shipping a fix built on a candidate is what this card
has already paid for twice.

**What improved, and it is the thing to watch.** `arrivals.spec.ts` now reads **every** note in the
reply and prints them. The next sighting answers a question eight sightings could not: empty notes mean
the class-1 silence stands; a `landedElsewhere` note means the product did say something and the test
was looking for the wrong sentence — which would change this card's class rather than its status.

**Where the instruction arrived, recorded because Idris could not check it and said so.** Opeyemi's
words came in **Henry's own session, not in the Obsrv Engineering room** — so what the room has is a
relay, and a reviewer reading only the room cannot authenticate the quote. She flagged exactly that
before endorsing the reading, which is the right order. The transcript of that session is the primary
source; this line exists so nobody later mistakes the room's copy for the original.

## CORRECTION 2026-10-02 — "both forcing routes refute the mechanism" was true of pool depth, and overstated what it ruled out

**Nothing above is deleted.** The 2026-09-29 section and the eighth-sighting section stay as written;
this sits beside them. It decides no conclusion and proposes no fix — the card's rule stands. Added by
Idris at Wren's suggestion (room `#2966`), unmerged, for Henry to amend; every figure below was
re-derived from retained raw CI logs, not from the room.

### 1. Route one can fail

`redirect-forcing-route.spec.ts:100` (its line at `f6007be`; `:109` once `#541` lands, which adds 9 lines above it)
failed once in CI: run `36986610250` (`#540`'s suite, head
`afa0c93cd9205bcbcb9039d8d865c0a0eeb3c1cb`), **first attempt**. Its print, then the retry's, in the same run:

```
before=6 after=7 boundary=1790932325300 matched=at=1790932325201 byDocument=false age=99ms   (failed)
before=6 after=7 boundary=1790932328484 matched=at=1790932328552 byDocument=true  age=-68ms  (retry, fresh app, passed)
```

The failure message is the test's own: *"the commit was answered with a start from 99 ms before the
redirect was triggered — an earlier visit to the same address."* That is the end state the card's
2026-09-28 candidate named — `startFor` answering a redirect commit with an earlier navigation's start, whose
`byDocument` is false — **reached under the forcing route.** The other 39 prints I could find (38
earlier runs, plus the retry above) all show `byDocument=true` and a start recorded after the boundary.

**What it does not show.**

- **Not that pool depth is the cause.** Six same-address starts is what the route forces and what 39
  passes also had. The 2026-09-29 reading that depth and mirrored starts are *not sufficient* stands.
- **Not what the 7th start was.** The line prints counts, not the new start's flags. `after − before = 1`
  and the matched start predates the boundary, so by `startFor`'s own predicate (`!s.mirrored`) the one
  post-boundary hairline start must have been `mirrored: true`, and skipped. **That is a deduction from a
  count and a predicate, not a measurement.** `#541` prints the flags.
- **Not the missing note.** This route asserts which start is chosen, not whether a note was produced.
- **One failure in 40.** A candidate, per this card's own rule for one run.

### 2. The eighth sighting's "so the commit was counted" does not survive the commit log it printed

That section reads `byDocument: true` on the matched start as ruling the `ipc.ts:245` drop out — "so the
commit was counted and the silence is downstream of it". `:245` is not the first gate. `ipc.ts:231`,
`if (inPage || mirrored) return`, runs **before** it, and `mirrored` is the commit log's own `mirroring`
field (`targetSource.ts:540`'s `fromBus` is both recorded and emitted). The guard print carries the
commits; the table below reads them as a set.

Of **150 CI runs examined, 2026-09-28 → 10-02, 93 carried a `:89` guard print**, and they hold **106
attempts** (a retry adds one): 13 missing, 93 present. The two 93s are a coincidence — runs in one case,
attempts in the other. Parsed as JSON:

| | missing (13) | present (93) |
| --- | --- | --- |
| a commit **after the caller's own `redirect.html`** with `mirroring: false` | **0 of 13** | **93 of 93** |
| the matched start | `byDocument: true`, at/after the caller's `redirect.html` start — correct on its face, **13 of 13** | — |

0 counter-examples. Within one attempt type (a retry is a **fresh app**; the failures are almost all
shared-app first tries, so the two cannot be compared across types): shared-app first tries 12 missing
against 81 present, fresh-app 1 against 12 — the same separation in each. Every missing attempt's commits
after `redirect.html` were stamped the bus's, so `:231` returned before any count; the `atCount` candidate
at `ipc.ts:274` presupposes a *counted* commit, and none of these 13 had one.

**Limits, stated because the separator is easy to over-read.**

- **It is close to a restatement of the gate.** A commit stamped `mirroring: true` is dropped at `:231` by
  construction, so this says **where** the note is lost, not **why the page's own redirect commit is
  stamped the bus's.** That is the open question.
- **Association, not cause.** Five days, one runner type, and these are the attempts whose raw logs were
  retained.
- **A candidate for the why, not a finding:** `isMirrorCommit` (`targetSource.ts:348`) is
  `url === this.mirrorRequested || !byDocument`, and a navigation *start* is stamped
  `mirrored: this.mirrorRequested === details.url` (`:602`) — the same address-equality assumption at two
  sites. Route one's single failure (§1) is the start-layer instance of it **only if** the 7th start was
  in fact mirrored, which is unmeasured. The 13 natural failures had a correct matched start, so they are
  the commit-layer instance if either. Two sites, not one event.

### 3. What was built to find out, and what waits

- **`#540`** — the commit record carries which of `isMirrorCommit`'s terms stamped it (`mirrorRequested`,
  `viaMirrorUrl`, `viaNotByDocument`, `viaBusDocument`), recorded beside `fromBus`, deciding nothing. The
  next failing `:89` print will say which term fired. Dogu's independent count: `PASS` at
  `afa0c93cd9205bcbcb9039d8d865c0a0eeb3c1cb`. **Not merged; it touches `src/`, which is Henry's call.**
- **`#541`** — test-only: route one prints every start since the boundary with its `mirrored` /
  `byDocument` flags, and the last 8 commits, so the next route-one failure answers §1's deduction.

**Where the instruction came from, recorded the way the section above records it.** *"keep hunting,
instrument first"* reached the room as Wren's relay of Opeyemi, from Wren's own session (`#2952`); the
room copy is not the original and Idris could not authenticate it. A later room post, *"Let's go with your
recommendations"* (`#2954`), is ambiguous about which recommendations and was read narrowly — as
`#540` only. **The class does not move:** still class 1, still `blocks`.

### 4. A second failure mode in the same test, found by the sightings sweep 2026-10-03

`arrivals.spec.ts` `a page that really does redirect after loading still says so` failed its first attempt in
**14** runs over 09-28 → 10-03 (13 rescued by the retry, 1 failed both: `36504076439`). **13 are the note-MISSING
print this card is about. The 14th is not**: run `36665868209` (`feat/flow-type-text`, 09-30 03:45Z, the test at
`:202` on that branch; the run itself was later `cancelled`, but the test ran and its retry passed).

The note was **present** (`"the page navigated after it loaded, to …"`), and the guard's **second** assertion
failed instead — *"the guard did not reach the document's own start"*. Its print: `matched` =
`byDocument: false`, `mirrored: false`, **`fromBusDocument: true`**, `startsForThisUrl: 5`; an unmirrored commit
exists after the caller's `redirect.html` (the last commit, `hairline.html`, `mirroring: false`), which is why the
note could be made. The retry's print is the usual shape: `byDocument: true`, `startsForThisUrl: 2`.

**What it is, and is not.** It is the start-layer condition the 2026-09-28 candidate named — `startFor` answering with
a start that is not the document's own, `byDocument: false` — **occurring in a natural run, once**, without the note
being lost. It is not a missing note, and no other card or register entry records it. Together with §1 the start layer
now has two occurrences (this one natural, §1's forced) against **13 of 13** at the commit layer in §2's window (**14 of 14** over §5's); whether the two are
the same assumption at two sites, as §2 puts it as a candidate, is unmeasured. One sighting on a feature branch,
first attempt only; a candidate, by this card's own rule.

The sweep's table, with every run id behind these counts, is in the room (`#3115` and `#3116`); it is not committed.

### 5. §2's table, extended, and what is and is not checked about the extension

§2's window began at 2026-09-28T18:07Z (where the first saved logs start) and ended 10-02 07:32Z. The sweep in §4 pulled
every `ci.yml` run since **09-28T00:00Z** and through 10-03 and ran the same classification over it:

| | missing | present |
| --- | --- | --- |
| shared-app first try, an unmirrored commit **after** the caller's `redirect.html` | **0 of 13** | **90 of 90** |
| fresh app (a retry), the same | **0 of 1** | **13 of 13** |

**14 missing, 103 present, 0 counter-examples.** The extension adds one missing attempt, run `36455653071`
(`feat/flow-tool`, 09-28 17:05Z, before §2's window), and the present attempts of the later runs. Nothing about the
reading changes. **Both windows have been recounted independently** (Dogu: `#2972` for §2's window, and `#3126` for this
one, from every run since 09-28T00:00Z, **117 attempts, 14 missing, 103 present, 0 counter-examples**, matching this
table exactly). That re-measures the table from the same logs and the same association; it does not test the mechanism.
(His first pass was one present attempt short because one raw log had been saved empty; he found and corrected that
himself, `#3126`, which is why the §2 figures above are not quoted from `#2972`.)

## THE FIRST THREE FAILING PRINTS WITH THE TERMS, 2026-10-03 — `viaMirrorUrl` alone, every time

**Sources.** Three first-try failures of `tests/e2e/arrivals.spec.ts:218` (*a page that really does redirect after loading
still says so*), each at its assertion on `:247`, each **cleared by its own retry**, in three different CI runs:

1. Run `37162125066`, the `ci.yml` run of `#550` (branch `fix/pagerect-from-one-instant`, head
   `3ac9380631bc56dc63cc7266e884aeb538e3fc83`), attempt 1, at 23:34:49Z. The run ended `success`.
2. Run `37160406685`, the `ci.yml` run of `#548` (branch `feat/awaiting-lane`, head
   `6f8e9bad80474235cb08ff3c23993b6653cf8cd2`), **attempt 2**, at 23:54:32Z. Attempt 1 of that run was red for another
   reason (a worker teardown after `tabs.spec.ts:929`, every test passing); it passed `arrivals` both times. Attempt 2
   ended `success`.
3. Run `37189124696`, the `ci.yml` run of `#549` (branch `feat/board-live-view`, head
   `b1bd774b2e88373f373841dc7a7c0333a0ad57cf`), attempt 1, at 2026-10-04T08:32:15Z. The run ended `success`.

`#540` and `#541` (merged as `be19825` and `8d8b282`) are in all three trees, so all three prints carry `mirrorTerms`. All
are **after §5's window**, so §5's table does not include them. (§3 above still says `#540` is "Not merged"; that line is
out of date, it merged. It is left as written.)

**How common.** **Fourteen** CI attempts had the instrument in the tree CI ran and ran the e2e to its end; **three** of
them are the prints below. The listing is every attempt of every `ci.yml` run created since `#540` merged
(2026-10-03T22:35Z), keeping those whose suite job ran for the length of the e2e. **The criterion is the run's own
checkout, not the pull request's head:** a `pull_request` run builds the merge of the head into `main`'s tip, and
`main`'s tip (`998fbe6`) already had `#540`. The two `#546` runs say so in their own logs (`HEAD is now at 7db5807
Merge 7f8567c0… into 998fbe61…`, `HEAD is now at 2a187d4 Merge 494c2316… into 998fbe61…`), carry `mirrorTerms` in their
prints, and ran `arrivals` green. The fourteen:
- the five `main` suites (`37158975731`, `…979107`, `…988570`, `…992530`, `…995878`);
- `#546`: `37159176983` (run `cancelled`, suite job `success`, 659 passed) and `37159894326`;
- `#548`: `37159693589` (run `cancelled`, suite job finished, 659 passed), and `37160406685` attempts 1 and 2;
- `#549`: `37159968124`, `37165260134` and `37189124696` (the third print);
- `#550`: `37162125066` (the first print).

**Eleven** have no `arrivals` `✘` and no `note MISSING` print. Left out: the board-only runs, whose suite is
short-circuited (2-4 s). An attempt is one app launch and one suite, so a re-run is counted separately from the attempt it
follows. **This count was wrong several times and each time the error was mine or checked by a peer:** an earlier version of
this section said ten attempts, two failures, and left out `#546`'s two runs as "an older tree with no `mirrorTerms.ts`";
that tested the pull request's head and not what CI ran, and the logs refute it. Dogu's independent recount (`#3258`)
found it; I checked the two `#546` logs myself. The figure had moved 8, 7, 8, 9, 10, then a wrong 11 and 12 before 14,
and every wrong one was "the last count plus the one run I just read" instead of a fresh listing. A run created after this
listing, or one still in progress (`#552`'s, when this was written), is a later row. **Three failures in fourteen
attempts** is a stronger candidate than one, and still a candidate by this card's own rule.

**The first print, observed, not interpreted** (log lines 1397-1582 of my own `gh run view --log` pull of `#550`'s
run; times are the print's epoch milliseconds shown as UTC time of day; the "who" column is what the flags say):

| time | what | flags | who |
| --- | --- | --- | --- |
| 23:34:48.946 | start `redirect.html` | `byDocument: false`, `mirrored: false` | the caller's own navigation |
| 23:34:48.985 | **commit** `redirect.html` | `mirroring: false` | the caller's; the card's separator, as §2 expects |
| 23:34:48.993 | start `hairline.html` | `byDocument: true`, `mirrored: false` | the page's own redirect (this is `matched`) |
| 23:34:49.041 | start `hairline.html` | `byDocument: false`, `mirrored: true` | the bus's mirrored load, **48 ms** after the page's |
| 23:34:49.046 | **commit** `hairline.html` | `mirroring: true` | see terms below |
| 23:34:49.083 | **commit** `hairline.html` | `mirroring: true` | see terms below |

Both `hairline.html` commits carry the same `mirrorTerms`: `mirrorRequested` = the same `hairline.html`,
**`viaMirrorUrl: true`**, `byDocument: true`, **`viaNotByDocument: false`**, **`viaBusDocument: false`**. The reply
carried `notes: []`; `startsForThisUrl: 5`.

**The second print, the same way** (lines 512-682 of my pull of `#548`'s run with `--attempt 2`):

| time | what | flags | who |
| --- | --- | --- | --- |
| 23:54:31.308 | start `redirect.html` | `byDocument: false`, `mirrored: false` | the caller's own navigation |
| 23:54:31.339 | **commit** `redirect.html` | `mirroring: false` | the caller's, the separator again |
| 23:54:31.352 | start `hairline.html` | `byDocument: true`, `mirrored: false` | the page's own redirect (this is `matched`) |
| 23:54:31.377 | start `hairline.html` | `byDocument: false`, `mirrored: true` | the bus's mirrored load, **25 ms** after the page's |
| 23:54:31.390 | **commit** `hairline.html` | `mirroring: true` | see terms below |

The one `hairline.html` commit carries `mirrorRequested` = `hairline.html`, **`viaMirrorUrl: true`**, `byDocument: true`,
**`viaNotByDocument: false`**, **`viaBusDocument: false`**: the same terms as the first print's two. `notes: []`;
`startsForThisUrl: 6`.

**The third print, the same way** (lines 1399-1583 of my pull of `#549`'s run at `b1bd774`; 2026-10-04, 08:32 UTC):

| time | what | flags | who |
| --- | --- | --- | --- |
| 08:32:14.221 | start `redirect.html` | `byDocument: false`, `mirrored: false` | the caller's own navigation |
| 08:32:14.236 | **commit** `redirect.html` | `mirroring: false` | the caller's, the separator again |
| 08:32:14.242 | start `hairline.html` | `byDocument: true`, `mirrored: false` | the page's own redirect (this is `matched`) |
| 08:32:14.267 | start `hairline.html` | `byDocument: false`, `mirrored: true` | the bus's mirrored load, **25 ms** after the page's |
| 08:32:14.269 | **commit** `hairline.html` | `mirroring: true` | see terms below |
| 08:32:14.294 | **commit** `hairline.html` | `mirroring: true` | see terms below |

Both `hairline.html` commits carry `mirrorRequested` = `hairline.html`, **`viaMirrorUrl: true`**, `byDocument: true`,
**`viaNotByDocument: false`**, **`viaBusDocument: false`**. `notes: []`; `startsForThisUrl: 6`. In all three prints no
unmirrored commit follows the caller's `redirect.html`, so each is one more row for §2's separator (**0 of 3 missing with
an unmirrored commit after it**; §5's counts are not re-run for them).

**What differs between them.** The bus's mirrored start came 48 ms after the page's in the first print and 25 ms in the
second and third; the first `hairline.html` commit followed the mirrored start by 5 ms, 13 ms and 2 ms. And the first
and third prints have **two** `hairline.html` commits after the anchor (Dogu's `#3215` observation: two commits stamped
as the bus's after one mirrored start), while the second has **one** commit after **two** `hairline.html` starts. So the
two-commits feature **held in two of three prints and is not general**; Dogu said so himself (`#3231`), and Wren put it
the same way (`#3230`): "the page's commit and the mirror's commit, both stamped" cannot be the whole description. Nothing
should be built on the count of commits. Whether the page's navigation and the bus's collapsed into one commit in the
second print, I cannot tell from the record; that is a question, not a finding.

**The instrument discriminates; it does not print one thing.** In each log the *previous* test (the `:71` baseline,
where no note is expected) printed its own commits with **different** terms. In the first log its `redirect.html` is
stamped by `viaMirrorUrl` and `viaNotByDocument` together and its `hairline.html` by `viaBusDocument` alone; in the
second and third, its `hairline.html` is stamped by `viaMirrorUrl` **and** `viaBusDocument` together. Baseline commits
vary between runs too (Wren, `#3213`; Idris and Dogu on the second and third).

**Reading, an inference from those three records:** the term that fired is `viaMirrorUrl` alone, every time. The commit
that follows the caller's `redirect.html` is on `hairline.html`, an address the bus has in flight, so
`url === mirrorRequested` holds, the commit is stamped the bus's, and `ipc.ts:231`'s `if (inPage || mirrored) return`
drops it before the arrival count. That is the first of the three readings in `mirrorTerms.ts`'s header, and the other
two are ruled out **in these three attempts**. This is **commit-layer**, the layer §2 and §5 count, not the start layer of
§1 and §4.

**What it does not establish.** Nothing about the other 15 failing attempts, which predate the instrument and carry no
terms. Nothing about *why* the bus mirrors `hairline.html` at that moment; a reading, not checked, is that the native
pane's own redirect result is mirrored into the target, so the address is requested twice by design. Nothing about a
fix: `url === mirrorRequested` cannot tell two navigations to one address apart, so what does is a product choice
(initiator, navigation identity) for the owner. Each print was read from its raw log by Idris, Wren and Dogu, each
parsing it themselves (`#3213`, `#3215` for the first; `#3230`, `#3231` for the second; `#3255`, `#3256` for the third);
that re-reads three logs, it adds no sighting.

**Where this leaves the card.** Both events the `waiting:` line above names have now happened (`#540` merged; a failing
`:89` print was read, three times). That line's wording is the owner's and is **not changed in this PR**. Three prints, one
term, no counter-example, in three of fourteen attempts. Any later failure where a different term fires, or none, refutes
the reading above, and any later failure where `viaMirrorUrl` alone fires again supports it. No fix on a candidate,
however much stronger it has become.

## DECIDED AND FIXED 2026-10-04/05

**The decision, and whose it is.** I put the question to Opeyemi in my own session with my
recommendation attached, and he answered **go**: *when a page redirects itself to an address and the bus
starts a mirrored load of that same address a few tens of ms later, the page's commit **is** an arrival.*
He had also written *"I agree with @Wren"* in the room (`#3370`), which matches; the ruling recorded here
is the one he gave in session, on my recommendation, not an inference from the room line.

**I first asked him the question with the two events in the wrong order** — bus first, page second. Idris
caught it (`#3351`) from the instrument's own timestamps, Dogu confirmed them independently, Wren corrected
her own repetition of my wording. The order is the fix: **the page's navigation starts first** (48 ms, then
25 ms, then 25 ms ahead of the bus's mirrored start, across the three prints), and it is the one carrying
`byDocument: true`.

**What changed.** `isMirrorCommit` is gone from `TargetSource`; the decision is `isBusCommit` in
`src/shared/mirrorTerms.ts`, taken from the recorded terms:

    (viaMirrorUrl && !pageStartedFirst) || viaNotByDocument || viaBusDocument

`pageStartedFirst` is new and recorded beside the others: the page's own non-mirrored start for this
address began at or before the bus's mirrored one, and the commit is document-initiated. **A term that
decides without being printed would put the guard print back to describing less than it judges.**

**The duplication this removes was a stated limit that bit.** `tests/unit/mirrorTerms.test.ts` held a
**verbatim copy** of the private expression, and its own header warned: *"if the real expression changes
and this oracle does not, this test goes on passing."* The expression has now changed — a copy would have
gone on agreeing with itself. The test calls `isBusCommit` directly.

**The risk the fix had to avoid, and how it is pinned:** trading silent under-reporting for double
counting. Both commits land on the same address, so the bus's own must still be suppressed. Three cases
are tested from the opposite side — the bus's start first, the bus's load having no document initiator,
and the tie — and removing `byDocument` from the guard fails them.

**Sabotage:** reverting `&& !pageStartedFirst` fails three tests; dropping `byDocument` from
`pageStartedFirst` fails the double-count guard.

**What is still unmeasured here:** the end-to-end proof is `arrivals.spec.ts:89` passing on a run that
would previously have failed, and that failure is rare — the unit tests pin the decision, not the sighting.
The other 15 failing attempts predate the instrument and carry no terms, so nothing above speaks for them.

## THE FIRST FIX WAS WRONG IN TWO WAYS, AND IDRIS'S HARNESS FOUND BOTH (2026-10-05)

**She built the thing I had said was the real gap and had not built:** the **real `TargetSource`** under a
fake `electron`, with the page's start, the bus's `loadMirrored` and the commits emitted in forced orders
(`tests/unit/targetSourceMirror.test.ts`, her commit `cb2d0eb`, adopted here under her authorship).

**A — my fix double-counted, in the common case.** When the bus's own commit landed, `startFor(url)`
**skipped mirrored starts** and handed it the PAGE's start, so it reported `byDocument: true` and my
`pageStartedFirst` guard made it the page's too: **two arrivals for one redirect**, where `main` reports
one. **2 of the 3 instrument prints had two commits.** My own "the bus's load has no document initiator"
test fed `byDocument: false` by hand, so it never saw the case it was written for — the test agreed with
my model of the wiring rather than with the wiring.

**C and F — a regression I introduced.** `startTimes().own` took the newest non-mirrored start **with no
age bound and nothing consuming it**, over a 32-deep trace. So an earlier click to an address made a later
bus-only mirror of it look like the page moving — a false *"the page navigated after it loaded"*, the
`bug-arrivals` class the rule I replaced existed to prevent. `main` gets that case right.

### What the fix is now

**A start is answered once.** Each start carries `answered`; the commit that lands takes the **oldest
unanswered start for the address, the bus's own included**, and marks it. Commits answer starts in the
order the navigations began, which is what the prints show.

**An abort answers its start too.** `did-fail-load` on the main frame marks it, because no commit ever
will — without that, a cancelled page navigation leaves a start for a later mirror to be classified by
(her case F).

**`byDocument` therefore comes from the start the commit actually answers**, so the bus's commit stamps
through `viaNotByDocument` as it always did, and the page's commit is an arrival.

**Her eight cases pass.** Sabotage: removing the abort answer fails F; removing consumption at commit
fails A, A2, C and B2; restoring newest-non-mirrored matching fails A, A2, C and F.

**Measured: typecheck 0, build 0, unit 2006 passed / 1 skipped over 130 files.**

**Still unmeasured:** the live sighting. Her harness drives the real classification but models Chromium's
event order from the prints, and reads the consequence through a replica of `ipc.ts`'s counting rule
rather than the live closure. The e2e remains the only end-to-end proof, and it is rare.

## A THIRD DEFECT, FOUND BY REPLAYING THE REAL PRINT (2026-10-05)

**Idris replayed print 4 through the real class** — `main`'s retried `arrivals.spec.ts:218`, run
`37278055730` — and checked the replay was faithful by reproducing `main`'s own output (`mirroring: true`)
before judging anything. On `main` it reproduces the bug, on `69d02c0` it is fixed, **and on `491518c` the
redirect was suppressed again.**

**Cause (her case G):** `mirrorStart` read `this.starts.find(st => st.url === url && st.mirrored)` — the
**oldest** mirrored start of the address in the trace, answered or not. Print 4 has a mirrored `hairline`
start **677 ms before** the page's own redirect, so the time comparison came out false for a genuine
page-first redirect. **My eight-case harness could not see it**: not one of those cases has an older
mirrored start of the same address.

**The fix is to stop comparing times at all.** With consumption in place, *which start the commit answered*
already settles whose navigation it is, so the term is now:

    answeredOwnStart: byDocument && ownStartAt !== null

renamed from `pageStartedFirst`, because a term whose name claims an ordering it no longer tests is the
next reader's wrong turn. **This is also Idris's answer to the question I asked her** — whether that term
was doing less work than its comment claimed. It was, and the extra work it appeared to do was the defect.

**Sabotage:** reverting `&& !answeredOwnStart` fails five tests across both files.

**One lock I could not pin, named rather than left looking load-bearing:** `!start.mirrored` beside
`byDocument`. A mirrored start is never document-initiated, so `byDocument` already excludes it and
removing the clause passes all eight harness cases. It is kept for intent, and it is untested.

**Her residual risk was then demonstrated, so it is fixed rather than recorded.** She wrote it as a failing
case (H1b): a start that is neither committed nor `did-fail-load`ed — a redirect source, or a silent
supersede — stays unanswered, and the bus's later mirror of that address is classified by it. That is the
same regression shape this fix already had to undo once, so leaving it recorded would have been leaving a
known hole with a name.

**`did-stop-loading` retires every unanswered start.** Loading has stopped, so nothing is pending: a start
with no commit and no failure never gets one. H1b is red without it and green with it.

**What that does NOT establish, and the harness cannot:** that Chromium never fires `did-stop-loading`
between a start and its commit. The harness emits the events itself, so it can show the hole and show this
closes it; the ordering guarantee is not in evidence. Idris said the same of the one-line version she
tried.

## The fix landed on main 2026-10-05 as `d7942280b` — which does not close this card

(Heading deliberately not `MERGED`: the board guard refuses a closing heading on a card that is not Done,
and it was right to catch my first attempt at this edit. The fix is in; acceptance (d) is not.)

Idris's PASS at `d9f4533`; CI run `37284069660` counted: 461560 bytes, **1 `✘`** —
`live-capture-notes.spec.ts:183`, retry-rescued and already in `docs/e2e-flakes.md`, unrelated to this
change — 0 `error TS`.

**Then she measured the one thing the harness could not.** The code comment said that nothing establishes
Chromium never fires `did-stop-loading` between a start and its commit. She instrumented a scratch copy and
ran nine navigation-heavy specs through real Chromium, idle twice and under 24 CPU burners three times:
**2,914 events, 821 starts, 779 commits, 632 stops, 10 fails. Every commit matched an unanswered start, and
there were zero premature retirements.**

**Her own limits, kept because they are what make it evidence rather than proof:** `file://` fixtures, one
macOS machine, Electron 43.4.1, and a loaded laptop rather than a slow CI runner.

**And the retirement is not only an H1b fix.** 7 of 632 stops retired a start; all 7 were starts that never
commit, **two of them the page-first shape from the prints** — two `hairline.html` starts 1.9 ms apart, the
document-initiated one and one with no initiator, one commit, the stop clearing the leftover. In all 7 the
address was navigated again and committed, so without the line a stale start would have sat in front of
each of those later commits.

**What is still not measured, and the card closes saying so:** the bug itself did not reproduce locally —
**0 of 60 on `main`'s code and 0 of 60 on the fix**, fresh app per attempt, no retries. Nothing here is the
end-to-end sighting. What is proven is the mechanism: the classification, through the real class, against a
replay of a real print.

## THE DONE MOVE WAS PREMATURE, AND ACCEPTANCE (d) SAYS SO (2026-10-05)

Idris refused it (`#3442`) by checking this card's own `## Acceptance` list item by item, which is what a
Done move is gated for. **(a), (b) and (c) are met** — (b) and (c) by her sabotage, each failing a named
real test when the guard is loosened and passing unsabotaged. **(d) is not met and the PR did not claim it:**

> *`arrivals.spec.ts:89` passes on first attempt across a sweep, not on retry.*

**What exists is one counted CI attempt** (run `37284069660`, first try). The local sweeps say nothing —
**0 of 60 on `main`'s code and 0 of 60 on the fix** — which this card already recorded about its earlier
sweep: a silence that fits both "fixed" and "never fired" is not evidence either way.

**So the fix is merged and the card stays in Doing**, waiting on counted CI attempts rather than on anyone's
opinion. **The failure fires roughly one attempt in four on CI**, so a run of first-try passes is worth
`1 - 0.75^n`: **n = 10 is about 94%**, n = 16 about 99%. **I propose 10 counted attempts**, and that number
is a judgement about cost, not a measurement — a reviewer who wants 16 is not wrong.

**(e) is stale rather than wrong**, and is fixed in the same follow-up: `docs/e2e-flakes.md`'s
`arrivals.spec.ts:89` entry calls it *"a candidate correctness bug, not a test problem"*, which was right
when written and now understates what is known. Whoever reads it after the next failure should learn that a
failure now is a **regression**, not a fresh sighting.

## THE TALLY RULE, THE TEST'S NAME, AND WHO SETS N (2026-10-05)

Three corrections, all of them from the gate rather than from me.

**1. Two counting rules were running at once, which is worse than either.** I wrote *"one so far since the
fix"*, counting only `main` push suites; Idris counts **any full `ci.yml` suite whose tested tree contains
the fix, PR runs included** (`#3444`, `#3461`). **Hers governs from here**, and the card says so rather than
leaving a reader to pick: the question acceptance (d) asks is *"does this test pass on first attempt when
the fix is in the tree"*, and a PR suite answers it exactly as a push suite does. **The count by that rule was 8 of 8 at 12:30 WAT on
2026-10-05** — a number that moves, so it lives here and not in the `waiting:` line.

**The rule, written out so this card does not depend on reading three room messages:**

- **an attempt counts when its suite JOB finished.** A job killed at the 30-minute cap, or cancelled
  mid-run, counts as nothing — **the run's own stamp is irrelevant**, which is the part `#3444` left
  ambiguous and `#3468` settled;
- **the outcome is the FIRST attempt** of `arrivals.spec.ts:218`, read from the raw log. **A first-try `✘`
  is a failure even when retry #1 rescues it**, and it reopens this card;
- **each counted attempt is listed here by run id**, so the tally can be audited rather than believed. Mine was not wrong, it was narrower — and two live rules in one project
is the shape that produces a disagreement nobody can settle later.

**2. The test is not at `:89`.** It is `tests/e2e/arrivals.spec.ts:218`, *"a page that really does redirect
after loading still says so"* — the line number moved and this card kept citing the old one in five places,
including the `waiting:` line a reader is most likely to act on. **It is named by its title from here**,
because a title survives an edit above it and a line number does not. The older references below are left
as they were written: they were true when written, and rewriting history to look tidy is how a record stops
being one.

**3. N is Opeyemi's, not mine — and BOTH rates belong here, because the lane shows him the card and not
the chat.** The failure rate is not settled: this card's `1 in 4` gives **94% at n = 10 and 99% at 16**;
**Idris's measured rate from the 24 logs she holds is 1 in 6**, which gives **84% at 10 and 95% at 16**
(her table: 83.8 / 88.8 / 94.6 / 97.4 at n = 10 / 12 / 16 / 20). **A decision taken on the higher rate
alone would buy less confidence than it looks like buying**, so the number he is asked for should be read
against the lower one.

**And the `waiting:` line now says so in the form the lane reads.** It named
an event before, so it mentioned him without asking him, and the lane listed it under "waiting lines that
mention him and are not listed" — a question on his board that his board did not show him. I proposed 10 with the arithmetic (`1 - 0.75^n`: ~94% at 10, ~99% at 16)
and labelled it a judgement about cost. **It is still a judgement about cost, and that is his to make** —
it trades CI time against confidence in a class-1 fix, which is exactly the kind of call this project sends
to him. The card carries no N until he gives one; the tally runs regardless, so nothing is blocked while he
decides.

## The sweep was measuring the machine, and the N question should never have been asked (2026-10-05)

**Idris reproduced the first-try failure on demand** (`#3752`), which nobody had managed since the fix
landed, and it changes what this card can claim.

**What she ran, desk-safe, fresh app per run, `--retries=0`, the whole file:** idle **59 of 60 pass** (the
one failure a launch timeout in `beforeAll`, so neither test ran); under 16 burners **40 of 40 pass**; with
the target's renderer on the repo's own **`cpu-4x`** preset, **21 of 30 FAIL** with CI's error text word for
word. At `cpu-6x`, 1 of 30.

**The mechanism, from event timelines rather than a reading of the code:** `navigate` loads `redirect.html`
into both panes; the bus mirrors each pane's commit into the other; in **22 of 22** failing runs the bus's
`loadMirrored(hairline)` landed **1 ms after** the target committed `redirect.html` and **replaced the
document before its inline script ran** — a `console.log` placed before the `location.replace` is **absent
in all 22 failures and present in both passes**. So the target never redirected itself: there is **no
document-initiated start** (0 in every failing run, 1 in every passing one), and the landing commit is
stamped the bus's, **which is true of what happened in that pane**.

**Idle margin: 4 to 6 ms.** That is the whole premise of the test.

### What that does to acceptance (d), which is mine to own

**(d) asked for a sweep of a race.** A slower target renderer flips it, so the sweep measures the machine,
and **no value of N could have closed it** — which means the question I put to Opeyemi could not have done
what I told him it would. **It is withdrawn from his lane rather than left there to be answered.**

**The tally is not wasted and is not a gate — and the number I quoted was wrong.** I said *"10 of 10
first-try passes"*; the tally Idris keeps is **17 first-try passes and 1 first-try FAILURE over 18
attempts** (`#3740`; the failure is run `37346121793`). **10 of 10 was true before that run, and I repeated
it after.** Under the rule this card itself states, a first-try `✘` **reopens the card** — so the honest
reading is not "a clean sweep that cannot prove anything", it is **a sweep with a failure in it, which is
what prompted the diagnosis below.**

### The replacement for (d), which is QA's to set and is Idris's proposal

**A sweep of CI first-attempts cannot demonstrate a fix for a race this narrow. A throttle can**, because
it gives a control with a **known failing baseline**:

- the one-line variant passes **30 of 30 at `cpu-4x`** and **30 of 30 at `cpu-6x`** — against today's
  unfixed baseline of **13 of 20 failing** and **1 of 30**;
- **and** the unthrottled file still passes;
- **and** `arrivals.spec.ts:176`, the counter-case where the caller never asked the target to move and no
  note is correct, still passes.

**The reproduction, minimal, so this card does not depend on a scratch that will be swept.** In a copy of
`arrivals.spec.ts`, **one line** in the second test, between the 300 ms wait and `navigate(REDIRECT)`:

```ts
await call('setThrottle', { throttle: 'cpu-4x' })
```

Run the whole file (both tests, one shared app), fresh app per run, `--retries=0`. **Measured on `main`
`b5ef904`, desk-safe: 13 of 20 fail minimal, 21 of 30 instrumented, 1 of 30 at `cpu-6x`, and 99 of 100 pass
unthrottled** — the single unthrottled failure a launch timeout, not this. Every failure carries CI's error
text.

**What this is, in Idris's words and kept in them: a MODEL of the race** — a throttled renderer standing in
for CI's slower one — **not a reproduction of the CI cause.** The CI-side measurement is hers in `#3757`.

### The gap this exposed is a separate defect, and it is filed as one

The caller asked for `redirect.html`; the reply measures `hairline.html` **with no note**. `#558`'s class of
fix cannot reach it — **the guard answers "who made this commit", and the caller's question is "did I get
the page I asked for"**. Filed as its own card rather than reopening this one, because the stamping here is
correct and the fix for that gap is a product decision about what the reply must say.

## THE REPLACEMENT FOR (d) IS MET — measured on today's `main`, 280 runs (2026-10-06)

**I refused the cheaper route and this is why it was worth refusing.** Idris offered to copy `#584`'s
throttle table onto this card as "met" (`#3970`). Those numbers were measured on **`#584`'s pre-merge
tree**, and writing them here as the state of `main` is *a figure repeated past its source* — the error
this card already records me making twice. **So Idris re-measured on `main` `3dfd871b…`, and that measured
something the copy could not have:** the counter-case under throttle, which `#584`'s table never listed.

**The run: whole file, fresh app per run, `--retries=0`, one app at a time, desk-safe, 280 runs in 11
minutes.**

| cell | runs | clean |
| --- | --- | --- |
| `arrivals` at `cpu-4x` / `cpu-6x` | 30 + 30 | **60 of 60** |
| **counter-case `:184` throttled from test 1** at both rates | 30 + 30 | **60 of 60** |
| pool spec at `cpu-4x` / `cpu-6x` | 30 + 30 | **60 of 60** |
| unthrottled `arrivals` and pool (the originals) | 30 + 30 | **60 of 60** |
| **baseline: pre-`#584` arrivals, same line, `cpu-4x`** | 20 | **5** — the old twin **fails 15 of 20** |
| **baseline: pre-`#584` pool spec** | 20 | **9** — **fails 11 of 20** |

**The baseline is what makes this a control rather than a green tick:** all 15 old-arrivals failures carry
CI's own text — *"the reply carried NO notes at all"* — and all 11 old-pool failures carry
*"no document-initiated, non-mirrored start…"*. **The thing that used to fail still fails on today's
machine, and the fixed version does not.**

**What it does not say, in Idris's words and kept in them:** the throttle **models** CI's slower renderer and
does not measure it, so **none of this is a CI rate**; and `src/`, `tests/` and the build config being
byte-identical to `#584`'s head means this is *the same blobs measured again in a fresh session*, not an
independent implementation.

### What this card now waits on, which is me

**Acceptance (a), (b), (c) and (e) have not been re-checked on today's tree** — the control at
`ipc.ts:245`, the control for the mirrored case, and the register entry. Idris said plainly those were not
re-checked, and I am not going to let (d) being met read as the card being done. **That is my work, not
Idris's**, and the `waiting:` line says so.
