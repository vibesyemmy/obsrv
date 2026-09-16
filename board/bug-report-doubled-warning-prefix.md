---
title: "The report says \"full page: warning: full page is…\""
column: doing
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
