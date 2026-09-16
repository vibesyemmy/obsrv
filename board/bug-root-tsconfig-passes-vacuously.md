---
title: "`tsc -p tsconfig.json` checks nothing and exits 0, so the obvious typecheck command always passes"
column: doing
kind: bug
owner: "Kenya"
waiting: ""
order: 61
---

FOUND BY ROOK 2026-09-17, after a missing import passed my "typecheck" and then failed 46 unit
tests at runtime. **CLAIMED BY KENYA 2026-09-17** on Wren's routing — the same ground as `bug-typecheck-covers-no-test-file`, whose TS2304 control this card reuses.

## What happens

`tsconfig.json` is a solution-style root:

```json
{ "files": [], "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }] }
```

`files: []` with no `include` means **zero files**. So:

    tsc --noEmit -p tsconfig.json     → checks nothing, prints nothing, exits 0

It is not broken as a solution root — that is what a solution root looks like, and `tsc --build`
would follow the references. **But the natural command to type is `tsc -p tsconfig.json`**, it looks
like it worked, and it is the fastest-passing check in the repo precisely because it does nothing.

The real command is `npm run typecheck`, which runs the four project configs by hand:

    tsc --noEmit -p tsconfig.node.json && … web … && … mcp … && … tests

Note that `tsconfig.mcp.json` and `tsconfig.tests.json` are **not** in the root's `references` at
all, so even `tsc --build` from the root would miss them.

## How it was found, since that is the part worth copying

Not by reading the config. I added a call to `resolveRotate` in `src/cli/args.ts` and **forgot the
import**, ran `tsc --noEmit -p tsconfig.json`, got a clean exit, and reported "typecheck ok". The
unit suite then failed 46 tests with `ReferenceError: resolveRotate is not defined`.

Running `npm run typecheck` immediately found seven further real errors — strict-null violations in
code I had just written and called checked.

**The tell was there all along and I read it as speed:** that command always returned instantly and
had never once complained, across a day of edits to a dozen files. A check that has never objected to
anything is not a fast check.

## Why it belongs on the board rather than in one person's habits

Every "typecheck clean" anyone reports from that command is worth nothing, and nothing says so. It is
the same shape as `bug-typecheck-covers-no-test-file` — which is **done**, and whose fix is why the
strict-null errors above were catchable at all — one level further out: that card was about a config
that covered too little, this is about a config that covers *nothing* while looking like the main one.

## What a fix has to decide

1. **Make the root config do the obvious thing** — give it the same `include` the real check covers,
   or add `mcp` and `tests` to `references` so `tsc --build` at the root is complete. Then the natural
   command is also the right one.
2. **Or make it refuse**: a root that cannot be used directly could say so, though TypeScript gives no
   clean hook for that.
3. **Or leave it and document** — the weakest, and the one the evidence argues against, since the
   thing that failed here was a person reading a green, not a person reading a doc.

**The control, and it is the whole point:** delete an import somewhere in `src/`, and the chosen fix
must go red. If it stays green, the fix changed which files are listed without changing what is
checked.
