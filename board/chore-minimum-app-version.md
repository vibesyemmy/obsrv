---
title: "Three sentences exist only for an app older than the tree: one decision, when a minimum version is set"
column: backlog
kind: chore
criterion: C5
order: 79
---

FILED BY HENRY 2026-09-17 out of `c5`'s inventory, on Wren's read: three producers share one
question, so the question gets somewhere to land rather than three card entries.

**The three, and the skew each needs:**

| producer | the sentence | reachable when |
| --- | --- | --- |
| `src/mcp/walk.ts:41` | the app predates page-wise scrolling (0.41.0); measured without walking | an installed app older than 0.41.0 |
| `src/shared/walkCoverage.ts:194` | content in an iframe, in a shadow root, or in a container that scrolls by transform … was not brought into view | the app sends no `blocked` field, which shipped in `82884e1` (0.58.0) |
| `src/mcp/server.ts:1092` | this app is older than the capture's settle verdict, so `settled` reports whether the navigation was confirmed | the app sends no settle verdict (pre-0.34.0 behaviour, per the register) |

**None can be produced by the suite**, which builds one tree, and **none should be faked**: a stub of
a version we no longer ship asserts our belief about what it sent, so a wrong belief is a green test
over a broken field. They are recorded in `docs/note-inventory.md` as named reasons.

**Why they exist at all:** the npm package updates ahead of the installed app, which the register
already documents for `colorPainted` ("a 0.61.0 server driving a 0.60.0 app"). That skew is real, so
the sentences are not dead code.

## The decision this card exists for

**When someone sets a minimum supported app version, these three are the first thing to re-read.**
Each is either kept (the skew is still possible), removed with the compatibility note that replaces
it, or replaced by one sentence that names the version rather than the symptom.

**Not a decision to take on its own**, and deliberately not taken here: a minimum version is a product
line, not a tidy-up, and the right moment is when one is being set for another reason.

**What would make it urgent:** a fourth sentence joining the group, or a report from the field where
one of the three fired and read as nonsense to whoever saw it.

## TWO MORE JOINED, 2026-09-17 — which this card names as its own trigger

`#293` made the measurement enter open shadow roots. Two sentences in `walkCoverage.ts` are now
reachable only from an app between 0.58.0 and that change, driven by a newer MCP:

| producer | the sentence | reachable when |
| --- | --- | --- |
| `src/shared/walkCoverage.ts:184` | the page has N open shadow roots, which the walk does not enter, and nothing in the light DOM scrolls | an app whose walk counted open roots instead of entering them |
| `src/shared/walkCoverage.ts:210` | no iframe covers the viewport and the page has no open shadow roots, so what scrolls is a container that scrolls by transform | the same app, on a page with no frame over it |

**Both are kept deliberately, and tested.** `mcp/walk.ts`'s parser tells the two walks apart by the
**absence** of `shadowHosts` — an app that entered the roots sends `frames` alone — and
`tests/unit/mcpWalk.test.ts` pins that in both directions, with a control that normalising the
missing count to zero reds it. So the older app still reads its own walk's words, which is the point.

**This card's own words: "What would make it urgent: a fourth sentence joining the group."** The
group was three. It is five. The decision is unchanged in shape — set a minimum supported app
version, then re-read all five — and it is Opeyemi's, not engineering's.

## DECIDED BY OPEYEMI 2026-09-30 — the floor is **0.58.0**, and below it the tools refuse

Asked which of three shapes he wanted — refuse the call naming the version, warn once and proceed, or
keep today's per-site degradation — he answered: **"set the floor at 0.58.0 and refuse below it."**

**Why 0.58.0 was the number recommended**, so the reasoning is on the card rather than in a room: it is
the version that shipped the `blocked` field (`82884e1`), and it retires **three of the five** sentences
outright — the two that need an app older than 0.34.0 and 0.41.0 cannot be reached at all once 0.58.0 is
the minimum, and the `blocked` sentence's own condition is *"the app sends no `blocked` field"*, which is
precisely what a sub-0.58.0 app is.

**Two survive and are correct to keep:** `walkCoverage.ts:184` and `:210` describe an app **between**
0.58.0 and the walk that enters open shadow roots, which is inside the supported range. They are not
compatibility debt; they are what a supported older app is owed.

**And the count had already grown again before the decision.** 0.63.1 added `editable` / `inputType` /
`disabled` / `readOnly` as optional fields *"absent from an app older than the field"*, and a `type`
step against such an app refuses. That is a sixth sentence of the same family, filed the same night —
the card's stated trigger was a fourth.

### What "refuse" has to mean, for whoever builds it

- **The refusal names both versions** — the app's and the minimum — so the reader knows it is an upgrade
  rather than a broken selector, argument or page. A sentence that says only "unsupported" sends them
  hunting.
- **It refuses rather than falling back to headless.** Headless is a different measurement, and silently
  taking it is the substitution this whole card exists to stop; `obsrv_snap` degrading quietly would
  hide exactly the skew the floor is there to surface.
- **The check costs no extra round trip where a `status` is already read**, which is most of the live
  entries.
- **The three retired sentences come out in the same change**, with the register entry naming the floor
  as the reason — otherwise the code keeps the words for a case the tools no longer accept.

