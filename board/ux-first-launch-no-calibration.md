---
title: "The first window never mentions the monitor diagonal, which the README calls the one number that makes Obsrv work"
column: backlog
kind: chore
criterion: A3
order: 64
---

FOUND BY HENRY 2026-09-17, in `a3`'s cold-machine run. **A product question, for Opeyemi.**

The README's Quickstart: *"Open it and set your monitor's diagonal in Settings — that one number is what
makes the target pane render at true physical size."* **The v0.60.0 app's first window on a fresh
machine says nothing about it** (run `35167885454`, screenshot in that run's `a3-app` artifact). What it
shows is an empty state, "Point Obsrv at a page to see it the way a 1x screen does.", a URL field with
an Open button, and the toolbar. The footer reads
`TARGET 1920×1080 landscape · fit ×0.42 · not pixel-exact · Reference (off) · 8-bit`. There's no prompt,
badge or hint that the render isn't yet at true size, and the only way to Settings is the gear icon.

A stranger who opens the app without reading the README gets a render at an assumed size and nothing
telling them so. Whether first launch should ask, hint, or stay quiet is a product decision.

**Seen in passing, and not a finding yet:** two URL inputs are visible at once, the address bar and the
empty state's field.
