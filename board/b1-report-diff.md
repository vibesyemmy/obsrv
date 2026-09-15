---
title: "Run 18: exercise report and diff, the two surfaces run 17 excluded"
column: doing
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
