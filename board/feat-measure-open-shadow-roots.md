---
title: "Measure inside open shadow roots: audit, lint, inspect and the walk stop at the shadow boundary today"
column: doing
owner: "Rook"
waiting: "Henry: go on the traversal, after Opeyemi's review of b2"
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
