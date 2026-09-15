# The contrast figure and the colours beside it: which half lied

Measured 2026-09-15 by Rook for `bug-contrast-figure-mismatch`. Run 17 found
`a.upvoter` on lobste.rs reported as `#ffffff` on `#0c0c0c` with a ratio of
**7.5**, where white on `#0c0c0c` is 19.56.

**The ratio was the right half. The printed colour was the wrong one.** That is
the opposite of how run 17 framed it, and of both hypotheses held going in.

## The arithmetic is innocent, established before anything else

`tests/unit/contrastFigure.test.ts`, against figures computed from the
published formula rather than from the implementation:

```
black on white           21.00   the figure WCAG itself quotes
#ffffff on #0c0c0c       19.56   the pair run 17 saw reported as 7.5
#0b0c0c on #d2e2f1       14.82   the pair the tool got right in the field
order-independent        yes     so "wrong on light-on-dark" cannot live here
```

Six tests, all green on the existing code. That halved the space in one run: if
the function returns the right number for those colours, the value handed to it
is what differs — and no hypothesis about compositing was needed to get there.

## The fixture grid, and what each cell said

A page whose colours are known by construction, inspected headless at
`1080p-24`:

| case | what it is | printed colour | printed background | ratio | verdict |
| --- | --- | --- | --- | --- | --- |
| 2 | `#ffffff` on declared `#0c0c0c` | `#ffffff` | `#0c0c0c` | 19.56 | consistent |
| 4 | white text over a 30% white veil on `#0c0c0c` | `#ffffff` | **`#555555`** | 7.47 | consistent — the composite is printed |
| 5 | `#0b0c0c` over a 30% black veil on `#ffffff` | `#0b0c0c` | **`#b3b3b3`** | 9.29 | consistent — both directions |
| 7 | `color: #ffffff` with **`opacity: .62`** on `#0c0c0c` | `#ffffff` | `#0c0c0c` | **19.56** | **both halves wrong** |
| 8 | **`color: rgba(255,255,255,.62)`** on `#0c0c0c` | **`#ffffff`** | `#0c0c0c` | **7.72** | **halves disagree** |

Two distinct defects, and the grid separates them.

## Defect A — a translucent text colour is composited for the ratio and printed opaque

Case 8 is lobste.rs exactly. White at 62% over `#0c0c0c` composites to
`#a3a3a3`, whose true ratio is 7.72 — which is what the tool reports. It then
prints the colour as `#ffffff`, which is the declared value with the alpha
discarded.

Confirmed against the real page rather than inferred from the fixture. The
snap's own pixels inside `a.upvoter`'s reported rect run from `#0c0c0c` to
`#a1a1a1`, read with the repo's dependency-free PNG decoder:

```
a.upvoter's own rect: darkest #0c0c0c, brightest #a1a1a1
contrastRatio(#a1a1a1, #0c0c0c) = 7.57
```

So the number describes the pixels and the hex beside it does not. A reader
checking the tool's arithmetic — which is what anyone sceptical would do —
finds 19.56 and concludes the tool is broken, when the tool was right.

**Direction was never the boundary.** gov.uk's text was opaque and lobste.rs's
was translucent; two samples made that look like a light-on-dark split. Cases 4
and 5 composite backgrounds correctly in both directions.

## Defect B — element `opacity` is ignored by both halves

Case 7 paints the same grey as case 8 and reports `#ffffff` on `#0c0c0c` at
**19.56**. Here the ratio is wrong too: nothing accounts for an `opacity` on
the element or an ancestor, so a page that greys its secondary text the common
way is judged as though it had not.

This one is worse than A in consequence — A prints a misleading colour beside a
correct verdict, B produces a wrong verdict — and it is invisible in exactly
the same way, because the two halves agree with each other.

## What the fix has to decide

Not taken here; the card's instruction was to establish which half lies before
touching either, and that is now done.

- **The printed colour should be what is painted.** `#a3a3a3`, not `#ffffff` —
  the effective colour after its own alpha, the way the background already
  prints its composite. The stated colour is still worth carrying when the two
  differ, because "you wrote `#ffffff` and the screen shows `#a3a3a3`" is more
  useful to a designer than either alone.
- **`opacity` needs to reach both halves**, which is a larger change than A:
  the alpha lives on an ancestor chain rather than in the colour, and the
  effective opacity is the product down that chain.
- **Whether `lint` shares the fault** — it emitted the same `#ffffff … 7.5` on
  lobste.rs, and both surfaces take their figures through
  `src/shared/contrast.ts`, so one fix should cover both. Worth asserting
  rather than assuming.
