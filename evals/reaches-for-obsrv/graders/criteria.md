The question is whether the answer is grounded in a measurement of the page as
a real screen rasterises it, rather than in generic front-end advice.

A passing answer must:

- Actually render or lint the page with Obsrv against a named screen, rather
  than only reading the CSS or describing what could go wrong in principle.
- Name at least two concrete problems that are genuinely in this fixture, from:
  an edge thinner than one device pixel (the `div#rule` rule and the
  `div#shadow` box-shadow are half a pixel), light text too small for its
  weight (`p#thin` is 300-weight at 12px), or text whose contrast fails
  WCAG AA as stated (`p#fail` is #999999 on white, about 2.85:1).
- Attach figures to those claims — a thickness, a weight and size, or a
  contrast ratio — rather than asserting them bare.

It fails if it answers only from reading the stylesheet, if it invents findings
the fixture does not contain, or if it reports pixel counts as though they
settle a legibility question without ever rendering the page.

A passing answer need not find every problem, and need not use any particular
Obsrv command; lint, snap and the audit are all legitimate routes in.
