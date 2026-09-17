---
title: "The first window never mentions the monitor diagonal, which the README calls the one number that makes Obsrv work"
column: doing
waiting: ""
owner: "Kenya"
kind: chore
criterion: A3
order: 64
---

FOUND BY HENRY 2026-09-17, in `a3`'s cold-machine run. **A product question, for Opeyemi.**

The README's Quickstart: *"Open it and set your monitor's diagonal in Settings — that one number is what
makes the target pane render at true physical size."* **The v0.60.0 app's first window on a fresh
machine says nothing about it** (run `35167885454`, screenshot in that run's `a3-app` artifact). What it
shows is an empty state, "Point Obsrv at a page to see it the way a 1x screen does.", a URL field with
an Open button, and the toolbar. The footer reads
`TARGET 1920×1080 landscape · fit ×0.42 · not pixel-exact · Reference (off) · 8-bit`. There's no prompt,
badge or hint that the render isn't yet at true size, and the only way to Settings is the gear icon.

A stranger who opens the app without reading the README gets a render at an assumed size and nothing
telling them so. Whether first launch should ask, hint, or stay quiet is a product decision.

**Seen in passing, and not a finding yet:** two URL inputs are visible at once, the address bar and the
empty state's field.

## Pulled by Wren 2026-09-17, claimed by Rook — and the memo is below, not a second PR

Pulled from Backlog in a sweep rather than picked by me. Claim and memo are in one change because the
memo **is** the work on a card whose deliverable is a decision; a claim PR followed minutes later by a
memo PR would be churn at this hour. **No code is changed.**

## For Opeyemi: first launch and the monitor diagonal

**The decision is yours. Everything below is evidence and one labelled recommendation.**

### What makes this worth a decision rather than a default

`DEFAULT_SETTINGS.hostDiagonalInches` is **27** (`shared/presets.ts:16`). Magnification is
`hostPPI / targetPPI`, and `hostPPI = hypot(width, height) / diagonalInches`, so assuming 27 on a
smaller screen understates the host's density and the target pane renders **smaller than life** by
exactly the ratio of the true diagonal to 27:

| the screen someone actually has | what the target pane renders at |
| --- | --- |
| 13.3" laptop | **49%** of true physical size |
| 14" laptop | 52% |
| 16" laptop | 59% |
| 24" monitor | 89% |
| **27" monitor** | **100%** — correct |
| 32" monitor | 119% |

**The default is exactly right for one screen and roughly half wrong for the most common one.** A
tool whose purpose is "see it the way a 1x screen does" is, on a laptop, showing a page at half the
physical size it claims — and saying nothing. That is the case for acting at all; it is not an
argument for any particular one of the three options.

**What the first window shows today** (v0.60.0, cold machine, run `35167885454`, `a3-app` artifact):
an empty state reading *"Point Obsrv at a page to see it the way a 1x screen does."*, a URL field, and
a footer reading `TARGET 1920×1080 landscape · fit ×0.42 · not pixel-exact · Reference (off) · 8-bit`.
Nothing names the diagonal, nothing says the render is at an assumed size, and Settings is reachable
only by the gear icon.

---

### Option 1 — **Ask** on first launch

**What the user sees**, once, before anything else:

> **What size is this screen?**
> Obsrv renders pages at true physical size, and it needs your monitor's diagonal to do it.
> `[ 27 ] inches`   — measure corner to corner, or check the model number
> [ Use 27" ]  [ Save ]

**Code:** a first-run flag in settings, a modal in the renderer, and a path that cannot be dismissed
into an unset state. **Tests:** a spec for first launch showing it, a second launch not showing it,
and the value reaching `settings.json`. `tabs.spec`-style relaunch coverage already exists to copy.

**What could go wrong:** a modal before the user has seen the product is the most expensive thing you
can put in front of a stranger, and the honest answer for many is "I don't know" — at which point they
guess, and a *wrong* number is worse than the default, because it is worn with confidence. It also
cannot be right for a laptop plugged into an external monitor, where the answer changes with the desk.

---

### Option 2 — **Hint** in the first window

**What the user sees** — the footer's existing `not pixel-exact` chip gains a sibling, or the empty
state gains one line:

> Rendering as if this screen were 27″. [Set your screen size] for true physical size.

**Code:** one line in the empty state or one chip in the footer, reading a settings value that already
exists; a link that opens Settings on the display panel. **Tests:** the line is present when the
diagonal is untouched and absent once set — which needs a "has the user set this" bit, since 27 is
both the default and a legitimate answer. That bit is the only real design work in this option.

**What could go wrong:** it can be ignored, which is also its virtue. And it needs the untouched/set
distinction to avoid nagging someone who genuinely has a 27" monitor — without that, it either lies
("you haven't set this" when they have) or disappears for people who need it most.

---

### Option 3 — **Stay quiet**

**What the user sees:** what they see today.

**Code and tests:** none. **What could go wrong:** the case above — half-size renders on laptops, with
the footer stating figures that are internally consistent and externally wrong. This is the option
that keeps the README's *"that one number is what makes Obsrv work"* true only for people who read the
README, which by construction excludes everyone the first window is for.

---

### Recommendation — **option 2**, and this is a recommendation, not a finding

The hint is the only one of the three that tells a stranger the thing they cannot otherwise discover,
without spending the first moment of the product on a question many of them cannot answer. Option 1's
cost lands on every user including the ones who would have been fine; option 3's cost lands entirely
on the people least equipped to notice it.

**Two things I would want settled before anyone builds it**, because they are decisions and not
details:

1. **The untouched/set bit.** Without it the hint cannot be both honest and quiet. It is a new
   persisted field, so it is a contract question, not a UI one.
2. **What it says when a laptop is on an external monitor.** The true answer changes with the desk and
   nothing detects it. The hint may be right to stay silent about that, but it should be a choice.

**Not established:** whether anyone has actually been misled by this. It is inferred from the default,
the arithmetic, and one cold-machine screenshot — no user has reported it, and nobody has counted how
many people run Obsrv on a laptop versus a 27" monitor.

## DECIDED 2026-09-17 by Opeyemi: the **Hint** (option 2)

Given in Wren's session and relayed in room #452, with the memo's two sub-decisions left to
engineering and kept on this card:

1. **The persisted set/untouched bit for the diagonal.** Without it the hint either lies to someone
   who has set 27" or disappears for the people who need it. It is a new settings field, and it is
   the only real design work in the option.
2. **What the hint says on a laptop plugged into an external monitor**, where the true answer changes
   with the desk.

**Owner:** Rook wrote the memo and is out until Saturday, so his cards sit with Henry. **Offered to
Kenya** (room #453) — and, on Opeyemi's word through Wren, *behind* the two raster cards she already
has, not beside them. Whoever takes it states both sub-decisions here before building.

## CLAIMED BY KENYA 2026-09-17: ownership taken from Rook, not borrowed

Rook is out until Saturday, and Wren routed this card behind the raster card. That card is Done (#302,
#310), so my Doing was empty on main before this claim. **The decision is Opeyemi's and it stands: the
Hint.** Below are the two sub-decisions the card leaves to engineering, stated before building as asked.
They were proposed in room #473, and they are **Henry's to veto in review**.

### What the code says, read 2026-09-17 on `3ef11cd`

- `DEFAULT_SETTINGS.hostDiagonalInches` is 27 (`shared/presets.ts:16`).
- `saveSettings` writes the **whole** object (`shared/settings.ts`), so an existing `settings.json` holds
  `hostDiagonalInches: 27` whether or not anyone chose it. The daily update check alone rewrites the file
  through `lastUpdateCheck`. **So a file cannot tell a chosen 27 from the default.**
- The host display is re-read on window `move` and on display added, removed or metrics changed
  (`main/ipc.ts:864-879`), and `calibratedScale` (`renderer/src/state/store.ts`) divides by it. The app
  already knows when the window moves to a different screen.
- `settings.json` is not in `docs/public-shape.json`, so a new field is a contract change for the file
  and the IPC payload (`parseSettings`), not a C2 register entry.

### Sub-decision 1: the set/untouched bit records WHICH display the diagonal was set for

**One persisted field answers both "untouched?" and "wrong screen?".** A boolean would answer only the
first. Its shape depends on sub-decision 2, below.

- **Answering and dismissing are the same act.** The hint has no bare ×. It has two actions, and both
  answer the question: *"27″ is right"* records the display in one click without changing the number,
  and *"Set size"* opens Settings on this display. So nobody is left with a hint that cannot be answered,
  and a real 27″ user sees it once. **Wren's point:** if dismissing did *not* write the field, a
  genuine 27″ user would see it on every launch, which is worse than what it warns about.
- **Old files (no key):** a value other than 27 counts as set, and is **adopted for the display the window
  first opens on, written once and silently** (Henry's #311 review: left unrecorded, it would be "set
  for an unknown display", and the mismatch rule would nag on every screen). Exactly 27 counts as untouched, because `saveSettings` writes the whole object, so the file
  cannot say otherwise. **The cost, stated:** a genuine 27″ user on an old file sees the hint once, and one
  click ends it.
- **The wire shape follows `parseSettings`' convention exactly** (`shared/ipcPayloads.ts`): the key is
  optional, its absence means the pre-feature shape and the comment says so, and an out-of-band value is
  refused rather than coerced. `loadSettings` stays the lenient side for a hand-edited file. This is the
  lesson 0.61.0 paid for with `colorPainted`: a key an older writer never wrote has to be optional, with
  its absence given a stated meaning. `tests/e2e/ipc.spec.ts:197` pins the exact settings key set and
  changes with it.

### Sub-decision 2: a laptop on an external monitor. A CHOICE, recommended below, for Henry's call before code

**Why this reopens what #311 approved.** Henry approved the single-field version (now (a)) in #311. The
table below was pushed to #311's branch after it merged, so it never reached main, and it came from
Wren's read of what a single field costs someone who docks daily. It is here for his call, not assumed.

The app already knows when the window moves to a different display (`ipc.ts:864-879`). What it does
with that is a choice, and it changes the field's shape:

| | **(a) one diagonal, the hint names the mismatch** | **(b) one diagonal per display (recommended)** |
| --- | --- | --- |
| field | `hostDiagonalFor: { physicalWidth, physicalHeight } \| null` | `hostDiagonals: { physicalWidth, physicalHeight, inches }[]`, bounded to the most recent 8 displays |
| someone who docks daily | asked again at **every** switch, and the render **is** wrong after every switch, because one number cannot fit both screens | asked **once per display**, and after that each screen renders at its own size |
| what the hint's silence means | "the screen the diagonal was set for", which is not "this render is right" | **"this render is at true size"** |
| a bound on the nag | only by hiding it, which makes the silence lie | not needed: the hint stops because the answer is right |

**Recommendation: (b).** Bounding (a) (once per display, or up to N) would leave a render that is wrong
with nothing saying so, and that is the silence this card exists to remove. (b) is the only shape where
the hint going quiet is true. The Settings section is already titled *"This display"*, so the UI already
describes the diagonal as a property of a screen. `hostDiagonalInches` stays as the value for a display
not yet in the list, so the wire shape older code reads is unchanged.

**What (b) changes beyond a hint, stated so it is chosen rather than slipped in:** moving the window to a
known display changes the magnification automatically (`calibratedScale` reads the entry for the current
display). That is a behaviour change to the diagonal setting, not only a new chip. If Henry judges it
Opeyemi's call rather than engineering's, it goes to Opeyemi, and (a) is the fallback, with its costs
above.

**A limit either way:** two displays with the same physical resolution but different sizes cannot be told
apart.

### Placement: a footer chip, not the empty state

The chip sits beside `fit ×… · not pixel-exact` in `PaneFooter`. The external-monitor case happens with a
page already loaded, when the empty state is gone. Whether the chip also shows in the empty state is a
detail for the build.

### Acceptance, each with a control

- **no code until Henry has chosen (a) or (b)** and this card says which;
- the hint is present with the diagonal untouched for this display, and absent once answered.
  **Control:** a test that forces the field to match reds if the hint still shows;
- *"27″ is right"* records the display without changing the number, and it is the hint's only dismissal;
- under (b), moving to a known display renders at that display's diagonal, and an unknown display shows
  the hint. Under (a), a mismatched display shows the wording with both resolutions named;
- the migration: an old file with 27 counts as untouched, and an old file with 13.3 counts as set. Unit tests on
  `loadSettings` and `parseSettings`;
- **an old file with a non-default diagonal shows no hint on the display it first opens on** (Henry, #311
  review). The legacy value is adopted for that display, written once and silently. The mismatch wording
  (a), or the hint for an unknown display (b), fires only after a real display change. Without this, a
  laptop user who correctly set 13.3 would be told their screen does not match a screen nobody recorded;
- desk-safe tests only: renderer state and a `hostChanged` push, no window fronting.

