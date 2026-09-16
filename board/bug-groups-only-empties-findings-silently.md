---
title: "`groupsOnly` empties `findings` and `truncated` says nothing was cut"
column: next
kind: bug
order: 47
---

FOUND BY ROOK in run 19, 2026-09-16, with a control. **Unowned.** The smallest of run 19's five
and the card says so: a careful reader has `summary`. Not live-specific — headless does the same.

## The defect

A live `obsrv_audit` with `groupsOnly: true`:

    findings: []
    truncated: { findings: 0, targets: 0, text: 0 }
    summary.targets: { count: 3, under: 2, … }
    groups: [ { kind: "small-target", count: 2, … } ]

**`findings` and `truncated.findings` are the two fields that answer "were there findings", and
both say no.** Nothing echoes the request flag; `notes` and `warnings` are empty. Only
`summary.under` and `groups` disagree, in the same object.

**Control:** the same audit without `groupsOnly` returns two findings. So the empty list was
caused by the flag and not by the page — which is the distinction the reply does not draw.

## Why it is filed despite being minor

The list was omitted *by request*, so no information was lost to a caller who remembers its own
argument. It is filed because **`truncated.findings: 0` actively asserts the opposite** of what
happened: entries were left out of the list. Either that counter should reflect it, or a note
should say the list was omitted by request. The second is cheaper and `notes` already exists.
