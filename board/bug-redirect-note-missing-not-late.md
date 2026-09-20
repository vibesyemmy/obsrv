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

## Not yet established

- **which** of the two it is: a missing `starts` entry, or an entry whose `initiator` is undefined;
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
- `arrivals.spec.ts:89` passes on first attempt across a sweep, not on retry;
- the `docs/e2e-flakes.md` entry is updated to say it was a bug and not a flake.

## Why the register was wrong, kept deliberately

The entry sized a fix from one sighting, and "reasoned, not run" was on it honestly. The fix was then
applied on recurrence and **its own run refuted it within the hour**. The register is still worth
keeping — but a sized fix in it is a hypothesis, not a decision, and this is the case that shows the
difference.
