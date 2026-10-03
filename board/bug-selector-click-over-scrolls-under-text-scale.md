---
title: "a click by selector on an element below the fold scrolls past it under a text scale, and refuses"
column: done
owner: Dogu
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

## FIXED, 2026-10-03 — `#544` as `53cf2bed83678819c44b7fad7d23b596b921e63f` on `main`

Merged by Henry (room `#3178`) on Opeyemi's "all 8 go" in his session, with `--match-head-commit` on the counted
head, the merge commit's second parent: `da3e6283d314f4f2720462d4d0b0cade557c7ec8`. The PASS is Idris's, room
`#3144`, **counted on attempt 2 of run `37123672372`** (attempt 1 of that run id was cancelled at the 30-minute cap
and is not the evidence). **Unreleased; no public-shape change.**

**The hypothesis above was right, and now it is measured.** Under a text scale `k` the page lays out `k` times
smaller. `inspect`'s `rect` and the status viewport are in surface px (page px x `k`); `scroll` takes **page** px;
`scrollToShow` aimed the surface distance as if it were page px. At `k = 1.5`, `#below-cta` is 2216 page px down:
it aimed `3324 - 284 = 3040` page px, and the element ended at `(2216 - 3040) x 1.5 = -1236`, the number in the
refusal above. At `0.75` it under-scrolls instead.

**The fix:** `scrollToShow(rect, pageRect, viewport, textScale = 1)` divides the distance still to travel by `k`
before adding it to the page's own offset; at `k = 1` the result is unchanged. The runner reads `textScale` from
the `status` it already reads for the viewport (absent, or not a positive number, reads as 1).

**Acceptance, bullet by bullet:**
- **Lands at 1.5 and at 0.75, clear of the fixed header: done.** `tests/e2e/flow-selector-click-text-scale.spec.ts`
  (1.5, 0.75, the scale-1 control, and two selector clicks in one flow at 1.5), and a physics fake in
  `tests/unit/flowRunnerTextScale.test.ts` at 1.5, 0.75, 2 and 1.
- **The probe becomes a test, at both scales: done.** With the scale argument removed, the live spec fails with the
  card's own sentence (`after scrolling to 0,3040: its box reads 360x84 at 30,-1236`) and the scale-1 control passes.
- **The refusal does not name an inner scroller under a text scale: NOT DONE.** The sentence is unchanged. With the
  scroll right this cause can no longer reach it, and it stays correct for its real causes (a scroll owned by an
  inner element, a fixed element placed off-screen). If a case turns up where it fires under a text scale for a
  reason that is not those, it is its own card; this one is moved to done on the first two bullets and says so.

**A caveat I raised in `#544`, withdrew in an earlier head of `#547`, and restore here, measured.** `#544`'s body
and the room said the app's recorded scroll "can go stale after a page-level `window.scrollTo`". I had not
measured it. I then read it 40 times at text scales 1, 1.5 and 0.75, found 0 stale, and wrote that it "does not
reproduce". **That was true of the sequence I tried and wrong as a conclusion:** every one of those reads came after
a page-level scroll with no app-applied scroll in the 120 ms before it.

Idris found it on `main` (room `#3196`): `flow-selector-click.spec.ts:270`, the merge suite of `#545` (run
`37158995878`), first attempt, with the over-scroll signature **at text scale 1**: `"#wrapped-link" is still outside
the 393x852 viewport after scrolling to 0,4492: its box reads 123.7x47.5 at 20,-1411.4`. The retry passed. The test
calls `reset()`, a page-level `window.scrollTo(0, 0)`, right after a flow that scrolled through the app.

**It is deterministic, and it is the preload's 120 ms echo window** (`src/preload/sync.ts`, `SUPPRESS_MS`): an
app-applied root scroll arms it, and a scroll the page makes inside it is reported to main only when the window
ends. The record behind `pageRect` is fed by those reports, so it lags such a scroll by the rest of the window.
Measured with a scratch spec (not committed), 12 runs per row, app scroll to 1500 then `window.scrollTo(0, 0)`, then
how long until `pageRect.y - rect.y` equals the page's real `scrollY`:

| the page scrolls this long after the app scrolled | the record catches up after |
| --- | --- |
| 0 ms | 111-122 ms (median 121) |
| 40 ms | 73-81 ms |
| 80 ms | 36-42 ms |
| 110 ms | 10-23 ms |
| 125 ms | 1-34 ms (median 2) |
| 150 / 250 / 500 ms | 1-34 / 1-4 / 1-22 ms |

and back to back, no wait: **400 of 400 reads stale** (recorded = the app's earlier position, page at 0). So `pageRect`
is wrong for up to 120 ms after an agent scroll if the page then scrolls itself, and the selector click, which aims
from it, can over-scroll and then refuse naming geometry. A refusal, not a wrong press. Tracked as
`bug-recorded-scroll-lags-a-page-scroll`; this card's fix (the text scale) is unaffected.
