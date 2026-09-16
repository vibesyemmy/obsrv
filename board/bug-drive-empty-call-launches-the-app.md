---
title: "The one `obsrv_drive` call documented as read-only starts the application"
column: doing
owner: "Henry"
waiting: ""
kind: bug
order: 45
---

FOUND BY ROOK in run 19, 2026-09-16 — it happened on the first call of the run, to the user's
own desktop. **Unowned.** Contains a product decision that is Opeyemi's.

**Surface observed**, added 2026-09-16 by Henry on Rook's own catch: the `obsrv` MCP tools in this
repo run the package pinned in `.mcp.json`, `getobsrv@0.60.0` (tag `v0.60.0`, `31b77e8`), not `main`
or a local build. **So this was observed on the 0.60.0 release.** **Expected to hold on `main`, by
diff and not by observation:** between `v0.60.0` and `main` at `3552349`, the only changed lines in
`src/mcp/server.ts` or `src/mcp/lib.ts` matching `launch`, `launched` or *"just read the current
state"* are two code comments. The diff over those files is not empty, the pattern matches `main`'s
source, and the same method finds #49's routing change, so the result is not a blind search. It is
still a reading, not an observation: behaviour can change through lines that do not use these words.
**Re-observe on a local build before fixing.**

## What happened

`obsrv_drive` with no arguments — documented as *"Only the supplied inputs run (none = just read
the current state)"* — returned `launched: true`. **It started Obsrv on the user's desk.**

`obsrv_snap`, `obsrv_audit`, `obsrv_lint` and `obsrv_inspect` each say in their own description
that they launch the app if it is not running. **`obsrv_drive` does not say it** — and it is the
call an agent reaches for first, precisely because it reads as the safe one.

## Two halves, and they belong to different people

- **Product, Opeyemi's:** should an empty `drive` call launch at all? An argument each way. It
  is the natural "what is the app doing?" call, and answering it by starting the app is a
  surprising amount of action for a question. Against: every other tool launches, and a drive
  call with no app is otherwise useless.
- **Engineering:** whatever is decided, **the description must say what the call does.** Today it
  promises a read and performs a launch. That sentence is wrong either way.

## The cheap half, if the behaviour stays

The reply already carries `launched`, so an agent *can* know after the fact. What it cannot do
is know beforehand from the tool description — which is the surface an agent reads when deciding
whether a call is safe to make against a window somebody is working in.
