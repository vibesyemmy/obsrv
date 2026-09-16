---
title: "A mirrored redirect's second commit can still be counted as an arrival"
column: doing
kind: bug
owner: "Kenya"
waiting: ""
criterion: B2
order: 23
---

CLAIMED BY KENYA 2026-09-16 on Wren's routing, pulled from Backlog: it is the ground
`bug-sync138-no-url-changed` and `sync-mirror-mark:41` sit on — a redirect's two commits, 13 ms
apart — and the native-pane load trace from #129 reads that pane from the other side.

**The card records what was deferred, not what was observed, so the first day's work is to
reproduce it.** If it does not reproduce, that is the answer and it is written down as one.

Deferred 2026-09-14 in commit 7d811f8. Two causes race for that commit; when it lands unmarked the arrivals counter counts it, so the spurious 'navigated after it loaded' note can fire on a redirect.
