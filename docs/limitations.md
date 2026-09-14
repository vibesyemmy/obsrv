# What Obsrv cannot do

Obsrv's value is that it tells you the truth about a 1x screen. A tool like
that is worth less than nothing if you cannot tell where its truth stops, so
this page is the boundary, stated plainly and kept current.

Everything here is measured rather than assumed. Where a figure appears, it
came from a run, and where something has never been checked, this page says
so rather than implying it is fine.

**Read this first if you are deciding whether Obsrv fits your problem.** The
short version: it is macOS-only, the app is unsigned, and it measures what a
page *is* rather than what a page *does*.

---

## Before you install

### macOS only

There is no Windows or Linux build, and none is planned. This is not an
oversight — the product *is* macOS Chromium's rasterisation, and a build on
another platform would rasterise differently while claiming the same
authority. The CLI and MCP server have the same constraint: they drive the
same Electron.

### The app is not signed or notarised

Every DMG says **"Obsrv is damaged and can't be opened"** on first launch.
It is not damaged; macOS refuses to open an unsigned app downloaded from the
internet. Clear the quarantine flag:

```bash
xattr -cr /Applications/Obsrv.app
```

Or skip the app and install the command line, which is unaffected:

```bash
npm i -g getobsrv
```

Signing is blocked on an Apple **Developer ID Application** certificate. Until
that lands, you are being asked to override a security warning on our word,
which is a real cost and is why it is at the top of this page rather than in a
footnote.

### The app tells you about a new version but will not install it

It checks GitHub once a day and offers the release page. You update by hand.

---

## What the measurement does not see

### Anything inside an `<iframe>`

The measurement does not cross into frames. A page that is mostly an embedded
app measures as nearly empty, and a consent wall in an iframe can cover the
whole page. Obsrv names both cases rather than reporting a confident zero —
when a frame covers the viewport, the warning says so and gives the coverage.

### Anything inside an open shadow root

Web components keep their content in shadow roots, and the measurement does
not enter them. A page built from components can measure as almost nothing.
Obsrv counts what it did not enter and says so: *"N roots hold M of this
page's K elements, which the measurement does not enter."*

Whether it *should* enter them is undecided, and the evidence for deciding is
still being collected.

### A page it cannot scroll

Before measuring, Obsrv walks the page — scrolls to the end and back — so lazy
images load and late sections mount. Some pages cannot be walked: a modal's
scroll lock, a consent layer that fixes the body, an app shell that scrolls a
container rather than the document. Obsrv distinguishes these and names each
one, including telling you when what it scrolled was a dialog rather than the
page. But **the figures are still of what it could reach**, and the warning
tells you how far that was: *"the page measures 8,048 CSS px (11 screenfuls);
the walk reached the first 768 px of it."*

Read that sentence when you see it. It is the difference between a measurement
of a page and a measurement of its first screen.

---

## Where the numbers stop being exact

### `lint` cannot see a sub-pixel border

Chromium snaps `border-top: 0.5px` up to a whole device pixel at style time,
so it is 1px by the time anything can measure it. That is a Safari and Firefox
question, not one Obsrv can answer. A hairline drawn as an element's own
height, or as a box-shadow, it does see.

### `diff` is 1x-only, and informational

Presets above 1x exit with an error, and so do CSS viewports over 2,048px —
which is the 4,096 px capture cap below, divided by the 2x reference `diff`
renders alongside the target. Its findings carry no thresholds of their own —
apply your own judgement. It also
cannot tell you *"the hairline vanished"*: a 0.5px hairline renders as one
device row at 1x and at 2x alike. It reports ink deltas and row ratios;
vanishing is judged by reading the PNG.

### Panel profiles are approximations

`budget-tn`, `office-ips` and the rest are principled models built on
documented transfer curves. They are not colorimetry of one specific panel,
and they should not be quoted as if they were.

### The millimetre thresholds are provisional

7 mm for tap targets and 2 mm for text are the defaults, and both are tunable.
They are **not** calibrated against a published standard, and nothing yet
records what they were chosen from. Treat a finding as "this is small on this
screen, in millimetres" — which is exact — rather than as "this fails a
standard", which is not a claim Obsrv is currently entitled to make.

### Captures cap at 4,096 device pixels

Past that the capture is clamped, and it says so when it clamps. On a tall
page, `--full-page --tiled` captures it a screenful at a time and stitches the
bands instead, which has no such ceiling.

---

## Pages that move

Obsrv measures a page at a moment. Pages that keep changing are the hardest
case, and the honest account has three parts.

**What it catches.** `audit` and `lint` measure the page twice, 250 ms apart,
and tell you what moved: *"35 of the 901 elements re-measured had moved, by up
to 26 CSS px."* When you see that, the finding coordinates are of one moment
and a repeat run will not agree on them.

**What it does not catch.** The probe sees motion *during its window*. A
carousel that steps every few seconds passes it: on stripe.com a 250 ms window
found 30 elements moving 18 px, while a 4-second window found 231 moving over
10,000 px. **The absence of that warning is not a promise that the page is
still.**

**What this means for a before-and-after.** This is Obsrv's main use — change
the CSS, run it again, read the difference — so it is worth being precise
about what the difference contains. Measured on 2026-09-14, five runs each:

| page | what changed between runs |
|---|---|
| a local fixture | **nothing** — 0 of 3,375 fields, on a quiet machine and a saturated one |
| berkshirehathaway.com | **nothing** — 0 of 49 fields, over the real internet |
| bbc.com/news | page height and element counts; it served different headlines |
| stripe.com | finding coordinates, by up to 438 px; its carousel was rotating |

On all four, the counts you would act on — how many findings, how many
elements under the threshold — held on every run. **Obsrv does not drift on
its own.** What moves on a live site is the site. That is worth knowing in
both directions: a difference you see between two runs of a real page may be
the page, and the way to tell is to run the same check against a local copy.

The full method and figures are in
[`docs/research/2026-09-14-b5-repeatability.md`](research/2026-09-14-b5-repeatability.md).

---

## Capacity

The MCP server runs at most two headless renders at once
(`OBSRV_MCP_CONCURRENCY` raises it). Each is its own Electron, and nine in
parallel starved two of them past their load budget. Further calls queue in
order; one that waited over a second says so. A long wait can hit your
client's own request timeout, so fan out in twos.

---

## Known gaps we have not closed

Listed because a limitation you have not been told about is worse than one you
have:

- **A dialog's note has never fired on a live site** across four runs, though
  it fires reliably on a fixture. Either live pages of that shape are rarer
  than expected, or something about them differs from the fixture.
- **The noise ratio has never been measured.** zalando.de answered 143
  findings; nobody has established how many of those a developer would act on.
  Until that exists, treat a long findings list as a list to read, not a
  backlog to burn down.

Both are tracked in [`docs/readiness.md`](readiness.md), which is the full
register of what stands between Obsrv and a version worth recommending
without caveats.

---

## What this page does not cover

- **What an agent can do to your machine** when agent control is on — the
  control surface, the consent bar, and how to turn it off.
- **What leaves your machine**, and where files are written.

Both are owed their own sections and do not have them yet. Nothing is uploaded
anywhere; PNGs, report HTML and logs are written locally, some under
`os.tmpdir()`. That is the short answer until the long one is written.
