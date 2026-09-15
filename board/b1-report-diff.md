---
title: "Run 18: exercise report and diff, the two surfaces run 17 excluded"
column: done
kind: readiness
owner: "Rook"
criterion: B1
order: 19
---

**GO-AHEAD FROM OPEYEMI 2026-09-15. Rook starts.**

**Two things carried over from `b1` that should shape the site list before anything is run.**

The two shapes run 17 planned and did not reach are *a retail image grid* and *a docs site with
a sticky sidebar*. Both are named rather than incidental: an image grid is where `diff`'s ink
deltas and row ratios have the most to say, and a sticky sidebar is a non-host scroller, which
is the shape that produced 48 unpinnable findings once already. Starting there spends run 17's
own planning rather than re-deciding it.

**And `b1`'s rule about sites, which applies with more force to a report run:** *fresh sites,
not the ones previous runs used, or the run measures whether known defects are still fixed
rather than whether unknown ones exist.* `report` composes snap, audit, diff and lint into one
page, so running it over a site a previous run already combed produces a document full of
findings somebody has read before — which reads like coverage and is recognition.

**What B1 actually asks, since this card is a piece of it:** B1 is met when a run finds
*nothing* user-visible. Runs 13 through 16 each found something, each smaller than the last.
So the honest deliverable here is either new cards or the sentence *this run found nothing
user-visible in report and diff*, which nobody has yet been able to write about any surface.

**This is the successor to `b1`, scoped to the half of it that is documented rather than merely
unexamined.** Run 17 ended with, in its own words: *"NOT COVERED, stated rather than assumed:
two of eight planned sites; obsrv_report and obsrv_diff not exercised at all; nothing run live
in the app — this run was headless throughout."*

**Rook asked for this one, and the reason it gave is the reason it is the right card:** run 17
*excluded* report and diff explicitly and said so, which makes this the only gap on B1 that is
**documented rather than merely unexamined**. An unexamined gap might be fine. A documented one
is a promise somebody made to check later.

**Rook is still cold on exactly these two and no longer cold on the rest**, which is a narrower
qualification than run 17's and should be spent before it expires. Run 17 made Rook a reader of
`audit` and `lint` output. It left `report` and `diff` untouched, so the cold-reading argument
from `b1` — *the warnings ARE the product, and the way to check a sentence is to have a peer
read it cold* (`docs/read-the-output-not-the-code`) — still applies here and will not apply
again after this run.

## What this card does NOT close, so nobody reads it as B1 met

Two of eight planned sites, and **anything live in the app**. Run 17 was headless throughout;
this run is scoped to two surfaces, not to the criterion. B1 stays open after this lands, and
saying so here is cheaper than discovering it from a readiness table that overstates.

## The trap this card is most likely to die of

**Running the tools is not exercising them.** A run that invokes `obsrv_report` and
`obsrv_diff`, gets output, and reports "covered" has measured that the commands exit zero. The
product is the sentences they produce, and the question is whether a developer reading them
cold would act correctly. Run 17's value was reading, not invoking.

