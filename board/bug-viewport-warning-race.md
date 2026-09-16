---
title: "The viewport-units warning races the reflow, and on a slow runner says nothing about the layout it exists to catch"
column: done
owner: "Henry"
kind: bug
order: 42
---

FILED 2026-09-16 by Wren, from Henry's reading of PR #30's red. **Unowned.** Found while
checking whether #30 was at fault; it was not — #30 adds a script and a `package.json` entry.

## The defect

`obsrv snap` warns when a page *"lays out against the viewport height"* — a page sized in
viewport units that a full-page capture would stretch. The warning is guarded, correctly: the
surface is grown and the page re-measured, and *"only a page that actually moved is warned
about"* (`tests/e2e/cli-snap-tiled.spec.ts:69`).

**On a loaded machine the re-measure can beat the reflow.** It then finds nothing moved, and the
warning stays silent — about exactly the layout problem it exists to report.

## Evidence, and what was checked rather than reported

- **Run `35075624029`, attempt 1, PR #30 — read from the log:** `cli-snap-tiled.spec.ts:65`
  failed **both** tries (✘ 82, ✘ 83), `expect(warned).toMatch(/lays out against the viewport
  height/)` at line 74, **`Received string: ""`** — no warning at all.
- **Flaky on PR #15 this morning** (✘ then ✓) — Henry's report; not independently re-read.
- **Not #31's doing, which was the first suspicion** since #31 had just rewritten warning
  routing. Henry checked: the sentence is emitted by `warn(` before and after #31; only the
  `warning: ` prefix changed, and the test matches content, not prefix. #30 was also based on
  pre-#31 `main`.

## Why it matters beyond a flake

It is a **product warning that is silent when it should speak** — the same family as
`bug-report-edit-invisible`, arriving by a race instead of a routing choice. And it has a
precedent in this project: `unsettledReason: 'resizing'` was a label decided by a race too.

A silence here fits two opposite facts — *the page does not lay out against the viewport*, and
*the re-measure ran before the page reflowed* — and nothing in the output tells them apart.

## The trap for whoever takes it

**Do not fix this by loosening the test.** The test is correct to demand the warning; the product
is what fails to produce it. A fix that makes `:74` tolerate `""` would turn a caught race into a
permanent silence.

The question to answer first is what "the page moved" should be measured *against*: a single
re-read after growing the surface is a sample, not a settle. Whatever replaces it must itself be
shown to produce the warning on a loaded runner — a green on a fast laptop is the agreement that
fits two facts, and this card exists because that is how it survived.

## RESOLVED 2026-09-16 by Henry — the re-measure waits on the page, and the race is reproduced on purpose

**Measured against what, as the card asked first:** against the page having the taller surface. A
full-page capture grows the surface with `setViewport`, and the resize reaches the page some time
after that call returns. The re-measure ran on the very next line. **Now it reads the page's own
`innerHeight` before growing and polls until the page reports a different one** (every 25 ms, for up
to 2 s), and only then asks for `scrollHeight`. It waits on a fact, not a sleep.

**And no silence if it never comes:** a page that hasn't taken the surface within 2 s gets *"the page
had not taken the N CSS px surface within 2 s, so whether it lays out against the viewport height was
not measured"*. It doesn't claim either way.

**Shown on a loaded runner, as the card required, and not by hoping for one:**
`OBSRV_TEST_RESIZE_DELAY_MS`, read only under `OBSRV_TEST`, delays a resize after the first
navigation. That's a product change made for a test, and it says so, following #59's delay hook.
**On `main`'s `cli/main.ts` with a 600 ms delay, the warning came back `Received string: ""`**, the
signature of run `35075624029`, reproduced deterministically. The existing test passed beside it,
which is how this survived.

**Tests:** `cli-snap-tiled.spec.ts`, *the viewport-height warning waits for the page to take the
taller surface, however slow the resize*. With a 600 ms delay the warning is present and the
not-measured sentence is absent. With 3000 ms, longer than the wait, the not-measured sentence is
present and no claim is made. **Fix:** the whole file 16/16. **Control:** failed at `Received string: ""`.
**The test was not loosened:** `:74`'s demand for the warning stands.
