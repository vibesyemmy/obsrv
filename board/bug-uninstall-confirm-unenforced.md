---
title: "obsrv uninstall --remove deletes a generically-named file without checking it's actually Obsrv's"
column: backlog
kind: bug
criterion: C5
order: 100
---

FOUND BY KENYA 2026-09-20, building the end-to-end test for `chore-uninstall-remove-end-to-end`.
Measured with a real file, not read from the source alone.

`Removal.confirm` (`src/shared/uninstallPlan.ts`) documents a safety property for the three
generically-named files inside the **shared** `~/Library/Application Support/Electron` directory —
`history.json`, `settings.json`, `tabs.json` — that another, unrelated Electron app could also have
written:

> What must be true of the file's **content** before it may be claimed as Obsrv's... So those three
> carry a check and the command must apply it before removing them: if the file does not parse as
> Obsrv's own, it is named and kept.

**Nothing applies that check.** `entryOf` (`src/shared/uninstallReport.ts`) copies `confirm` onto the
report entry as a string for display only (`"claimed only if it parses with Obsrv's history reader"`)
and never calls a parser. `removeListed` (`src/shared/uninstallRemoval.ts`) re-runs only the
path-based `checkRemoval`. Neither reads the file's bytes. `git grep '\.confirm\b'` outside tests
finds only those two places, and the only tests that touch `confirm` (`uninstallReport.test.ts`,
`uninstallPlan.test.ts`) check that the *label* is present or absent on the right entries — never
that malformed content changes the outcome.

**Measured, `tests/unit/uninstallRemoveEndToEnd.test.ts`'s last case:** a `history.json` containing
the literal string `"not json at all, and not an array either way"` — nothing close to
`loadHistory`'s expected shape — is removed by `obsrv uninstall --remove` exactly as if it had been
Obsrv's own. Any other unnamed Electron app sharing that directory and happening to use one of these
three filenames would have its file deleted the same way.

**Why this is real rather than theoretical:** the plan's own doc comment above `removeFiles` names
the exact scenario — an app launched from the npm package once named itself "Electron" (fixed by
`#201`) and wrote into this shared directory, which is the reason these three files exist as a
separate, carefully-scoped `removeFiles` list rather than a directory removal in the first place. The
whole design is built around "don't take another app's data" and the one check meant to enforce that
for the ambiguous cases was never wired up.

**Acceptance, each with a control:**
- `history.json`/`settings.json`/`tabs.json` are only removed when their content actually parses via
  `loadHistory`/`parseSettings`/`loadTabs` (or equivalents) — reusing the real readers, not a second,
  drifting copy of what "valid" means;
- a file that fails to parse is named in the **kept** list with a reason, not silently skipped — the
  card family this bug lives in exists to refuse silent gaps;
- control: the malformed fixture in `uninstallRemoveEndToEnd.test.ts`'s last case survives instead of
  being removed once this ships — that test is written to fail loudly when this lands, with a comment
  pointing here.
