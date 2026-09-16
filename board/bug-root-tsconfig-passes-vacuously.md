---
title: "`tsc -p tsconfig.json` checks nothing and exits 0, so the obvious typecheck command always passes"
column: done
kind: bug
owner: "Kenya"
order: 61
---

FOUND BY ROOK 2026-09-17, after a missing import passed my "typecheck" and then failed 46 unit
tests at runtime. **Done by Kenya 2026-09-17.**

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

## RESOLVED 2026-09-17 by Kenya — option 2 is impossible, measured; option 1 is done and guarded

**Option 2, "make it refuse", has no hook, and that is now measured rather than assumed.** Both
candidate shapes exit 0 with no output:

    { "files": [],   "references": [...] }   →  tsc --noEmit -p tsconfig.json   exit 0, 0 lines
    { "include": [], "references": [...] }   →  tsc --noEmit -p tsconfig.json   exit 0, 0 lines

**One correction to the card's own reading.** It says even `tsc --build` from the root would miss
`mcp` and `tests`. Half right: `--build` follows the references it has, so on `main` it **did** catch
an error in `src/main` (exit 1) and **missed** one in `src/mcp` (exit 0). The gap was the two missing
references, not `--build`.

**Option 1, as the references half rather than the include half.** A root `include` was rejected on
measurement, not taste: `tsconfig.mcp.json` deliberately has **no DOM lib**, so a union root would
silently allow `document` in the MCP server. The four projects have four different `lib`/`types`
sets, and one root config would have to weaken all of them to the loosest.

So: the root references all four projects, and `npm run typecheck` is now **`tsc --build
tsconfig.json`** — one command, complete, and the one CI already runs.

**The card's control, in both projects that were invisible to it:**

    break src/mcp   →  npm run typecheck  exit 1   (6 errors)
    break tests/    →  npm run typecheck  exit 2   (23 errors)
    restored        →  exit 0

**And a guard, because a fix that relies on someone remembering is the shape this card is about.**
`tests/unit/tsconfigReferences.test.ts` fails if a `tsconfig.*.json` is not referenced, if the root
gains an `include` (which would quietly undo the reasoning above), or if `typecheck` goes back to a
per-project list that can omit one. Its own controls: dropping the `mcp` reference turns it red, and
so does reverting the script.

**What is NOT fixed, and cannot be:** `tsc --noEmit -p tsconfig.json` still exits 0 having checked
nothing. Anyone who types it gets the same worthless green. The file now says so in a comment at the
top, which is the weakest part of this fix and worth knowing about rather than discovering.

### Correction from Henry's read: `--build` emits, and a typecheck must not

`tsconfig.mcp.json` has an `outDir` and no `noEmit` of its own, because `build:mcp` needs to emit. So
the first version of this fix made `npm run typecheck` **rewrite `out/mcp/server.js`** — the file a
dev lane and `publicShape.test` spawn. Measured by planting a 2020 mtime on it and running the
command: it came back as now.

`tsc --build tsconfig.json --noEmit` fixes it, and each arm was re-run: clean tree exit 0 with the
planted mtime **untouched**, and breaking `src/mcp` still exit 1 with 6 errors. The guard now pins
`--noEmit` as well, so the emit cannot come back: dropping the flag turns it red.

**A command named for having no side effects had one**, which is the same family as the rest of this
card — and it was found by a reader who went and looked at the file's mtime rather than at the diff.

**Verified:** unit 1402/1402 across 89 files, typecheck exit 0 and emitting nothing, guard 3/3 with
all three controls red.
