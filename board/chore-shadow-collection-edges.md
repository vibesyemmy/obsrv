---
title: "Two collection edges at the shadow boundary: a host that wraps a control, and a slot's fallback text"
column: backlog
kind: chore
criterion: B2
order: 90
---

FILED BY HENRY 2026-09-17, out of Wren's adversarial read of `#293` (R5, R6). Both reasoned from the
code, neither measured on a page.

- **A host that wraps a control is counted twice.** A component written as
  `<x-button role="button" tabindex="0">` whose root holds a native `<button>` matches the audit's
  target selector twice: the host, and the button inside the root. Before `#293` only the host was
  measured. The finding then reads as two overlapping targets at the same box, and the mm figures are
  the same figures twice.
- **A slot's fallback text is never measured.** `<slot>Buy</slot>` renders its fallback when nothing
  is assigned, and a `<slot>` is `display: contents`, so its rect is zero and `shown` drops it. The
  glyphs are on the screen and no rule sees them.

**Acceptance, each with a control:**
- a fixture with a host wrapping a native control: one target, at one box, and reverting the rule
  brings the second back;
- a fixture with an unassigned slot holding fallback text: the text is measured, and the control is
  the same slot with content assigned, where the fallback is not on the screen and must not be.
