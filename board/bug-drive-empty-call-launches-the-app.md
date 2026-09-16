---
title: "The one `obsrv_drive` call documented as read-only starts the application"
column: done
owner: "Henry"
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

## ENGINEERING HALF RESOLVED 2026-09-16 by Henry — the description says what the call does

**A correction to this card first.** It says `obsrv_drive` "does not say" it launches. **It did,
since `c521551`, which is in 0.60.0**, but only as the first sentence of its *last* paragraph, 2,444
characters into a 2,616-character description. The opening paragraph didn't say it. Earlier than that sentence, the clause
describing the empty call, *"none = just read the current state"*, read as the one safe call. So
the description contradicted itself, and the half an agent reads first was the wrong half.

**Re-observed on `main` (`58f4437`)**, as far as the harness allows. It never launches a real app
(`OBSRV_TEST=1`), so what can be seen is the path: `obsrv_drive {}` with no app answers the same
`no-display … OBSRV_TEST` error as `obsrv_drive { preset }`. The empty call resolves an app the way
every drive call does, rather than reading anything. Outside the harness that path launches.

**The fix, wording only; the behaviour is unchanged:**
- **The opening paragraph** now ends: *"If the app is not running, any call launches it first
  (`launched: true` on that call), including a call with no inputs."* That's where `snap`,
  `audit`, `lint` and `inspect` say it.
- **The empty-call clause** now reads *"none = read the current state, which still launches the app
  first if it is not running"*.
- **The last paragraph's** launch sentence is removed, now that it's said twice where it's read. Its
  `declined` sentence stays.

**Tests, in `mcp.spec.ts`:** a new test on the description (the opening paragraph and the clause
both say it, and "just read the current state" is gone), and the no-app test now also calls
`drive {}`. **Fix:** 3/3 with `tools/list`. **Control, `main`'s `server.ts`:** the description test
failed at the opening paragraph.

**Still open, and why the card stays in Doing:** whether an empty call *should* launch the app is
Opeyemi's decision. If it changes, this description changes with it.

## DONE 2026-09-16 by Henry: the behaviour stays, and the description already says so

**Opeyemi's answer to the card's open half:** "Keep launching". He gave it at about 20:30 WAT in
Wren's session, to the question Wren put to him for this card, and Wren relayed it verbatim. An empty
`obsrv_drive` call keeps launching the app when it isn't running.

**So no code change.** The engineering half above already made the description say what the call
does. On main, the `obsrv_drive` input description reads "none = read the current state, which still
launches the app first if it is not running", and the tests in `mcp.spec.ts` hold that wording.

