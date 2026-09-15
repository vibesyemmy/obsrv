# sync.spec.ts:165 — a genuine navigation mistaken for an echo

Measured 2026-09-15 by Rook for `flake-sync-165`. The card asked how much of
the loop breaker's window was left when the test starts. That number turned out
to be a constant and the loop breaker turned out to be innocent; the fault is in
the bus's echo bookkeeping, and it is reproducible on this desk.

## What the card believed, and what is true

| The premise | What was measured |
| --- | --- |
| The test survives because the 3 s loop window has expired | It starts **106–111 ms** after the previous mirror, every run, with 2.9 s of the window still to run. It survives because `alternations` is 0. |
| It reproduces only on CI, a slow VM | It reproduces here: **4 failures in 113 runs (~4%)**, on an idle machine. |
| Load is the variable | Three runs under six busy cores had step times indistinguishable from idle (11–132 ms). |
| The loop breaker breaks it | `trips=0` on every passing run, and `navigation mirror loop broken` appears in none of the five CI reds. |

A step that normally takes 9–119 ms and occasionally exceeds its 5,000 ms
budget is not a slow mirror. It is a mirror that never happened.

## The mechanism

`mirror()` has five exits and all five look identical from outside — the other
pane did not move. `sync.mirrorTrace()` records which one each decision took.
Every branch but `pane-destroyed` was forced deliberately first
(`tests/e2e/sync-trace.spec.ts`), because a branch never seen to print cannot be
told from a branch that cannot happen.

**Passing run**, the relevant window:

```
+2571ms native->target issued  hairline.html    the redirect's replacement, issued into target
+2577ms target->native echo    hairline.html    target commits it — the echo RETIRES the entry
+2684ms native->target issued  tall.html        step 1
+2797ms target->native issued  hairline.html    step 2 mirrors to native — correct
```

**Failing run**, same window:

```
+2726ms native->target issued  hairline.html    the redirect's replacement, issued into target
                                                 (no echo: the retiring commit never arrives)
+2838ms native->target issued  tall.html        step 1
+2952ms target->native echo    hairline.html    step 2 read as an ECHO — nothing mirrored
```

The failing trace is missing exactly one line: the echo that retires the entry.
Both failures show it; both passing runs have it.

So:

1. The previous test loads `redirect.html`, which does `location.replace('hairline.html')`. The bus issues that replacement into `target` and records it in `issued['target']`.
2. Normally `target`'s own commit of it comes back as an echo, which retires the record.
3. Sometimes nothing retires the record — see *Why the record survived*, below, which corrects this step. `ISSUED_MAX_AGE_MS` is **10 s**, and the whole file runs in about 3 s, so the age bound never prunes within a file: the record simply waits.
4. The next test loads `hairline.html` into `target` for real. `retire()` finds the stale record, calls the commit an echo, and returns **before any mirror is issued**. `native` sits on `tall.html` until the 5 s poll gives up.

The direction — always target→native, never the reverse, on both desks — falls
out of step 1: the previous test drives the *native* pane, so the mirror flows
native→target and the stale record lands in `issued['target']`. Nothing about
the bus is asymmetric; the test order is.

`tests/fixtures/redirect.html` carries this comment, written before any of
this was known:

> the client-side redirect shape SyncBus must survive without leaving a stale
> expectation behind

It does leave one, about 4% of the time.

## What this rules out

- **The loop breaker**, in both the pass and the failure.
- **`LOOP_WINDOW_MS = 3_000` being too tight** for a slow host. The margin is a
  constant and the failure reproduces on a fast idle machine.
- **Splitting the file.** `sync-mirror-mark.spec.ts` was created to fix this
  coupling by moving a test out, and it fails on CI too. A stale record inside
  one bus is not cured by moving a test to another file; it is cured by
  retiring the record.

## Why the record survived — the part the first write-up could not explain

The paragraph above said the retiring commit "does not arrive". That was the
observation; the cause is four lines above the decision:

```ts
const onTargetNav = (url, inPage, mirrored) => {
  if (mirrored) return          // the commit of a load the bus issued
  mirror('target', url, inPage)
}
```

**A mirrored load's commit in the target never reaches `mirror()` at all**, so
it never becomes an echo and never retires anything. The native pane's
equivalent commit does — it arrives as `did-navigate` and goes through the
decision — which is why the two panes behave differently and why the failure is
always target→native.

So a record in `issued['target']` had exactly two ways out: a *genuine* target
commit of the same URL (`retire()` inside `mirror()`), or the 10-second age
bound. A run passed when the target's own page-driven commit happened to match
the record; it failed when nothing did. That is the coin-flip.

This is also why the two earlier attempts to force the state in the live app
both failed: superseding a mirrored load leaves a record, but the *next* genuine
target commit sweeps it before the test can look.

## The fix

`onTargetNav` retires the record when the mirrored commit arrives, in the same
place the native pane's echo does it:

```ts
if (mirrored) {
  retire('target', url, Date.now())
  return
}
```

The load is over when its document is here. That is the same fact `mirror()`
already uses for the other pane, so this makes the echo test *more* precise
rather than loosening it — it does not buy a stale expectation back at the price
of a weaker loop guard, which is what ranked it above the alternatives.

**Driven from `tests/unit/syncBus.test.ts`**, which drives the bus directly with
fake panes. The states that matter are ones the live app reaches by luck; here
they are set. The failing case reproduces in 4 ms rather than in 113 e2e runs,
and two companion tests hold the behaviour the 2026-09-03 design bought: a
mirrored commit that *does* come back is still an echo, and a superseded load's
commit is still not news.

One thing that harness taught immediately: a fake firing two loads inside the
same millisecond makes the second sweep the first, because `retire` drops
everything sent "at or before". Real loads are milliseconds apart, so the clock
in the harness moves. A test that had left it still would have been testing an
arrangement the app never produces.

## What the alternatives would have cost

Not taken:

- **Retire on any new document, not only on an echo.** `issued[from].clear()`
  already runs for a cross-document commit, but only *after* the echo check
  returns. Moving that decision earlier would sweep the stale record — and
  would also change what "echo" means for a superseded load, which the
  `issued` map exists to get right (see the 252-load loop of 2026-09-03).
- **Bound the record's age to something shorter than a test file.** 10 s is
  longer than any legitimate in-flight load; 1–2 s would prune the stale record
  before the next test. It is the smallest change and the least principled.
- **Make the record carry an identity of its own** — a token matched at the
  commit — so a later genuine commit of the same URL could not match an earlier
  issue. This was ranked first on the card and is what the fix above amounts to,
  arrived at more cheaply: the commit *is* the load's identity, once the
  mirrored commit is allowed to retire its own record. A token would add
  bookkeeping to say what the arrival already says.

## How to reproduce

```
npm run build
for i in $(seq 1 30); do npx playwright test sync.spec --retries=0 || break; done
```

About 1 in 25. On failure the trace prints before the assertion throws; the
line to look for is a `target->native echo hairline.html` with no matching
`issued` for `native` after it.
