---
title: "a click by selector on an element below the fold scrolls past it under a text scale, and refuses"
column: backlog
kind: bug
release: later
criterion: B5
order: 121
---

FOUND 2026-10-03 by the text-scale arm that Idris's gate on `#543` asked for, and **reproduced on pristine
`origin/main` (`f6007be`)** with a probe that has no line boxes in it, so this is not `#543`'s.

## What happens

At a text scale of 1.5, a selector click on an element that is below the fold scrolls the page, finds the
element is *still* off screen, and refuses:

```
"#below-cta" is still outside the 393x852 viewport after scrolling to 0,3040: its box reads 360x84 at 30,-1236.
A page whose scroll is owned by an inner element, or a fixed element placed off-screen, does this
```

`#below-cta` is a plain block button 2000 px down `tests/fixtures/selector-click.html`. After the scroll it
sits at **y = -1236**, above the viewport: the page went **too far**, not too short. The same click at scale 1
(every existing test) lands. The `#543` arm's first version, on `#wrapped-link` in the same fixture, failed
the same way (`0,3395`, box at `y=-1414`).

The sentence blames "an inner scroller or a fixed element", which is not what happened here, so it points
a reader at the wrong thing. That is the smaller half of this card.

## The probe (8 lines, any session can run it)

In `tests/e2e/flow-selector-click.spec.ts`, which already has a running app, `call` and `runFlow`:

```ts
test('probe: a block below the fold, selector click under a text scale of 1.5', async () => {
  await reset()
  expect((await call('setTextScale', { textScale: 1.5 }))['applied']).toBe(true)
  try {
    const result = await runFlow({ steps: [{ action: 'click', target: '#below-cta' }] }, { call })
    expect(result.steps[0], JSON.stringify(result.steps[0]?.error)).toMatchObject({ status: 'ran' })
  } finally {
    await call('setTextScale', { textScale: 1 })
  }
})
```

Fails on `origin/main` with the sentence above, both attempts.

## A hypothesis, not a finding

`rect` and `pageRect` come back in **text-scaled** px (`TargetSource.inspectSelector` multiplies the box by the
scale), and `scrollToShow` aims `scroll` at `pageRect.y - viewport.height / 3`. If `scroll` takes **page** px,
the target is out by the scale factor, and 1.5× would over-scroll an element 2000 px down by roughly the
distance seen. That fits; nothing here has measured which unit `scroll` takes. **Do not fix it from this
paragraph:** read `scroll`'s unit first, then check whether scale 0.75 under-scrolls.

## Why it matters, and why it is not urgent

A flow run under a text scale cannot reach anything below the first screen by selector. Text scale is a
deliberate feature (`obsrv_snap`, `obsrv_drive`) and a user checking how a page reads at 150% is the person
most likely to then click through it.

## RELEASE CLASS 2026-10-03 — `later`

A step that fails and **names the geometry it ended with** is a refusal, not a silence: no caller receives a
wrong answer, and the flow stops at the step as `docs/release-gate.md` wants. What is wrong is the *cause*
the sentence suggests, not the outcome. Class 3, not class 1.

## Acceptance

- a below-the-fold selector click lands at a text scale of 1.5 and of 0.75, with the page at the position the
  existing scale-1 test asserts (`resolved.rect.y` clear of the fixed header);
- the probe above becomes a test, at both scales;
- the refusal for "still outside the viewport" does not name an inner scroller when the flow ran under a
  text scale, or the scale is carried into the sentence.
