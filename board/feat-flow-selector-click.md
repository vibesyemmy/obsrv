---
title: "A flow step can click by selector, composed from three commands that already exist"
column: done
kind: feat
owner: "Henry"
order: 116
---

FILED BY WREN 2026-09-29, from Henry's scoping in the room (`#2569`, `#2570`, `#2599`) while
building `feat-flow-language`'s resolver. Depends on `feat-flow-runner`. Blocks the resolver's own
headline example.

**The role this plays.** `obsrv_flow` can locate an element by selector (`inspect { selector }`)
and cannot click one — `click` only takes CSS-pixel coordinates. That is why the resolver refuses
"log in, add an item, checkout" by naming the mechanism rather than emitting a step that would die
one layer down: `validateFlow` accepts `{action:'click', target:'.checkout-button'}` and the
control server 400s. This card is the missing join, not new input plumbing.

**The composition (Henry, `#2570`), in the runner because the runner can sequence and the
resolver by design cannot:**
1. `inspect { selector }` — the element's border box.
2. **Scroll it into view if the rect is offscreen.** This step is the reason it is a card and not
   a one-line change: an element below the fold has `rect.y` outside the viewport, and `click`
   correctly refuses it as *"outside the current CSS viewport WxH"* — a refusal that reads like a
   broken selector when the selector was right and the page just hadn't scrolled. Whoever builds
   this without the scroll step will ship something that fails exactly there.
3. `click` the center of the (now on-screen) rect.

**Static case that the two coordinate spaces agree, not yet run (Henry, `#2570`):** `parseClick`
bounds-checks against `tab().target.getViewport()`; `InspectReadout.rect` is documented as the
element's border box in CSS px of the same screen surface, existing beside `pageRect` (page CSS
px, scroll included) specifically because the two get confused. Same frame — a static reading,
not a measurement.

**Acceptance:**
- the three-step composition lands in the runner, not the resolver;
- a selector matching an offscreen element is scrolled into view before the click is attempted,
  not refused;
- **one real run confirms the static case before anything ships on it** — the center of an
  inspected rect must be verified, against a live app, to be a coordinate `click` actually
  accepts. This is the one thing nobody has measured yet, named so it isn't quietly assumed;
- a selector matching nothing, or matching an element with zero size, is refused with a reason
  naming which of the two it was — not a generic "click failed".

**Why this card and not a direct fix:** it needs a live app to verify against, which is the same
desk-safety boundary the epic's own live-drive card hit — nobody drives Obsrv on Opeyemi's visible
desktop without his yes given directly in that session. Filed as its own card so that boundary is
explicit rather than discovered mid-PR.

**Not this card:** the resolver deciding *when* a sentence means "click" versus some other action
— that's already `feat-flow-language`'s job, upstream of this. This card only makes the click
itself work once a selector is the target.

## BUILT 2026-09-29 by Henry — and the live run found a defect in the first cut

Three places, as the card asked: the arithmetic and the refusal sentences in
`src/shared/flowClick.ts` (pure, so they are testable without an app), the
sequencing in `src/mcp/flowRunner.ts`'s `pointForSelector`, and nothing in the
resolver.

**Against each acceptance line.**

1. *The composition lands in the runner, not the resolver* — it does:
   `inspect { selector }`, `status` for the viewport `click` will be checked
   against, a `scroll` only when the box is outside it, a **second** `inspect`,
   then `click` at a point. The resolver is unchanged except for its refusal text,
   below.
2. *An offscreen element is scrolled into view before the click is attempted* —
   and placed **a third of the viewport down**, not flush with the top. Flush is
   simpler and wrong: a sticky header is the commonest furniture on a page a QA
   flow drives, and an element at `y = 0` lands under it, so the click reaches the
   header and the flow reports a press that did nothing. The fixture
   (`tests/fixtures/selector-click.html`) has a 120 px fixed header **that logs its
   own hits**, so that failure is visible rather than silent, and the e2e asserts
   the element landed clear of it.
3. *One real run confirms the static case* — `tests/e2e/flow-selector-click.spec.ts`
   drives `runFlow` with a `call` that posts to a real app's control server, so
   `inspect`, `scroll` and `click` are the real commands against a real page. Six
   tests, three local sweeps, 18 passes.
   **And the desk-safety boundary this card was filed behind does not apply to this
   claim, which is worth stating precisely rather than waving through.** The claim
   is about the *target* surface: `parseClick` bounds-checks
   `tab().target.getViewport()`, and `InspectReadout.rect` is the border box in CSS
   px of that same surface. The target is offscreen in **every** configuration
   Obsrv runs, including a drive on a visible desktop — the visible window is the
   *renderer*. So this measures the agreement on the surface that owns it. What
   remains unrun is a visible-desktop drive, and this claim does not rest on one.
4. *A selector matching nothing, or an element with zero size, is refused with a
   reason naming which* — three distinct sentences, plus a fourth for an element a
   scroll could not reach, each naming the cause and none of them "click failed".
   A unit test asserts the three are different strings, because three sentences
   that happened to collapse into one would pass every individual check.

**The defect the live run caught, kept here because it is the card's own lesson
one level down.** The first cut read `readout.hidden` to name the rule hiding a
zero-area element. **There is no such field.** `inspect` turns that report field
into a *sentence* (`inspectReadout.ts:148`) — and the sentence arrives in two
different places depending on the answer: top-level `notes` on a miss (where *"not
a valid CSS selector"* lands), `readout.notes` on a hit (where *"this element is
not drawn"* lands). Measured with a throwaway probe against the live app rather
than reasoned about. So the refusal for `#hidden-cta` read a bare
`no area (0x0 at 0,0)` and named no rule, and the e2e is what failed. Both places
are read now, a unit test uses the hit shape exclusively, and the e2e keeps the
assertion that caught it.

**One thing beyond the card, and it is a correction rather than scope creep.**
`flowLanguage.ts`'s refusal for an interaction stated in words gave its reason as
*"click takes CSS-viewport coordinates ({x, y}), which only the rendered page can
supply"* — which this card makes false. The refusal still stands, for the reason it
always really had: a description names an **intent**, not an element, and nothing
resolving a sentence can see the page to choose one. Leaving the old sentence would
send a reader to fix a coordinate problem that is fixed; it now says what to supply
instead. Its two tests moved with it, and the new assertions include
`not.toMatch(/CSS-viewport coordinates/)` so the stale sentence cannot come back.

**In the report, not only in the reply.** The step carries `clickedAt` — selector,
box, viewport, whether it had to scroll, and the point — rendered as *"Which
element, and where in it"*. The absence of a scroll is **stated** (*"already on
screen, so the page was not moved"*) rather than skipped: that and *"scrolled into
view first"* are different reproductions, and a reader who saw neither line would
not know which happened.

**Deliberately NOT done: the MCP `outputSchema` is unchanged.** `clickedAt` reaches
the report, not the tool reply. Adding an output key costs the four-places sweep
plus `docs/public-shape.json`, and the agent-facing facts — the click worked, or
which of four refusals it was — already arrive in `error`. If an agent turns out to
need the point, that is a small follow-up with a reason behind it rather than a
field shipped on spec.

Measured: `npm run typecheck` exit 0 (the `--build` script), unit 1746 passed /
1 skipped, the new live spec 18/18 across three sweeps.
