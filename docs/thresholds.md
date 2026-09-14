# The thresholds, and what would move them

Obsrv's findings are judgements with numbers behind them. A reader who cannot
see where a number came from can only agree or disagree on taste, which is not
a conversation worth having — so this page gives each one the same three
answers: **what it derives from**, **what it was calibrated against**, and
**what would move it**.

They are not all the same kind of number, and the difference matters more than
any individual value:

| Kind | Argue about it with | Which ones |
|---|---|---|
| **From a published standard** | W3C, not us | contrast ratios, large-text sizes |
| **Calibrated against real output** | Us, with counter-evidence | shadow share, page motion |
| **Calibrated late** | Us, with counter-evidence | thin text (swept 2026-09-14) |
| **Definitional** | Nobody; it is arithmetic | sub-pixel edges |

Every judged number now has something under it. The one with the least is
**tap targets at 7 mm** — not because it is arbitrary, but because the
platform guides it sits between do not publish their own evidence either.

---

## Tap targets — 7 mm on the shorter side

**Derives from** the two platform guides, which disagree: Apple's 44 pt is
**6.9 mm** on a 163 ppi screen, Google's 48 dp is **9 mm**. WCAG 2.5.8's 24
CSS px is the legal floor and says nothing about millimetres at all — a CSS
pixel is not a length. 7 sits just above Apple and well below Google,
deliberately: it is the lower of the two real guides, so a finding means "even
the more permissive platform would call this small".

