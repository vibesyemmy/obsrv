---
title: "`inspect` by selector: a hidden element reads as drawn, and a selector that is not CSS reads as no match"
column: doing
kind: bug
owner: "Kenya"
waiting: ""
order: 48
---

FOUND BY HENRY 2026-09-16, following the last line of `bug-inspect-offscreen-point-is-silent`
(*"Worth checking while there: … a selector that matches a hidden element"*). **Unowned.**

**Surface observed:** a local build of `main` at `f362898`, through the CLI's JSON, which the MCP's
headless `obsrv_inspect` relays. The live path runs the same `inspectSelector`, so it is expected
to match. That is expected from reading the code, not observed.

## The defect

`tests/fixtures/audit.html` has two paragraphs nobody can see: `#hidden` (`visibility: hidden`)
and `#none` (`display: none`), both with 4 px text. `obsrv inspect … --preset pixel-8 --selector`:

| selector | `found` | `rect` | font | contrast | `notes` |
| --- | --- | --- | --- | --- | --- |
| `#hidden` | true | 380.2 × 4.6 | 4 px = 0.62 mm | 18.88:1, **passes** | `[]` |
| `#none` | true | **0 × 0** | 4 px = 0.62 mm | 18.88:1, **passes** | `[]` |

**Nothing in the reply says either element is not drawn.** An agent checking text it can't see on
the screen gets a millimetre size and a passing WCAG verdict. For `#hidden` there isn't even a
zero-size box to hint at it: its rect is a normal line of text.

**The third way of hiding is already said, which is why these two stand out.** The fixture's
`#ghost` is `opacity: 0`. Inspected by selector and by point, it answers contrast 1:1, failing,
with the painted-colour note: *"the page states #000000 and the screen shows #efefef: an opacity of
0 composites it onto the background, and the contrast figures are of what is shown"*.

## The same app already draws this line, one tool over

`audit` skips what isn't rendered. `shown` in `src/shared/audit.ts` requires a non-zero box,
`visibility` not `hidden`, `display` not `none`, and `opacity` not `0`. On the same page and preset,
`audit` counts 6 text elements and its smallest is 10 px, so neither 4 px paragraph is among them.
**So `audit` says the page's smallest text is 10 px, and `inspect` measures 4 px text on it without
saying it is hidden.** Both are right about their own question, but only one says what it did.

## What a fix has to decide

`found: true` is right: the selector matched. The question is whether the reply says the element is
not rendered, and which rule decides that. **`audit`'s `shown` is the obvious one to share**, so
the two tools can't disagree about what counts as drawn. `notes` is already declared, so a sentence
there moves nothing in the schema. A field (`rendered: false`) would be breaking, since the schemas
are `additionalProperties: false`.

**The hidden elements are the `selector` path only.** A point can't reach either element. `(100, 200)` lies inside
`#hidden`'s rect and answers `body`, and `#none` has no box. A point does land on `#ghost`, and
that case is already said (above).

## The second silence: a selector that is not valid CSS

`inspectTarget` in `src/shared/inspect.ts` wraps `document.querySelector` in a `try` and turns the
`SyntaxError` into `null`, the same `null` a selector that matches nothing returns. On the same page
and preset:

| selector | `found` | `notes` | stderr |
| --- | --- | --- | --- |
| `#no-such-thing` | false | `[]` | *nothing at selector "#no-such-thing"* |
| `p[` (not CSS) | false | `[]` | *nothing at selector "p["* |

**Identical, down to the human line.** An agent that typos a selector concludes the element isn't
on the page. Nothing upstream catches it: `--selector` and the MCP schema check only the length,
and the control server's `parseInspectRequest` does the same. The live path runs the same script,
so it is expected to match. That is expected from reading the code, not observed.

**Unlike the hidden case, this one can't be a note on a readout, because there is no readout.** The
page ask has to tell *invalid* from *no match*. Either it returns a marker the parser keeps, or a
second ask checks the selector when the first returns `null`. This is the fix's decision.

**One owner for both halves**, since both change the same page ask, `inspectTarget`: the hidden half needs the element's computed `visibility` and `display` reported, and the invalid half needs its `null` split in two.
