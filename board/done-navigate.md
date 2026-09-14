---
title: "The toolbar's navigate answers within a budget"
column: done
kind: bug
owner: "obsrv-a6"
order: 34
---

Commit 630ebe6. IPC.navigate returned the unbounded navigateBoth; the address field never synced on a page that never finishes loading.
