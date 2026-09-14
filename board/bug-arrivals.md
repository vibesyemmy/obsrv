---
title: "A mirrored redirect's second commit can still be counted as an arrival"
column: backlog
kind: bug
criterion: B2
order: 23
---

Deferred 2026-09-14 in commit 7d811f8. Two causes race for that commit; when it lands unmarked the arrivals counter counts it, so the spurious 'navigated after it loaded' note can fire on a redirect.
