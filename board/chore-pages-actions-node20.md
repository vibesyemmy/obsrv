---
title: "The Pages job's actions are a major behind and running on borrowed time"
column: next
kind: chore
order: 34
---

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
