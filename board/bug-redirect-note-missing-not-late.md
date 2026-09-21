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

## Not yet established

- **which** of the two it is: a missing `starts` entry, an entry whose `initiator` is undefined, or
  the reverse-find matching the *other* navigation to the same url (the last is now the most likely,
  since it explains both directions with one mechanism and the others explain only one);
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
