---
title: "The CLI specs run on CI by a rule nobody wrote down, enforced by each person's own regex"
column: done
owner: "Henry"
kind: bug
criterion: C5
order: 97
---

FOUND 2026-09-17, from Kenya's disclosure. She meant to sweep desk-safe specs before opening her Hint
PR, excluded the CLI family with `/cli-/`, and **about fourteen `cli.spec.ts` tests ran on Opeyemi's
machine while he was using it.** She caught it in the log, killed it, checked for orphaned processes
(none), and said so — including that she did not know whether anything fronted the app, rather than
assuming either way.

**The pattern was not the error.** Of the seventeen specs in that family, **sixteen are `cli-*` and
exactly one is `cli.spec.ts`**. `/cli-/` is the pattern anyone would write, and it is the one that
misses the file. Verified: `cli-animating`, `cli-audit`, `cli-blank`, `cli-diff`, `cli-inspect`,
`cli-layout-scale`, `cli-lint`, `cli-measured-page`, `cli-presets`, `cli-report`, `cli-shadow-arms`,
`cli-snap-tiled`, `cli-text-scale`, `cli-throttle`, `cli-walk-limits`, `cli-walk` — and `cli.spec.ts`.

## What was actually wrong, checked on `main`

- **`cli.spec.ts` has no gate of its own.** No `CI` check, no `OBSRV_E2E_FRONT`, no skip. Nor do the
  sixteen `cli-*` specs. Nothing in the code stops a local run.
- **The rule was written down nowhere.** `CONTRIBUTING.md` documented the desk rule for `focusWindow`
  and `overlay-focus.spec` by name and said nothing about the CLI family at all.
- **So the only enforcement was memory plus a hand-written pattern**, per person, per run. That is a
  rule that works until the first person writes the obvious regex.

**Each of these was verified independently by Wren before it was written here.**

## Fixed in part, and the rest needs a decision

**Done (`#324`):**
- `playwright.config.ts` takes `OBSRV_DESK_SAFE=1` and applies
  `testIgnore: ['**/cli*.spec.ts', '**/throttle-refused.spec.ts']`. **`testIgnore` matches file
  paths**; `--grep` matches test titles, which is what makes a hand-written pattern a guess about
  what it is matching against.
- `npm run test:e2e:desk-safe` sets it, so nobody writes the pattern again.
- The rule is in `CONTRIBUTING.md`, with the incident and the one-character difference.
- `deskSafeCoversTheCliFamily.test.ts` reads `tests/e2e/` and fails if a spec starting with `cli` is
  not covered — the directory checks the glob, not the glob checking itself. **Control:** changing the
  glob to `cli-*` reds it with `not excluded from a desk-safe run: cli.spec.ts`, which is Kenya's
  mistake reproduced by construction.
- **Measured end to end, not only through the unit test:** `playwright test --list` gives 611 tests in
  73 files by default, of which 153 are in `cli*` specs; under `OBSRV_DESK_SAFE=1` it gives 451 in 55,
  with **zero** `cli*` and zero `throttle-refused`.

**Not done, because it needs Opeyemi's word.** The strongest fix is for these specs to refuse to run
outside CI without an explicit opt-in, so a wrong pattern cannot expose a desk at all — an opt-out
protects only the people who remember to use it. That means editing `tests/e2e/cli.spec.ts`, which no
session may touch without his explicit authorization. **Asked 2026-09-17; unanswered.**

## What this card does NOT claim

**Nothing about whether the app fronted during Kenya's run.** No `lsappinfo` watcher and no in-app
recorder were attached, so there is no activation data in either direction. Reading "nobody reported
the app coming forward" as "it did not come forward" would be the silence-fits-two-facts error, on the
subject `bug-e2e-takes-the-desk` exists to measure. It is not evidence for that card, and it is
recorded in its not-checked column rather than its findings.

## Acceptance, each with a control

- ~~a desk-safe run excludes every spec in the CLI family, checked against the directory~~ **met**,
  with the control above;
- the CLI specs refuse a local run unless someone opts in explicitly, so the protection does not
  depend on the runner's pattern. **Control:** running one without the opt-in fails with a sentence
  naming why. **Blocked on the `cli.spec.ts` authorization;**
- whatever the rule becomes, `CONTRIBUTING.md` and the code say the same thing, and a new spec in the
  family cannot fall outside it without a test going red.

## CLOSED 2026-09-17: the opt-out became an opt-in, and it needed no `cli.spec.ts` edit after all

**Opeyemi authorised the `tests/e2e/cli.spec.ts` change in Henry's session.** Designing it with the
authorization in hand made it clear the per-file guard was the *worse* fix, so the file was not
touched:

- **A per-file `test.skip` in seventeen files** duplicates the rule seventeen times, and each copy is
  a place for the eighteenth file to be forgotten.
- **Inverting the default in `playwright.config.ts` is one edit and defaults to safe.** The specs are
  excluded from a local run unless `OBSRV_E2E_CLI=1`, and CI is untouched.

**Why the direction matters more than the mechanism.** The first fix (`#324`) was an opt-out:
`OBSRV_DESK_SAFE=1` left the family out *if you remembered to set it*. But the people who remember a
flag are the same people who would have written `cli*` instead of `cli-*` in the first place — an
opt-out protects everyone except the person it exists for. Defaulting to safe costs one environment
variable to the person who genuinely wants these, and costs nothing to anyone else.

**Measured through Playwright, not inferred from the config:**

| run | tests | files | `cli*` specs |
| --- | --- | --- | --- |
| local, nobody opted in | 455 | 56 | **0** |
| local, `OBSRV_E2E_CLI=1` | 615 | 74 | all |
| `CI=true` | 615 | 74 | all |

**So CI keeps its full coverage** — the thing worth checking before defaulting anything to "off", and
the check Idris asked for when reviewing `#324`.

**Acceptance: the second item is met in substance and NOT in its own words, and the difference is
Idris's finding.** The clause reads *"the CLI specs refuse a local run unless someone opts in
explicitly … **Control:** running one without the opt-in fails with a sentence naming why."* The
protection is real and by construction — but `testIgnore` **says nothing**. Targeting one of those
files directly gets Playwright's generic *no tests found*, and a full local run mentions the exclusion
nowhere. Idris tested it rather than reading the claim, which is the only reason this is written down
instead of standing as "met".

**Why it is not fixed here, and what would fix it.** A spec that is *ignored* cannot explain itself;
only a spec that is *collected and skipped* can, and skipping 153 tests would trip
`check-e2e-skips.js`, which exists to fail a green run that skipped a test nobody listed. The cheap
honest fix is a line printed once at the start of a local run — *"CLI specs excluded; `OBSRV_E2E_CLI=1`
to include them"* — which needs a `globalSetup` and deserves its own change rather than being
smuggled into this one. **Follow-up: `chore-desk-safe-run-says-what-it-left-out`.**

The rest of the item — protection that does not depend on the runner's pattern — is met by
construction rather than by anyone's memory. The third — code and `CONTRIBUTING.md` saying the same
thing, with a test that reds if a new spec escapes — is met by
`deskSafeCoversTheCliFamily.test.ts`, which reads `tests/e2e/` rather than the glob.
