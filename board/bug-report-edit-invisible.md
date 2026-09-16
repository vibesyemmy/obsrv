---
title: "The report's central image is altered and only stderr says so"
column: review
kind: bug
owner: "Rook"
order: 30
---

FOUND BY ROOK in run 18, 2026-09-15. Verified independently by Henry in the source. **Unowned.**

**An MCP caller cannot learn that the image its findings are pinned to was edited — and
`compatibility.md` tells it not to look in the one place the fact appears.** That is the finding.
The stderr gap below is the mechanism, not the headline: a reader who stops early should come
away with *the caller cannot know*, not *a warning went to the wrong stream*.

Rook, who found it, asked for this ordering after reading the first version: leading with the
stream understates it.

**Every `report` alters the capture its findings are pinned to, and tells nobody who can hear
it.** Chrome stuck to the viewport is hidden for the bands after the first — on uniqlo, two
fixed elements totalling **160 CSS px removed from every band** of the overview the "Where the
problems are" section is built from. That is correct behaviour and a good design: it shows the
page once rather than repeating a sticky header, and recovers the rows behind it.

The defect is that the sentence saying it happened **never reaches the artefact**. It is absent
from the HTML, absent from `screens[].warnings`, and therefore absent from every MCP caller's
reply.

**The mechanism, exact and verified at the line:** `human()` is stderr-only —
`src/cli/main.ts:95-97`, three lines, `process.stderr.write` and nothing else. The stuck-chrome
sentence uses it at `src/cli/main.ts:484`. The truncation warnings beside it use `warn()`, at
`:589` and `:599`, and those **do** reach `warnings[]`. Same file, same function, adjacent
branches — and the one that never joins the list is the one saying the image was edited.

**Rook's control is what makes this a finding rather than a guess:** the truncation warning
reaches the HTML *on the same page*, so the artefact renders its warnings faithfully. Nothing is
broken about the rendering. This sentence simply never becomes a warning.

## Why this is a correctness problem and not a reporting gap

`docs/compatibility.md`, contract 4: *"Human-readable text on stderr is not a contract and may
be reworded at any time; if you are parsing it, parse the JSON instead."*

**So the only place this fact appears is the one place the project instructs callers to ignore
— and an MCP client never sees stderr at all.** A caller following Obsrv's own documented advice
cannot learn that 160 CSS px were removed from every band of the image its findings are pinned
to. The policy and the defect point in opposite directions, and the policy is right; the
classification is wrong.

**The starkest instance, on docs.astro.build:** `warnings` is `[]` for both screens while stderr
carried two sentences each. An empty array reads as *nothing to say about this capture*. The
list is not broken — it is working exactly as written, which is the harder kind of silence to
find and the reason this needed someone reading a surface nobody had examined.

## What a fix has to decide, because it is not simply "call warn instead"

`human()` exists for a reason: not every sentence a person wants on a terminal belongs in a
machine list, and `compatibility.md` makes **adding a field** to an MCP reply a breaking change
while leaving the *contents* of an existing array free to grow. So moving a sentence from
`human()` to `warn()` is cheap on the MCP surface and is the likely fix — but the question to
answer first is which sentences are **facts about the artefact** rather than progress notes.

The test that separates them, proposed rather than settled: **would a caller reasoning about
the output be wrong without it?** The stuck-chrome sentence passes that test — the image is not
what it appears to be. "Captured in 3 bands of 768 CSS px" probably does not.

Audit every `human()` call in `src/cli/main.ts` against that question rather than fixing this
one instance, because one instance fixed is the same class shipped.

## Not yet known

Whether the overview's pins and crops **land** where the findings are. Run 18 established only
that the page explains what it could not locate — not that what it did locate is in the right
place. If a pin is placed against unedited coordinates while the image lost 160 px per band,
that is a second defect hiding behind this one, and it is untested either way.


## Resolved by Rook, 2026-09-16 — branch `fix/report-diff-trio`

**The sentence now reaches the artefact.** Both stuck-chrome sentences — `main.ts:484` (chrome
inside the scroller) and `:581` (chrome stuck to the viewport) — go through `warn()` rather
than `human()`, so they join `warnings[]`, and from there the report's HTML and every MCP
caller's `screens[].warnings`. Observed in output, not inferred from source: a `report` on the
stuck-chrome fixture with one audit finding (so the full-page pass runs) answers
`"full page: hid chrome stuck to the viewport for the bands after the first: header#fixed-bar
(fixed, 56 px), div#sticky-bar (sticky, 40 px)"` in JSON, prints it under the screen's Warnings
in the HTML, and says it once on stderr with the label. The first attempt at that check was
vacuous — the plain fixture has no findings, so `report` never takes the full-page pass and
`warnings` was `[]` for a reason that had nothing to do with the fix. Read the zero.

**The audit the card asked for, every `human()` in `main.ts` against *would a caller reasoning
about the output be wrong without it*:** two sentences moved (above). Everything else stays —
the per-command summary lines restate fields; the *captured in N bands* pair at `:502`/`:593`
is a progress note whose fact is the `bands` field; the echoes at `:960`–`:1230` mirror
`notes`/`warnings`/`listed`/`coverage`/`unwalked` that reach the machine output at
`:1000`, `:1122` and `:1256`–`:1262`, checked line by line rather than assumed.

**One the audit found and this branch does not fix — it needs a decision.** `refused`, the
message `setThrottle` returns when Chromium would not apply a throttle, reaches stderr only in
`inspect` (`:939`), `audit` (`:1015`) and `lint` (`:1138`) — while their machine output
still answers `throttle: <id>` from the request. A caller reading that field would believe the
numbers were measured under conditions that were refused. `snap`'s twin at `:343` already
goes through `warn()`. It is three lines to fix and it is not fixed here because the refusal
cannot be forced from the CLI's own process, so there is no failing test to write first; that is
a choice for Opeyemi rather than a thing to ship on a reading. Filed as its own card.

**Still not known:** whether the pins and crops land where the findings are. Unchanged from
above; this card was about the sentence.
