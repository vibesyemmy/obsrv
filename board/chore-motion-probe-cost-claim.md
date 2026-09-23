---
title: "The motion probe's \"about 15 ms\" comment predates pages built from components"
column: done
kind: chore
owner: "Henry"
criterion: B2
order: 92
---

FILED BY HENRY 2026-09-17, out of Wren's adversarial read of `#293` (N7), as a card of its own.

`motionAfter` (`src/shared/pageMotion.ts`, called from `src/cli/main.ts`) re-runs the whole audit 250 ms
after the figures are taken, and the comment beside it states what that costs — about 15 ms. That was
measured before the measurement entered open shadow roots. On a component-built page the traversal now
covers the composed tree, and chromestatus.com/features went from 0 measured elements to 131 text and
28 targets, so the claim is a number nobody has re-measured.

**This is a claim to re-measure, not a defect.** Either the figure still holds, and the comment says on
what page, or it does not, and the comment says the new one.

**Acceptance:**
- the probe's cost measured on an ordinary page and on a component-built one, on CI rather than a
  laptop;
- the comment carries both figures and the page shape each was taken on;
- if the cost has grown enough to matter, a card for what to do about it — the probe is what makes
  `pageMovedNote` honest, so it is not a candidate for quietly dropping.

## RE-MEASURED 2026-09-23 by Henry — the ratio holds, the number was unattributable

Seven runs each, median of the sorted set, headless Chromium at 1280x800 with `auditPage` bundled by
esbuild. Both pages carry **908 elements**, so the only variable is where they live.

| page | median | min–max |
| --- | --- | --- |
| 900 rows in the light DOM | **3.2 ms** | 2.7–3.9 ms |
| the same 900 rows, each behind its own open shadow root | **4.7 ms** | 4.0–7.5 ms |

**The card's question was whether entering composed trees blew the cost up. It did not:** about half as
much again at the same element count, not an order of magnitude.

### Why the comment does not simply get a new number

The old figure named **neither the page nor the app version**, which is why nobody could check it —
and a fresh unattributed number would inherit that defect exactly. Both of my fixtures are synthetic:
no images, no real stylesheet, almost no layout. A real page costs more than either, and **15 ms may
well have been honest for whatever page produced it.**

So the comment now claims **the ratio to the wait** — single-digit milliseconds against a 250 ms sleep
— which is robust to page weight, and records the two measurements with their conditions beneath it.
A reader can reproduce those; nobody could reproduce the old one.

### What was not done

Not measured on a real site. `chromestatus.com/features` is named on this card as the page where the
composed-tree traversal went 0 → 131 text elements, and it would give a realistic absolute figure —
but a live site's number is unreproducible the week after, which is the same flaw being fixed here.
**If a portable absolute figure is wanted, it needs a checked-in heavyweight fixture**, and that is a
different card.

## CLOSED 2026-09-23 — merged, board column was never flipped

`#447` merged (`36b6a43e`). Idris PASS'd it (room #1946): run `0992e6e`, byte-counted, matches "comment
and card only" exactly. This is the follow-up nobody wrote — the code and the gate were both done, only
the card's own `column`/`waiting` fields still said `review`.