**Calibrated against** seven public pages at `android-65` and `1080p-24`,
measured 2026-09-02 — the table is in [docs/audit.md](audit.md#what-the-defaults-do-on-real-pages-measured-2026-09-02).
The result is uncomfortable and worth stating: Hacker News is 30 of 30 under
7 mm, GitHub 36 of 38, Stripe 120 of 162. That is not the threshold
misfiring. A 32 CSS px icon button is 6.0 mm on that phone — under every
platform's minimum — and most of the web is built from them.

**What would move it:** evidence that 7 mm is not where hit rates fall off for
real thumbs. Nobody has run that study, and neither Apple nor Google publishes
the data behind theirs. Until someone does, the defensible claim is the
millimetres, not the line — which is why the audit orders smallest-first and
prints the figure for every finding. Override with `--tap-mm` / `tapMm`;
`--tap-mm 6` roughly halves the phone findings, `--tap-mm 4.5` is about WCAG
2.5.8's 24 CSS px on that phone.

---

## Text — 2 mm of font size

**Derives from** nothing published: no standard states a floor in millimetres.
2 mm is about **11 px on a phone** and **7 px on a 1080p monitor**.

**Calibrated against** the same seven pages, where it is quiet almost
everywhere — 0 findings on six of the seven, 124 of 420 on Stripe. That
silence is the evidence for it, and also the evidence that it is set
conservatively: a threshold that fires on fine print and nothing else is
deliberately below the line where most people would start arguing.

**What would move it:** a reading-distance model. 2 mm at arm's length on a
monitor and 2 mm at 30 cm on a phone are not the same angular size, and this
threshold ignores that — the honest limitation of a single millimetre figure.
Override with `--text-mm` / `textMm`.

---

## Thin text — 14 device px, for weights under 400

**Derives from** the mechanism rather than a measurement: light strokes
approach one device pixel and go grey and broken. 300-weight at 12 px is 12
device px on a 1x monitor and 24 on a 2x phone, so the same CSS breaks on one
screen and not the other — which is the rule's whole point.

**Calibrated 2026-09-14**, on nine public sites — the seven the tap-target
table used, plus vercel.com and linear.app, added because the first pass
produced almost everything from one page and a calibration resting on one page
is not one. Both extra sites are design-forward marketing pages of the kind
that reaches for light weights: chosen to give the rule its best chance of
firing, not its easiest silence. Viewports are stated in pixels rather than by
preset id, because `--orientation` names which *stored* form to use and a
preset id alone does not pin the screen.

**1920×1080 @1x** — findings at each candidate threshold:

| Page | <10 | <12 | <14 | <16 | <18 |
| --- | --- | --- | --- | --- | --- |
| stripe.com | 28 | 224 | **226** | 248 | 370 |
| linear.app | 0 | 0 | **0** | 4 | 4 |
| wikipedia, github, bbc, hn, mdn, guardian, vercel | 0 | 0 | **0** | 0 | 0 |
| **sites firing** | 1/9 | 1/9 | **1/9** | 2/9 | 2/9 |

**360×800 @2x: zero on every site at every threshold** (bar 4 on stripe at 18).
That is the rule working, not failing — at dsf 2 a 12 px font is 24 device px,
above every candidate. The same CSS breaking on a 1x monitor and not on a 2x
phone is the rule's whole premise, and this is it, demonstrated.

Three things follow, and the second is the one that defends the number:

**The rule is quiet.** At 14 it fires on **one site in nine**. Whatever B4's
noise turns out to be, this is not where it comes from — which is the opposite
of what this page predicted before the sweep was run.

**14 sits on a plateau, not a cliff.** What stripe flags clusters entirely at
**8–11 px, every one of them weight 300** — 127 at 10 px, 45 at 11 px, 23 at
9 px, 5 at 8 px — and there is essentially nothing between 12 and 14 px:
moving the threshold from 12 to 14 adds **two findings**. Real pages do not
put light text at 12–14 px; they put it at 8–11 or at 14+. So the exact
position of the line barely matters, which is the next best thing to being
derived. That is a defence of 14 nobody had before, and it is not "14 is
right" — it is "12 through 15 are the same answer".

**It is not insensitive everywhere.** linear.app crosses between 14 and 16, so
a site can sit exactly on the line even though stripe does not. The plateau is
stripe's, not the web's.

**What it catches looks real.** The smallest are `div "or"` / `"oder"` /
`"または"` at 8 px weight 300 — language-switcher labels at eight device pixels
of light stroke. Nobody would defend those as legible on a 1x monitor.

**What would move it:** a site that fires between 12 and 15, which would turn
the plateau into a real choice — linear.app is the near miss. Failing that,
the case for lowering to 12 is that it drops two findings and nothing else;
the case for 16 is that it picks up linear's four. Neither is compelling on
this evidence, which is the argument for leaving 14 where it is. Override with
`--thin-px` / `thinPx`.

---

## Contrast — 4.5:1, or 3:1 for large text

**Derives from** WCAG 2 AA, unchanged: 4.5:1 for body text, 3:1 for large
text, where large is 24 px or 18.66 px bold. These are not our numbers and we
do not tune them.

**Calibrated by** the W3C, whose reasoning is published with the standard.

**What would move it:** a new version of WCAG. If you disagree with 4.5:1,
that argument belongs upstream — reporting a different figure would make
Obsrv's output incomparable with every other accessibility tool, which is a
worse outcome than a threshold you dislike.

**The judgement we *do* make** is the second figure. `contrast-on-panel`
applies the same WCAG ratios *after* a panel's transfer curve, so the
threshold is borrowed and the **panel profile** is ours: `#767676` on white is
4.54:1 on the display it was designed on and under 4.5:1 on Budget TN. What is
arguable there is the profile, not the ratio — and the profiles are
principled approximations from documented transfer curves, not colorimetry of
a specific panel, as [the limitations page](limitations.md) says.

---

## Sub-pixel edges — under 1 device pixel

**Derives from** arithmetic. An edge under one device pixel cannot be drawn as
a full pixel; that is what "sub-pixel" means.

**Calibrated against** nothing, because there is nothing to calibrate. The
number is 1 because pixels are whole.

**What would move it:** nothing. The judgement this rule *does* carry is what
it cannot see — Chromium snaps a `border-top: 0.5px` up to a whole device
pixel at style time, so borders are 1 px by the time anything can measure
them, and the rule only sees hairlines drawn as an element's own height or as
a box-shadow. That is a limit, not a threshold.

---

## Shadow share — 15%, and at least 3 hidden, and at most 25

Three numbers that together decide whether the tool says "a component library
is hiding part of this page from the measurement".

**Derives from** a reader's needs rather than a standard: at what point does
what the measurement could not enter change how the figures above it should be
read?

**Calibrated against real output**, and the method is recorded in
`src/shared/shadowShare.ts`: the sentence was printed at every shape either
side of the line — 1.9%, 3.8%, 7.7%, 15.4%, 23%, 50%, 77% — including the
ones it suppresses. At 7.7% (4 of 52) the reader's figures are materially
right; at 15.4% (8 of 52) one control in six could not be measured, which
changes the reading. That is the line, chosen against output rather than
against a round number.

The other two exist because a share alone lies at both ends. Below **3**
hidden it is arithmetic, not a finding: 2 of 4 is 50% and reads as half a page
unmeasurable when it is a four-control page with one widget. Above **25**
hidden a share is the wrong measure on a large page. The conditions are ANDed.

**What would move it:** a page shape where the sentence fires and the reader
did not need it, or stays quiet and they did. The method for re-deciding is in
the source and is cheap to re-run.

---

## Page motion — 250 ms apart, 1 CSS px of movement

**Derives from** measurement, not reasoning. `audit` and `lint` measure the
page twice and report what moved.

**Calibrated against** stripe.com at 0, 250, 1000, 2000 and 4000 ms
(2026-09-14, `src/shared/pageMotion.ts`):

| gap | elements moved | furthest |
|---|---|---|
| 18 ms | 28 / 916 | 1.0 px |
| 271 ms | 30 / 916 | 18 px |
| 1020 ms | 31 / 916 | 83 px |
| 4024 ms | 231 / 914 | 10,156 px |

Back-to-back is not enough — the same page answered 28 moved on one run and 0
on another, because what creeps had not yet crept a whole pixel. The 1 px
floor is sub-pixel jitter: a re-measure of a still page differs in the last
decimal place, a carousel moves by hundreds.

**What would move it:** the 4-second row. A longer window sees far more, and
the current one cannot see a carousel that steps every few seconds — so the
note's absence is not a promise the page is still, which
[the limitations page](limitations.md#pages-that-move) states. A longer probe
would cost every run that time; nobody has decided that trade is worth it.

---

## The caps are not thresholds

`AUDIT_MAX_TARGETS` (2000), `AUDIT_MAX_TEXT` (3000), `LINT_MAX_TEXT` (3000),
`LINT_MAX_EDGES` (2000), `LINT_MAX_IMAGES` (500) and the 200-finding list cap
are budgets, not judgements about a page. They exist so a pathological page
cannot hang the measurement. They change **what you are told** rather than
what is true, so every one of them says so when it bites: the output counts
what it cut.

`LINT_SPACER_MAX_PX` (2) is the one cap that *is* a judgement — raster files a
pixel or two on a side are spacers, never judged as images, because
paulgraham.com put 332 of them in the upscaled rule and 206 more past the
image cap. A tiny file a lazy loader is still to fill is a placeholder, not a
spacer, and stays in the rules.

---

## What this page is for

Every one of these is exposed on the command line and stated in the output, so
a team can set its own and a reader can see what was applied. That was always
true; what was missing was the ability to *disagree on a ground other than
taste*.

**Thin text was the weak one and is no longer**: it was swept the same day this
page was written, across nine sites, and came back quiet and insensitive in
its own neighbourhood. The prediction on this page — that it would be B4's
largest source of noise — was wrong, and the sweep is what said so.

What still deserves work rather than defence is the **tap-target** figure: 7 mm
rests on platform guides whose own evidence Apple and Google do not publish,
and no study anyone can cite says hit rates fall off there. That is not a
reason to ignore it — a finding still carries the millimetres, which are exact
— but it is a reason to read a count as a starting point rather than a verdict.
