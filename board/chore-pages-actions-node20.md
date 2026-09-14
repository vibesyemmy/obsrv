---
title: "The Pages job's actions are a major behind and running on borrowed time"
column: done
kind: chore
order: 34
---

DONE 2026-09-14, same evening, on Opeyemi's word. Bumped in e921b64:

    configure-pages        v5 -> v6    release notes say "upgrade to node 24"
    upload-pages-artifact  v3 -> v5    moves to upload-artifact v7, the transitively-flagged one
    deploy-pages           v4 -> v5

Release notes read before bumping rather than trusting version numbers: none of the three changes an input this workflow passes.

**CLOSED ON THE EVIDENCE THE CARD ASKED FOR, not on a green run.** The card said done means the annotation is GONE FROM A RUN, because a green deploy fits both "the deprecation is cleared" and "forcing still works and it was green before too". So the annotations were queried directly, and — this is the part that makes it evidence — the same query was run against the PREVIOUS run first, to prove it can find one:

    run 34887702706 (v5/v4/v3)   1 annotation: "Node.js 20 is deprecated... forced to run on Node.js 24"
    run 34887893056 (v6/v5/v5)   0 annotations

A zero from a query nobody has watched return non-zero is not evidence of absence. The control is what turns it into one. `gh run view | grep -i ANNOTATION` had already returned nothing on BOTH runs, which would have been a false negative had it been trusted.

ONE THING FOUND WHILE VERIFYING, and worth keeping rather than filing: **GitHub Pages caches.** Immediately after the deploy the live page still read `main @ c40a297`, 51 cards; with a cache-buster it read `main @ e921b64`, 52 cards. Nothing was wrong with the deploy.

That is the stamp earning its place. A cached copy shows an OLDER COMMIT IN ITS OWN STAMP, so a reader can see it is behind instead of trusting a page that looks current. Had the page carried no provenance, a cached view would be indistinguishable from a fresh one — which is the entire failure this board was restructured to remove, arriving one layer further out in the CDN.

Raised 2026-09-14, from an annotation on the very first Pages deploy (`Board on Pages`, run 34887222584 — green, with this warning):

    Node.js 20 is deprecated. The following actions target Node.js 20 but are
    being forced to run on Node.js 24: actions/configure-pages@v5,
    actions/deploy-pages@v4, actions/upload-artifact@v4.
    https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/

**It works today and that is exactly the problem worth naming.** The runner is already *forcing* these onto Node 24 rather than refusing them, so the deploy is green on a compatibility shim rather than on support. The changelog is dated September 2025 — a year old. Forcing is the step before removal, and when it is removed the failure lands on the job that publishes the public board.

`actions/upload-artifact@v4` is not named directly in `pages.yml`; it comes in transitively through `actions/upload-pages-artifact@v3`.

**Every one has a newer major, measured rather than assumed** (`gh api repos/<r>/releases/latest`, 2026-09-14):

    used in pages.yml                    latest
    actions/configure-pages@v5      ->   v6.0.0   (2026-03-25)
    actions/deploy-pages@v4         ->   v5.0.1   (2026-09-01)
    actions/upload-pages-artifact@v3 ->  v5.0.0   (2026-04-10)
    actions/upload-artifact (transitive) v7.0.1   (2026-04-10)

So the change itself is three lines in `.github/workflows/pages.yml`.

**What is NOT established, and must not be assumed by whoever takes this:** that the newer majors run on Node 24. A version number is not evidence; the annotation is. The card is done when a deploy runs on the bumped versions and the Node 20 annotation is *gone from that run* — not when the numbers look newer. This project has spent a day on checks whose pass fitted two facts, and "I bumped it and CI was green" fits both "the deprecation is cleared" and "it was green before too, because forcing still works".

Note that the rest of the repo is current — `ci.yml` uses `actions/checkout@v7` and `actions/setup-node@v7`, and neither was flagged. Only the Pages job is behind, because it was written today against the versions in GitHub's own quickstart.

Low urgency, non-zero cost of ignoring: the thing that breaks is the public board's deploy, and it will break on a runner image change nobody here controls or is warned about beyond this annotation.
