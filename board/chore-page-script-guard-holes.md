---
title: "The page-script guard catches a namespaced call and not a missing one, and the duplicated ancestor walk has no check"
column: done
kind: chore
owner: "Henry"
criterion: B2
order: 93
---

FILED BY HENRY 2026-09-17, out of Wren's read of `72e8d97` on `#293`, and carded rather than carried
in two session transcripts — a follow-up nobody wrote down is one the next person rediscovers by
breaking it.

**What happened first.** A page-side function is shipped as SOURCE and evaluated in a page, so every
name it calls must be defined beside it in the script it ships in. `#293` had the stuck-chrome probe
call the shared `shadowContains`; the bundler wrote `emptyDocument.shadowContains(el, anchor)`, a
namespace no page has, the probe threw, and every stuck bar went unfound. **Four `cli-snap-tiled`
tests caught it on CI** (run `35226322138`) — the browser tests could not, because they call the
function rather than the string it ships as. The fix gave the probe its own walk (`holdsAnchor`), and
added `tests/unit/pageScriptsAreSelfContained.test.ts`, which reads the built bundles and fails on a
dotted call to a page-side helper.

## The three things this card is for

1. **A bare call fails exactly the same way, and the guard passes it.** A page function calling a
   sibling in its own module compiles to a bare call; if that sibling is not in the `*_SCRIPT`
   concatenation, the page throws as it did here. Adding a helper to `scrollHost.ts`, calling it from
   `findScroller`, and forgetting the `.toString()` line is one edit away. **It is now the likelier
   of the two**, since the import shape is the one `#293` designed out.
2. **The exclusion list is a hole.** The scan reads whole bundles, so `t.inspectTarget(...)` from
   main is indistinguishable from a script reaching through a namespace, and five names had to be
   excluded — which means a genuine dotted call to one of those five *inside a shipped script*
   passes.
3. **`holdsAnchor` duplicates `shadowContains` with nothing checking they agree.** Wren read them
   line by line and they match today; the risk is an edit to one and not the other, and without an
   arm the duplication is a comment rather than a check.

## What closes them, and it needs no exclusions

**Check the script strings themselves.** Import `SCROLL_HOST_SCRIPT`, `SHADOW_TREE_SCRIPT`,
`WALK_STEP_SCRIPT`, `INSPECT_SCRIPT`, `LINT_SCRIPT`, `AUDIT_SCRIPT` and `STUCK_CHROME_SCRIPT` in a
unit test and require that every identifier each one calls is declared inside that string or is a
browser global. A missing `.toString()` fails it; a namespace call fails it; `t.lintPage(...)` in
main is in no string, so it never comes up.

**Keep the built-bundle check beside it.** The dotted case is a property of the build, and only the
build can show it.

**And the agreement arm:** walk the existing `shadowTree` fixtures and assert `holdsAnchor` and
`shadowContains` answer the same for every pair.

**Method, stated before the work:** the globals allowlist is **grown by running it** against the
seven strings, not guessed. If the first run flags something real — a helper already missing from a
concatenation — that is item 1 arriving early, and it goes on this card with the run that found it.

## DONE 2026-09-18 by Henry — all three, and the allowlist was grown by running it

**1. The bare-call hole is closed, with no exclusion list at all.**
`tests/unit/pageScriptsAreWhole.test.ts` takes each of the seven `*_SCRIPT` strings and requires every
name it calls to be declared inside that same string or to be a browser global. `t.lintPage(...)` never
comes up, because it is in none of these strings — which is the whole reason this reads the **strings**
and the older guard reads the **bundle**. Both stay: completeness is a property of the string, and
namespacing is a property of the build.

**Control, inside the test:** an arm removes `shadowParent` from the concatenation and requires the
check to name it. Without that, a regex that matched nothing would pass and nobody would know.

**2. The built-bundle check is untouched**, for the dotted case only the build can show.

**3. The agreement arm exists** (`tests/browser/shadowTree.test.ts`): `holdsAnchor` and
`shadowContains` are compared over 64 pairs across slots, hosts and plain parents, plus a closed root.
`holdsAnchor` is **extracted from `STUCK_CHROME_SCRIPT` rather than imported**, because it is a local
inside `installStuckChrome` and the shipped string is the thing that has to be right. An arm asserts
the extraction worked, so a regex that stopped matching cannot turn this into a silent pass.

**Control:** dropping the `assignedSlot` step from `holdsAnchor` reds it with the pairs named —
`DIV.frame / SPAN.-: shared=true stuck=false` and `SLOT.- / SPAN.-` — then restored, 15 of 15 green.

### The method the card set, and what running it actually found

The card said the globals allowlist would be **grown by running it, not guessed**. It was, and the
first run returned five names that were not globals at all:

- **`hide`, `mark`, `restore`, `settle`** — object-method shorthand on what `installStuckChrome`
  returns. Definitions that a regex reads as calls. **The parser was wrong, not the code**, and
  allowlisting them would have hidden a real missing helper of the same name later.
- **`not`** — from `input:not([type="hidden"])` in the audit's selector. Inside a **string literal**.
  Adding `not` to the globals would have made the test pass and made it wrong, and the next selector
  with a function-shaped word would have done it again. The scanner now blanks strings and comments
  before reading, which is the general fix rather than the local one.

**So the four that were genuinely globals — `DOMRect`, `Image`, `URL`, `setTimeout` — are the only
names on that list that running it added.** The card's instruction was the reason the other five were
investigated rather than pasted in.

**Item 1 did not arrive early:** no script is missing a helper today. The check exists for the next
edit, not for a defect it found.
