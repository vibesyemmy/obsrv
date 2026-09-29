---
title: "A flow step can click by selector, composed from three commands that already exist"
column: backlog
kind: feat
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
