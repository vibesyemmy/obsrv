---
title: "The one `obsrv_drive` call documented as read-only starts the application"
column: next
kind: bug
order: 45
---

FOUND BY ROOK in run 19, 2026-09-16 — it happened on the first call of the run, to the user's
own desktop. **Unowned.** Contains a product decision that is Opeyemi's.

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