**So pre-register the vacuity check, which is house style now** (`CONTRIBUTING.md`, from
Kenya's cache experiment): before running, name the result that would mean *this run did not
exercise report and diff*. Candidates worth deciding in advance — a report whose findings
sections are empty on every site, a diff that errors on every page for a reason unrelated to
the page, or a run where every finding read was one `audit` had already produced and `report`
merely re-displayed.

## Known limits, verified in the code rather than recalled, so a limit is not filed as a bug

- **`diff` is 1x presets only.** Dense presets (phones) and CSS viewports over 2048px exit with
  an error — `src/mcp/server.ts:1201`. That error is correct behaviour; whether it *reads* as
  correct behaviour to someone who hit it by accident is exactly the kind of thing this run is
  for.
- **Device pixels are capped at 4096 per axis**, so a tall full-page capture is clamped and the
  CSS budget shrinks as density rises — `src/mcp/server.ts:275` and `:299`.
- **`diff` on an animating page compares two different frames.** Check `settled` in the output:
  when false the band deltas are frame-to-frame noise, and the findings are supposed to say so
  rather than interpret them. Whether they do is a finding.
- **`diff` cannot say "the hairline vanished".** It reports ink deltas and row ratios; a 0.5px
  hairline renders one device row at 1x *and* 2x. Vanishing is judged by reading the PNG, and
  the output should not imply otherwise.

## The standing hazard that has cost two sessions a false result

**Build before running.** `npx playwright test` and the MCP tools run the built `out/`, not
`src/`. Two false failures in one evening came from this, both plausible-looking. If something
surprises you, check the build before you check the code.

Constraints are Rook's own and unchanged: own worktree off current main, Review rather than
main, merge on Opeyemi's word direct to Rook, design to him before writing.

INTO REVIEW 2026-09-15, branch `chore/b1-report-diff`. Write-up: docs/research/2026-09-15-live-run-18.md. Built first, per the standing hazard.

**THE PRE-REGISTERED VACUITY CHECK PASSED: the run exercised both surfaces.** uniqlo gave 21 audit and 1 diff finding at laptop-768; diff completed on two pages and refused a third for a stated reason; all three findings quote sentences no other surface emits. Naming that condition before running is what makes the result mean anything.

F1 — `diff` INVALIDATES ITS BAND DELTAS AND LEAVES ITS HEADLINE NUMBERS STANDING. On an unsettled page it says "the band deltas below are frame-to-frame noise, not evidence about rasterisation" — while `inkCoverage.delta` (-0.0991) and `rows.ratio` (0.4934) print ABOVE that sentence and are comparisons between the same two mismatched frames. A static control settles it: settled true, findings empty, and those two numbers print in exactly the same shape. The only thing separating "these mean something" from "these are noise" is one sentence that names the bands alone — and not the two numbers a person would quote.

F2 — THE REPORT'S CENTRAL IMAGE IS ALTERED AND THE SENTENCE SAYING SO IS THE ONE THAT NEVER REACHES THE ARTEFACT. Every report prints "hid chrome stuck to the viewport for the bands after the first: ..." to stderr — on uniqlo, two fixed elements totalling 160 CSS px removed from every band after the first of the capture the "Where the problems are" overview is built from. It is absent from the HTML, absent from screens[].warnings, and therefore absent from any MCP caller's reply. Mechanism, exact: warningSink's `warn()` pushes to the machine list AND prints; `human()` only prints. The truncation warning beside it uses `warn` and DOES reach the HTML — verified on the same page — so the artefact renders its warnings faithfully and this one simply never joins them. On docs.astro.build the consequence is starker: warnings is [] for both screens while stderr carried two sentences each, and an empty array reads as "nothing to say about this capture".

F3 — "full page: warning: full page is 10374 CSS px tall..." — the warning already begins "warning: full page is" and the report prefixes "full page: ". Says it twice, carries a bare "warning:" mid-sentence, and is in the HTML where a designer reads it.

WHAT HELD, and it is most of the run: both documented diff limits refuse correctly, explain themselves in terms someone who hit them by accident would act on, exit 2 (the documented ArgError code) with empty stdout. `report` names the comparison it did not do (`diffSkipped`, and the same sentence in the HTML rather than an empty section). The motion warning is a model sentence.

ONE MEASUREMENT ERROR OF MINE, recorded because it is tonight's recurring one: I first read those exit codes as 0, having taken `$?` after a pipe into `tail`. Re-measured without the pipe: 2. Third instance of the same family in one session.

WHAT THIS DOES NOT CLOSE: B1 stays open. Two surfaces, not the criterion — nothing live in the app, run 17's remaining sites unvisited, and whether the overview's pins and crops LAND where the findings are was not checked, only whether the page explains what it could not locate.

F2 IS WORSE THAN RUN 18 FRAMED IT, found by Henry after the write-up and verified here in the source: docs/compatibility.md's contract 4 says "Human-readable text on stderr is not a contract ... if you are parsing it, parse the JSON instead." So the only place the stuck-chrome fact appears is the one place the policy INSTRUCTS callers to ignore, and an MCP client never sees stderr at all. A caller following Obsrv's own documented advice cannot learn that 160 CSS px were removed from every band of the image its findings are pinned to. That makes F2 a correctness problem for every MCP caller rather than a reporting gap with a documentation angle.

**THE THREE FINDINGS NOW HAVE CARDS, filed by Henry at merge**, because this card is closing and
`b1`'s own standard is *either new cards or the sentence that the run found nothing*. Three
verified defects living only on a done card and in a research document is a record kept where
nobody reads it, which is this week's defect applied to its own findings.

- `bug-report-edit-invisible` — F2, and the serious one. A correctness problem for every MCP
  caller, not a reporting gap.
- `bug-diff-disowns-its-numbers` — F1.
- `bug-report-doubled-warning-prefix` — F3.

Each names what a fix has to decide rather than the one line to change, because all three are
instances of a class and fixing the instance ships the class.

**Rook's coldness on `report` and `diff` is spent, and it said so unprompted:** *"whatever runs
them next should be someone else."* Recorded here so the next router does not re-spend an asset
that no longer exists. Still cold: presets/calibration/panel simulation, and the live app.

**And the step Rook named as the one it skipped, which is worth more than the findings:** it read
the code and the output for two hours and did not think to read `compatibility.md` — a document
it had read twice that same day — against the behaviour. That omission is what kept F2 looking
like a reporting gap. *Reading the thing under test against the thing that says how it must
behave* is now a step to plan for rather than to remember.

MERGED 2026-09-15 on Opeyemi's word, `6f35647` (PR #9). Column moved here rather than in the
merge commit, batched onto the next board change instead of spending a fourteen-minute suite on
a one-word frontmatter edit — which is what a required check costs for bookkeeping now.

Second time tonight a card merged while sitting in Review; `b4` was the first. The convention is
that a card closes in the commit that merges it, and with direct pushes to `main` gone that
convention now has a price attached. Worth noticing rather than absorbing: if closing a card
costs a suite, cards will stop being closed.
