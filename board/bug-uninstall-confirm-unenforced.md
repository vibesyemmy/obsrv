---
title: "obsrv uninstall --remove deletes a generically-named file without checking it's actually Obsrv's"
column: done
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

## FIXED 2026-09-20 by Henry, on Opeyemi's word (`#1491`), reviewed by Idris

`obsrv uninstall --remove` now reads the three files' content before claiming them, through
`src/shared/storedShapes.ts` — a dependency-free module the plain-Node CLI can require, wired in as an
injected `confirm` on `removeListed` so the deciding half stays pure. A file that does not confirm is
kept and **named, with the reason**, in a new `unconfirmed` list.

### Where I deviated from the acceptance as written, and why

The card asks that removal reuse `loadHistory`/`parseSettings`/`loadTabs` so a second definition of
"valid" cannot drift. **Taken literally that is not safe, and it took building it to see why.** Those
readers are forgiving on purpose: `loadHistory` drops a bad row and keeps the file, `loadTabs` returns
an empty list rather than refusing. Forgiveness is right when *loading* — losing a convenience beats
refusing to start — and wrong when *attributing*, where the question is not "can I use this" but "is
this mine". Wiring the strict test into the readers would make `loadHistory` drop every row of a file
holding one bad entry: a real regression, bought for nothing.

So attribution is **stricter** than loading, and the two are tied by a test rather than by shared
code: `storedShapes.test.ts` asserts that anything the attribution predicate accepts also loads
through the real reader, and that the readers stay forgiving. Drift fails a test instead of quietly
widening what `--remove` deletes. The card's intent is met; its literal wording is not, and that is
the deviation to press on in review.

### Two judgement calls that could go the other way

**An empty `history.json` is refused, and an empty `tabs.json` is not.** `[]` is what an untouched list looks like in any app, so it
attributes to nobody — which means a clean uninstall can exit 0 with a file of *ours* still on disk.
The alternative takes an empty file of someone else's. Keeping costs one manual delete; removing
costs data nobody can restore.

**An unconfirmed file does not change the exit code, and I changed my mind here.** I first counted it,
on this module's own rule that a path the caller listed is still on disk. That reads the rule too
literally: the caller asked to remove *Obsrv's* files, and a file that failed attribution was never in
that set. A non-zero exit would report failure on a machine where the command worked exactly right,
and the fix a script author reaches for is to stop reading the code. The exit code answers "did it
work"; the printed lines answer "what is still there".

### Two things the review found that I had not, both by mutation rather than reading

@Idris built the branch and mutated `confirmsAs` instead of reading it, which found two real gaps:

**The e2e control did not exercise the check it was named for.** Its fixture was the card's original
`'not json at all'` — unparseable, so `bin/uninstall.js`'s own `JSON.parse` try/catch caught it
*before* `confirmsAs` ran. With `confirmsAs` forced to return `true`, the test still passed. It was
the control for the shape check and tested everything except the shape check. The fixture is now
valid JSON of the wrong shape (`{"entries": []}`), so the only thing that can keep it is the check
itself. **This is the more serious of the two**: a fix for a contract that was never enforced had a
control that was never exercised, which is the same defect one level up.

**`{"tabs": []}` was claimed on the `tabs` key, and that key is not evidence.** It restates what the
filename already says, exactly as a bare array in `history.json` restates its own. My first correction
refused every empty tab list, which was consistent and threw away a real case — Obsrv's own
`tabs.json` with every tab closed. The answer that survives both objections is `activeIndex`: a
required field of `StoredTabs` written on every save, which says something about the *writer* rather
than the name. So an empty tab list is claimable and an empty history is not, and the asymmetry is
now about what each format can carry rather than which wrapper it uses.

### Acceptance

- **content is checked before removal** — `storedShapes.confirmsAs`, injected at `bin/uninstall.js`,
  applied in `removeListed` before any `rm`;
- **a file that fails is named with a reason, not silently skipped** — `RemovalResult.unconfirmed`,
  printed by `removalLines` under *"Left alone — listed, allowed by the guard, and not confirmed as
  Obsrv's"*;
- **control: the malformed fixture survives** — `uninstallRemoveEndToEnd.test.ts`'s last case was
  written to fail loudly when this landed, and it did. It is now inverted: same fixture, opposite
  expectation, plus assertions that the file is named in `unconfirmed` and absent from `removed`.

1599 unit tests pass, typecheck clean. **Shipped in 0.62.0**, so this wants a patch release —
Opeyemi's call, already given (`#1491`).
