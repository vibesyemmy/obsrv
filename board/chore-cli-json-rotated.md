---
title: "The CLI's snap JSON has no `rotated`, which MCP replies derive; adding it needs Opeyemi's yes for cli.spec.ts"
column: backlog
kind: chore
criterion: C4
order: 76
---

FILED BY HENRY 2026-09-17, from `bug-orientation-name`'s amendment, which said this card would wait for the
authorisation rather than be pre-booked. It's filed now so the gap has a home when `bug-orientation-name`
closes. **It isn't authorised.**

MCP's `obsrv_snap` and `obsrv_drive` answer `rotated`, derived in the server. The CLI's snap JSON doesn't
carry it, because adding the key changes the contract `tests/e2e/cli.spec.ts:51` guards. **No session edits
that file without Opeyemi's explicit authorisation**, and this card waits on that.
