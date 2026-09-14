---
title: "The parity gate cannot tell a live exemption from a forgotten one"
column: done
kind: bug
criterion: C4
owner: "obsrv-a6"
order: 12
---

Merged a5c1a3c and pushed 2026-09-14 (commits d69b2c1 + cbe4981, rebased onto 1d4e505).

The gate failed when a difference had no reason; nothing failed when a reason had no difference, so a row meant either 'still diverges, here is why' or 'nobody removed it'. The head of EXPLAINED already claimed the table 'cannot go stale without going red' — now true, and self-pruning: closing a divergence forces its exemption out.

VERIFIED four ways, and again after the rebase:
  clean table                      -> 12 passed (twice)
  planted stale row                -> RED, naming tool, field and reason
  planted row for a tool never run -> quiet (the guard holds)
  filtered run, nothing compared   -> fails loudly, 'nothing to check'

The fourth exists because the first verification attempt was wrong: with -g the per-page tests never populate `rows`, so a planted stale row came back green. cbe4981 makes that loud.

obsrv-e7 wrote the same fix concurrently and discarded it: its version had no answeredBoth guard, so a tool that errored everywhere would have had every exemption called stale.

CAVEAT ON THE MERGE, recorded because it is the day's own lesson: pushed while CI on the base (1d4e505) was still running. Local green was the only evidence, and local green on this machine is exactly what proved insufficient an hour earlier — see the 'agreement that fits two facts' card. If CI on a5c1a3c is red, check 1d4e505's own run before attributing it here.

NOT observed: `answeredBoth` returning false for a row carrying an error. The branch it feeds IS observed; the predicate has not been seen to fire on a real error.
