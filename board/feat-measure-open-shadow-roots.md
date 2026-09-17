---
title: "Measure inside open shadow roots: audit, lint, inspect and the walk stop at the shadow boundary today"
column: done
owner: "Henry"
kind: feat
criterion: B2
order: 77
---

FILED BY HENRY 2026-09-17 with `b2`'s decision to enter open shadow roots by default, with no flag. The
evidence is on `b2`: caniuse.com at 79% unmeasured (188 of 238 text elements in 57 roots), and chromestatus.com
entirely inside 159 hosts.

**Scope, one traversal for every surface.** `src/shared` holds the page-side code the CLI, headless MCP and
the live app all run, so each item below is one change, not three:
- **Collection:** audit targets and text, and lint's elements, descend into `el.shadowRoot` when it is open.
  Slotted light-DOM nodes are already collected where they sit, so a `<slot>` must not count them twice.
- **Ancestors across the boundary:** the contrast background walk and anything else climbing ancestors uses
  the composed parent (`assignedSlot`, else `parentElement`, else the root's `host`), so text inside a
  component composites onto the backgrounds it actually sits on.
- **Hit-testing:** inspect's `at` descends through `shadowRoot.elementFromPoint` from the host
  `document.elementFromPoint` returns. `selector` keeps light-DOM semantics unless a piercing form is added
  deliberately; say so either way.
- **The walk:** scroll-host detection currently looks at the light DOM (`walkNothingNote` says "in its light
  DOM"). It includes scrollers inside open roots.
- **The share note:** retires for open roots, since what it declared is now measured. Closed roots stay
  unreachable, and aren't detectable from script either.
- **Register:** figures grow on component-built pages. That's a measurement change callers should be told
  about, even though the published shape doesn't move.

**Acceptance, each with a control:**
- `tests/fixtures/half-in-shadow.html` (12 light-DOM buttons, and more inside open roots, 10 per component)
  measures every button, and reverting the traversal takes it back to 12. Count the components when writing
  the arm, not from this line;
- text inside a component on a dark component background gets that background's contrast, not the page's;
- `inspect` at a point inside a component names the component's element, not the host;
- a scroller inside an open root is walked;
- a live check on caniuse.com and chromestatus.com, reading the figures against a second browser.

## Claimed by Rook 2026-09-17, pulled by Wren — step one only, and the arms are already red on CI

Pulled from Backlog in a sweep rather than picked. **Scope is step one:** the acceptance fixture and
the arms as tests that fail on current main, each with a light-DOM twin that passes. **No traversal
code until Henry's go and Opeyemi's review of `b2`.**

**On Henry's terms (#388), taken as decided:** the arms live on a branch, `test/open-shadow-arms`,
not as `test.fail()` in the suite — `test.fail()` passes on *any* failure, so a gating arm would
stay green whether or not it still checked anything. Each red is read at its own assertion on a
throwaway dispatch-only workflow (`probe/shadow-arms-red`, never merged) running just the new spec and
the two that pin the shared fixture. Minutes, not a suite.

### Two fixtures, because the one the card names is pinned

`half-in-shadow.html` carries arm 1 exactly as the card says — and **`cli-audit.spec.ts:299-303`
pins it today** at `targets.count === 12` with the share note's exact wording, and `surface-parity`
uses it too. Its "reverting takes it back to 12" is precisely those assertions. So it is untouched,
and arms 2–4 got a second pair: `shadow-arms.html` (a dark component background with light text, a
point to hit-test, the page's only scroller, and a hairline — each inside an open root) and
`shadow-arms-flat.html`, the same markup and styles with the roots flattened. **The twin is the
control, in the same job:** a red on the shadow page is then about the boundary and not the harness.

The one coordinate, `(60, 106)`, was measured in a real Chromium at 1366×768 rather than computed —
a first cut had `y = 84` and forgot the `<p>`'s default margin, which would have made the inspect
twin hit the card's padding and read as a harness fault. Hosts are `display: block` in both pages,
since a custom element is inline by default and the twin's hosts are divs.

### First probe read — `35193028970`

| arm | expected | **received** | own assertion | twin |
| --- | --- | --- | --- | --- |
| 1 · audit, `half-in-shadow.html` | 52 | **12** | `:70` | `cli-audit.spec:299` (green) |
| 3 · inspect at a point names the element | `inner` | **`card`** — `x-card#card`, the host | `:100` | green |
| 2 · contrast reads the component background | `#1f2937` | **`#ffffff`** — the page | `:109` | green |
| 4 · the walk finds the scroller | > 0 screenfuls | **0** | `:127` | green |
| 1 · lint, hairline inside the root | ≥ 1 | 0 | `:76` | **red — 0** |

**Arm 4's received value is the product naming its own gap**, and it goes here verbatim because it is
what turns this card from a feature request into a measured one:

> this page hides the document's overflow and has no scrollable container in its light DOM, so the
> walk had nothing to scroll: the page has 2 open shadow roots, which the walk does not enter

**The lint arm is not evidence yet, and the twins are what said so.** Its light-DOM twin was also
red with 0, so that red was about the fixture, not the boundary — the case the twins exist to catch,
caught on the first run. The rule had `height: 0`; `lint.html`'s proven hairline has `height: 20px`.
Matched, and the twin's failure message now carries the whole lint summary so a second red says what
lint *saw*. Re-run: `35193679588`.

**Not claimed, and this stays on the card whatever the re-run says:** that the height was the
cause. A green after one change is consistent with two causes, and the second is real — Chromium
reports a 0.5px border as `1px` in a normal window, yet `cli-lint.spec` finds hairlines under the
CLI's offscreen window with the same border, so that path reports differently. I could not run the
CLI locally to see which (`cli-*` is CI-only). One green does not choose between them.

**For the note arms still to be written** (the share note retiring for open roots, `walkNothingNote`
going quiet): assert the **whole sentence**, not a phrase — Henry's #393. A phrase match is how a
note gets reworded into meaninglessness while its test stays green. The existing
`cli-audit.spec:302` pins the share note by phrase; when it changes with the feature, that is the
moment to pin the sentence.

**Not done, and out of scope for step one:** the live check on caniuse.com and chromestatus.com
against a second browser, and any product code.

## Probe 4, 2026-09-17: all five arms red on their own assertions, and every twin green

Recorded by Henry while Rook's session was away, relayed by Wren and **read from the run's own log
rather than from the relay**. Run [`35194464896`](https://github.com/vibesyemmy/obsrv/actions/runs/35194464896),
`probe/shadow-arms-red` at `b11de03`: **5 failed, 33 passed, 3.3 minutes.**

| arm | assertion | expected | **received** |
| --- | --- | --- | --- |
| 1 · audit on `half-in-shadow.html` | `:70` | 52 | **12** — *"audit stopped at the shadow boundary"* |
| 1 · lint finds the hairline in the card | `:76` | ≥ 1 | **0** — *"lint stopped at the shadow boundary"* |
| 3 · inspect names the element under the point | `:104` | `inner` | **`card`** — *"inspect stopped at the host: x-card#card"* |
| 2 · contrast against the component background | `:113` | `#1f2937` | **`#ffffff`** — *"contrast read against the page, not the card"* |
| 4 · the walk reaches a scroller inside a root | `:131` | > 0 screenfuls | **0**, with the note below |

> this page hides the document's overflow and has no scrollable container in its light DOM, so the
> walk had nothing to scroll: the page has 2 open shadow roots, which the walk does not enter

**The spec holds 8 tests: these 5 arms and 3 twins, and only the 5 failed** — so every twin passed,
including the lint twin at `:79`, which was red in probes 1–3. **That is what turns all five into
evidence about the shadow boundary rather than about the fixture.**

**Why the lint twin had been red, which probes 2 and 3 could not tell:** the fixture's rule was a
`0.5px` **border**, and `cli-lint.spec.ts:55` records the measurement that Chromium gives a 0.5px
border a whole device pixel, so `div#hair` is never a hairline finding — the spec pins `hairline` to
exactly `div#rule` (a 0.5px height) and `div#shadow` (a 0.5px box-shadow). An arm built on a border
measures the rule's blind spot, not the boundary. Fixed at `90bb7c7` by making the rule a 0.5px
height. Rook's zeros-across-every-rule diagnostic is what made that findable, since "saw the rule and
didn't flag it" and "measured nothing" are different facts.

`cli-audit` and `surface-parity` passed in the same run, so `half-in-shadow.html` is untouched in
effect as well as in the diff.

**Branches, for whoever picks this up:** `test/open-shadow-arms` at `90bb7c7` (the arms and the
second fixture pair) and `probe/shadow-arms-red` (throwaway workflow, never merged).

**Still waiting, unchanged:** Henry's go on the traversal, and Opeyemi's review of `b2`.

### Step one complete — all five arms red with green twins (`35194464896`)

Four probe runs to get here, and the last three were about one arm. **The lint arm's twin was red
because the fixture's hairline was a 0.5px *border*, and the hairline rule has a documented blind
spot for borders** — `cli-lint.spec.ts:55`: *"Chromium gives a 0.5px border a whole device pixel, so
div#hair is not here."* The spec pins the rule's findings to a 0.5px-**height** div and a 0.5px
box-shadow. I copied the fixture's documented negative example and called it the proven shape,
twice; Henry read the spec (#398). **Height was excluded by the second run, the preset by the
third, and the third's "the page is the variable" was consistent with the cause without naming it.
The spec named it.** An arm built on a border measures the blind spot, not the shadow boundary.

| arm | expected | **received** | own assertion | twin |
| --- | --- | --- | --- | --- |
| 1 · audit, `half-in-shadow.html` | 52 | **12** | `:70` | `cli-audit.spec:299` (green) |
| 1 · lint, hairline inside the root | ≥ 1 | **0** | `:76` | **green now** — a 0.5px-height div with a background, `div#rule`'s shape |
| 3 · inspect at a point names the element | `inner` | **`card`** — the host | `:100` | green |
| 2 · contrast reads the component background | `#1f2937` | **`#ffffff`** | `:109` | green |
| 4 · the walk finds the scroller | > 0 screenfuls | **0** | `:127` | green |

`cli-audit` and `surface-parity` green in every run: `half-in-shadow.html` untouched in effect.

**Method, since it is the same shape as the six from the night before:** I read the fixture for an
element with the right *shape* and did not read the spec three lines below for what it *said about
that element*. A location was verified and a property was not. **What made it findable at all was
the twin's failure message carrying the whole lint summary** — zeros across every rule is "measured
nothing", which only a border fits, where a bare 0 fits both facts. The diagnostic was added after
the first red and paid for itself on the second.

**Branches:** `test/open-shadow-arms` at `90bb7c7` carries the two fixtures and the arms;
`probe/shadow-arms-red` is the throwaway dispatch-only workflow and is never merged. Implementation
builds on the arms branch, turns the arms green, updates `cli-audit.spec:299-303`'s 12 and the
share-note sentence, and carries the revert control — per Henry's #388.

**Was waiting on:** Henry's go, after Opeyemi's review of `b2`. Given 2026-09-17, below.

## Step two: the traversal, in #293 — Henry, 2026-09-17, while Rook is out

**Go given:** Opeyemi approved `b2`'s decision in Wren's session (#452: "approved, by default, no
flag"). Rook is out until Saturday, so the card moved to Henry on Wren's routing. The arms stay
Rook's, and #293 is built on them.

**What #293 does:** a single traversal in `src/shared/scrollHost.ts`, shipped with every page-side
script:
- `shadowElements` handles collection;
- `shadowParent` and `shadowContains` handle ancestors, the clip test and scroll offsets;
- `shadowElementFromPoint` and `shadowStackFrom` handle the hit test and the paint stack;
- `findScroller` enters open roots.

The share note and the empty-page note's web-components branch retire. The walk note keeps its old
wording for an app older than the change, which still sends `shadowHosts`. `inspect --selector` and
`scrollSelector` keep light-DOM meaning. The register entry is under "Next release".

**Measured locally:** 1342 unit tests and 137 browser tests pass, including 9 new ones against real
shadow roots. The e2e arms spawn the CLI, so CI reads them.

**Still open on this card, in order:**
1. #293's suite green, with every arm read at its own line;
2. the revert control: the traversal reverted on a probe, the arms red again, `half-in-shadow` back
   to 12;
3. the live check on caniuse.com and chromestatus.com, figures against a second browser, run on a
   runner;
4. the leftover, `chore-shadow-roots-stuck-chrome-and-frames` (Backlog), already has its own home.
## DONE — merged as #293 (fcac2d1), 2026-09-17

**The traversal, in one place** (`src/shared/scrollHost.ts`), shipped with every page-side script:
`shadowElements` (collection), `shadowParent`/`shadowContains` (ancestors, the clip test, scroll
offsets, stuck chrome, `inDialog`), `shadowElementFromPoint` and `shadowStackFrom` (the hit test and
the paint stack), and `findScroller` entering open roots. `inspect --selector` and `scrollSelector`
keep light-DOM meaning; closed roots and iframes stay out of reach.

**Every arm Rook wrote is green, and the revert control is what says they mean it** (`35219034011`):
with the four helpers reverted and everything else left in place, 9 tests failed at their own
assertions, each with Rook's original red value — 52 back to 12, hairline 0, `card` for `inner`,
`#ffffff` for `#1f2937`, 0 screenfuls, and "nothing to measure" and "the walk had nothing to scroll"
back. Every light-DOM twin stayed green.

**The live check** (`35219123120`), and the number it produced explained (`35220629725`):

| site | CLI audit, targets / text | a second browser, all / light | open roots |
| --- | --- | --- | --- |
| chromestatus.com/features | **28 / 131** (was 0 / 0), walk 3 screenfuls | 27 / 130, light 0 / 0 | 159 |
| caniuse.com | 22 / 94 | 21 / 95, light 20 / 95 | 1 |

The +1 was not a double count: running the audit's own script and an independent flat-tree query **in
the same page** gave 27/27 and 130/130, with an empty set difference both ways. The CLI's extra one
belongs to its environment — Electron, after a 3-screenful walk, on a page whose own reply said it was
still moving.

## What Wren's three adversarial reads found, and what each cost

**D1 — slotted text was read against the page.** A light-DOM `<p>` slotted into a component's dark
card composited onto white: 1.24:1 where 11.86:1 is painted. Not a regression, and it contradicted
three sentences this change had just written (`limitations.md`, the register, this card's own
acceptance). `shadowStackFrom` asks every scope the element is composed through now — its own, and
each one a slot or host takes it into — and merges the answers by taking the head no other answer
still has deeper.

**D2 — the scroller search starved inside shadow trees.** A sidebar of 286 components in front of
`main` took the whole 2,000-visit budget, and the page's real scroller lost; with a sidebar that did
not overflow, the search found nothing and the walk said the page had none. Two rounds: breadth-first
first, which Wren then measured as still starving once `main` sat four wrappers down, and then the
light DOM swept first on a budget of its own, which restores base's answer wherever the light DOM has
one.

**A defect my own fix authored.** Asking "is this element topmost at the point" meant a container with
a block child lost its stack and fell back to the ancestor walk, which cannot see a scrim from another
branch. Any index counts now.

**And the arm that protects the feature from a future optimisation:** a 560x380 feed inside a root
beats a 300x300 light-DOM scroller, so the second sweep cannot quietly become "stop once the light DOM
answered". Its control is that exact change.

**Two facts worth keeping** (Wren): `findScroller` answers null on chromestatus.com/features and
caniuse.com alike, on base and head, so neither site is touched by the starvation; and the shape needs
roughly 2,000 composed elements ahead of the scroller, which is what `chore-scroll-host-budget-is-silent`
has to detect.

## What left this card rather than being folded in

`chore-shadow-roots-stuck-chrome-and-frames` (two page-side queries that still stop at the boundary),
`chore-scroll-host-budget-is-silent`, `bug-in-root-feed-becomes-the-page`,
`chore-shadow-collection-edges`, `chore-capture-adds-page-globals`, `chore-motion-probe-cost-claim`.
The retired sentences and the two that move to the version-skew group are `c5`'s to fold into
`docs/note-inventory.md`.

## What it cost, and the defect I authored while fixing one

**Six suites.** Wren read the change three times, each read measured in headless Chromium against the
PR head and its base rather than reasoned, and each one found something:

1. **D1 and D2** (above).
2. **A defect my own D1 fix authored:** asking "is this element topmost at the point" meant a
   container with a block child lost its stack and fell back to the ancestor walk, which cannot see a
   scrim from another branch. Any index counts now, with the covered-element arm to prove it.
3. **D2 half-fixed:** breadth-first alone still starved once `main` sat four wrappers behind 300
   components. The light DOM is swept on its own budget now, so what it answers is what it answered
   before roots were entered at all — and an arm pins that a root's scroller can still win on area,
   so a later "stop once the light DOM answered" cannot quietly retire the feature.

**And one the suite caught, not a review:** the stuck-chrome probe ships as SOURCE, and I had it call
the shared `shadowContains`. The bundler wrote `emptyDocument.shadowContains(el, anchor)` — a
namespace no page has — so the probe threw and every stuck bar went unfound. Four `cli-snap-tiled`
tests went red (run `35226322138`). The browser tests could not have caught it: they call the
function, not the string it ships as. The probe carries its own walk now, and
`tests/unit/pageScriptsAreSelfContained.test.ts` reads the built bundles for the same shape.
`chore-page-script-guard-holes` carries what that guard still misses.

**The lesson, in one line, because it has now happened twice in this repo from opposite directions:**
a function that ships as source and the helpers it calls must live in the same module, and the thing
to check is the BUILT string, not the TypeScript.

