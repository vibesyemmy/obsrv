---
title: "After a refused throttle, a load timeout says \"under --throttle none (a slow load is what a throttle is for)\", naming a flag nobody passed"
column: review
owner: "Henry"
waiting: "Wren: the cold read of the fix PR, then Henry merges"
kind: bug
criterion: C5
order: 67
---

FOUND BY WREN'S RELEASE SWEEP 2026-09-17 as an unverified lead. **Confirmed by Henry, by reading. Not
yet reproduced.**

`throttleForCommand` (`src/cli/main.ts`) returns the conditions it put back when Chromium refuses a
throttle: `throttle: had.id`, which is `none` on a fresh target
(bug-throttle-field-means-two-things). That value then reaches the two load-timeout sentences, which read
"a throttle is in force" off any non-null value:
- `loadTimeoutMessage` (snap's warning, `main.ts:393`) says "under --throttle none (a slow load is what a
  throttle is for)";
- `cutLoadMeasureNote` (audit and lint notes, `main.ts:1112`/`:1236`) says "under --throttle none".

The caller asked for, say, `--throttle budget-phone`. The refusal sentence is in the same notes, so the
reader holds both, but the timeout sentence explains the slow load by a throttle that isn't in force and
names a value the caller never typed.

**Fix direction:** the sentences want "was a throttle in force", not "what does the `throttle` field say".
Pass `null` when the conditions in force are `none`, or pass the refusal state. A control: a stubbed
refusal plus a load cut by `--timeout`, where the sentence must not contain `--throttle none`.

## Claimed by Henry 2026-09-17, routed by Wren

Pulled from Backlog. It's a wording fix: after a refusal, the timeout sentences must stop naming
`--throttle none`. The plan is to name a throttle only when one is actually in force, since the refusal
sentence already says which one was asked for. The two sentence builders move to a module without
Electron, so they get unit tests with a control. `throttle-refused` is not desk-safe, so it runs on CI
only.

## In review 2026-09-17: a throttle is named only when one was in force

- **The fix:** `loadTimeoutMessage` and `cutLoadMeasureNote` move from `src/cli/main.ts` to
  `src/shared/measureBudget.ts`, which has no Electron, so they get unit tests. Both name a throttle only
  when it was in force and slows anything (`throttleInForce`). That rules out null (no flag), `none` put
  back after a refusal, and `none` asked for by name as a baseline, whose "(a slow load is what a throttle
  is for)" was never true either.
- **Callers unchanged:** all four (snap's warning, inspect's throw, audit's and lint's notes) already pass
  the conditions in force. The refusal sentence still says which throttle was asked for.
- **Test (`measureBudget.test.ts`):** `3g` gives the full sentence for both builders, exactly. `null` and
  `none` give no `--throttle` clause.
- **Control:** naming any non-null throttle again goes red on the `none` arm.
- **Kept:** `cli-throttle.spec`'s pins ("under --throttle 3g") are an applied throttle, so they're
  unaffected. `throttle-refused` runs on CI only.

