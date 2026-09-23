---
title: "a page that redirects itself back to the address the pane already holds can go unreported, and it is not a timing race"
column: doing
owner: "Henry"
waiting: "Opeyemi: whether to spend ~3 CI suites on the sweep that qualifies #440"
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
