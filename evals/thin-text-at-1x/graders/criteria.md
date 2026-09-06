This tests whether the answer compares the two rasters rather than guessing.
The fixture is 300-weight text at 12px, which is exactly the case that survives
a HiDPI screen and thins on a 1x one.

A passing answer must:

- Render or measure the page at the 1x laptop screen, naming the preset
  (`laptop-768`) or its dimensions.
- Ground the verdict in a measurement rather than an impression. Either is
  acceptable: the lint rule naming the element as light text below the
  threshold (300 weight at 12px), or the 1x-versus-2x comparison, whose ink-row
  ratio for this fixture is about 0.5.
- Say plainly that the text is at risk on the 1x screen.

It fails if it answers from the CSS alone, if it claims the text is fine, or if
it quotes a number without saying which render produced it.

An answer that also reads the PNG and describes how the strokes look is
stronger, not weaker; the requirement is that a measurement is present.
