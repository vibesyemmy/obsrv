---
title: "The report says \"full page: warning: full page is…\""
column: review
kind: bug
owner: "Rook"
order: 32
---

FOUND BY ROOK in run 18, 2026-09-15. **Unowned.** The smallest of the three and the cheapest to
fix; filed separately so it is not carried along inside a card about something else and then
forgotten when that card closes.

In the report's HTML, where a designer reads it:

    full page: warning: full page is 10374 CSS px tall…

The warning already opens with `warning: full page is`, and the report prefixes `full page: `.
So it says the subject twice and carries a bare `warning:` in the middle of a sentence rather
than at the start of one.

**Why it is worth a card rather than a quiet fix.** The sentences are the product — the whole
argument of `docs/read-the-output-not-the-code` — and this is the one place in run 18 where a
sentence reads as though nobody had looked at it in the surface a user actually reads. The
cause is almost certainly that the string was written for stderr, where the `warning:` prefix
earns its place, and is then reused in HTML where the section heading already supplies the
subject.

**So the fix to look for is not this string.** It is whether a warning's text is composed once
for two destinations that need different openings. If it is, the same doubling will exist
wherever else a prefixed warning is embedded under a heading, and fixing this instance ships
the class.

Check the other warnings the report embeds before editing this one.


## Resolved by Rook, 2026-09-16 — branch `fix/report-diff-trio`

**The card's guess was right and the class was wider than it guessed.** The label was composed
once for two destinations: fifteen call sites wrote `warning: ` into the message, `warn()`
stored it verbatim in `warnings[]`, and the report prefixed each entry with `full page: `
(`main.ts:1390`). **`diff` did the same with `target: ` and `reference: `
(`main.ts:802-803`), so `target: warning: …` was shipping too.** And not every entry had the
label — `capture.ts`'s *page kept painting* messages arrived bare — so one snap's list held both
forms. The correct pattern already existed forty lines away: `audit`/`lint`/`inspect` store
bare and label at the stderr boundary (`main.ts:1084`).

**Fix:** the sink owns the label (`warnings.ts`). `warn()` stores the fact bare and writes
`warning: ` on the stderr line only. Fifteen literals stripped, each read in the diff rather
than trusted to the grep. A caller that still composes the label is *not* corrected by the sink
— stderr would show `warning: warning: …`, which is the tell that a call site was missed, and
louder than the list silently differing from what was said.

**Observed in output:** `report` on a fixture that takes the full-page pass answers
`"full page: hid chrome stuck…"` with no `warning:` in it and none in the HTML; `diff`
answers `"target: page kept painting…"`. Not observed: a formerly-labelled message through
`diff`'s prefix — the fixtures at hand raise only the bare ones there. The path is the same
three lines as the report's and is read, not watched.

**Register entry** in `docs/breaking-changes.md`, under 0.61.0: breaking but sanctioned, quoting
*match on structured fields, never on prose*, and stating that the list never had one form
before this. The repo's own suite is not a caller the entry is about: `mcpLib.test` pins the
label on stderr, where it stays, and is now the control that stderr did not lose it.
