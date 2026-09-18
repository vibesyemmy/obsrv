---
title: "Three times on main now, `ipc.spec:31` waited 30 s for a url-changed that never came, and two later tests found the native pane invisible on both tries"
column: doing
owner: "Dogu"
waiting: ""
kind: bug
order: 60
---

ASSIGNED TO HENRY 2026-09-17 by Opeyemi, on the third sighting. **No longer waiting: it recurred, on
`main` itself, while this card sat as a recurrence-waiter.** `ipc.spec.ts:31` (*reports the URL the
native pane navigated to*) timing out at 30 s on **both tries**, with `ipc.spec.ts:134` failing at
`:167` on `expect(native.isVisible()).toBe(true)` and `ipc.spec.ts:173` failing at `:191` on
`expect(after.visible).toBe(true)` — all three in the same run, each on both tries, three times now.

Three sightings — 2026-09-16 20:13Z, 2026-09-17 08:48Z, 2026-09-17 20:10Z — and **still no cause**.
The three runs to compare: `35145262453`, `35201648560`, `35269203926` (all attempt 1). "Where to
look first" below is unchanged and now has three runs behind it rather than one.

FOUND BY HENRY 2026-09-16, reading why main's CI went red at `5e426fb` (#139's merge).

## Observed, in run [`35145262453`](https://github.com/vibesyemmy/obsrv/actions/runs/35145262453), attempt 1

    ipc.spec.ts:31   reports the URL the native pane navigated to   30.0 s, both tries
                     first line: "Test timeout of 30000ms exceeded." (the "Target page … closed"
                     under it is teardown)
    ipc.spec.ts:134  image mode hides the native pane …   1.2 s, both tries
                     :167  expect(native.isVisible()).toBe(true)   → false
    ipc.spec.ts:173  ignores malformed payloads           217 ms, both tries
                     :191  expect(after.visible).toBe(true)        → false

`:31` navigates the native pane to `about:blank` through `window.obsrv.navigate` and waits for
`onUrlChanged`. It never came. **`:134` and `:173` failing on their retries too** means each failed
alone in a fresh worker. So this is not only a dependency on `:31` having left state behind: the native
pane read as invisible in a freshly replaced worker too.

## How often, measured rather than guessed

Every CI attempt in the API's last 96 runs (2026-09-16, 16:05Z–20:49Z), searched for `ipc.spec.ts:31`.
The detector was checked against this run first, where it finds both tries:

    attempts that ran ipc.spec:31     44
    failed                             1   (this run)
    before #129 merged (19:25:45Z)    28 ran, 0 failed
    after                             16 ran, 1 failed

**One against zero is not a difference.** #129 changed `NativePane` (load and commit recording) and
merged 48 minutes before this run. That makes it the obvious suspect, and nothing here supports it
over coincidence. The window also starts at 16:05Z, so anything older is unswept.

## Not established

- Why `url-changed` never arrived for `about:blank`, and why `isVisible()` read false in fresh workers.
  Both point at the native pane on that runner at that time, not at one test's state.
- Whether it is new. A wider sweep (older runs, via the per-attempt logs) is the first step, before
  any reading of `NativePane`.

## Where to look first if it recurs, as a lead and not a finding

Rook's read: a native surface reading invisible in a fresh app, plus a `url-changed` that never came,
is close to the shape in the `gpu-reset-webgl-stall` memory: a wedged display session on the runner
taking a surface with it. The mechanism there is a lost WebGL context, not a hidden view, so it is a
place to look, not an explanation. **The tell for "runner, not test" here:** the retries failed in
fresh workers, so no state was inherited, and a later attempt on the same head was green. That tell
holds even though nothing else in the run failed.


## SWEPT 2026-09-17 by Rook: 60 suite attempts since, no second sighting

Run at Wren's ask, and by someone with no stake in the suspect — `#129` is Kenya's, so she declined
the sweep.

**Detector:** a `✘` on `ipc.spec.ts:31`, and separately a `✘` on `:134`/`:173`. **Validated against
run `35145262453` before sweeping anything** — it fires there with both tags, so its silence
elsewhere means something.

**Every attempt, not each run's latest.** `--status failure`, a run's `conclusion` and `--log-failed`
all read the latest attempt only, which is how 13 first-attempt failures were missed on `#106`.

    60 suite attempts read, 0 sightings

**One flagged case, checked and rejected.** Run `35157225867` (`e1c952d`, 22:20:57Z) came back
tagged, and it is **not** a sighting: `ipc.spec:31` carries no `✘` in that log at all. The
30-second timeout was `image-mode.spec.ts:70`. My first detector asked for *"`ipc.spec.ts:31`
appears" AND "something timed out"* — and `ipc.spec.ts:31` appears in **every** log as a passing
line, so the tag fired on any timeout anywhere. It is now anchored to the `✘`.

Worth keeping in the record, because the loose tag was a strict **superset** of the correct one: it
fired once across 60 attempts, that once is verified as a different test, so the correct detector
finds zero across the same 60 without re-reading them.

**So one against zero stays one against zero**, over a window considerably wider than before —
Henry's sweep reached back to 16:05Z; this covers the 60 most recent suite attempts, all after
`#129`.

**That is evidence about rarity, not about cause.** A single unreproduced sighting with 60 clean
attempts behind it is consistent both with a runner condition that has not recurred and with a defect
needing a trigger nobody has found. It does not clear `#129`, and it does not implicate it.

**What would settle it is still a recurrence**, and the card's existing reading stands: `:134`/`:173`
failed on their **retries**, which run alone in a freshly launched app, so inherited state from `:31`
is excluded and the pane read invisible in a fresh worker — pointing at the runner at that moment
rather than at those tests.

## THE RECURRENCE, 2026-09-17 by Henry — run [`35201648560`](https://github.com/vibesyemmy/obsrv/actions/runs/35201648560), attempt 1

Seen while reading a red run on **#267**, a PR that touches `tests/e2e/panes.spec.ts` and one board
card and nothing else — so this is main's behaviour, on a branch cut from it.

**It repeats the first sighting line for line, including the assertions:**

    ipc.spec.ts:31   reports the URL the native pane navigated to   30.0 s, both tries
                     first line: "Test timeout of 30000ms exceeded."
    ipc.spec.ts:134  image mode hides the native pane …   1.2 s / 1.3 s, both tries
                     :167  expect(native.isVisible()).toBe(true)   → false
    ipc.spec.ts:173  ignores malformed payloads           232 ms / 253 ms, both tries
                     :191  expect(after.visible).toBe(true)        → false

Nothing else in the run failed except `cli-walk.spec:173`, which Rook examined on 2026-09-16 and
found not deterministic and free of a hidden predecessor — a known flake, and a different shape.

**What the second sighting changes:**
- **`#129`'s proximity is no longer the salient fact.** The first was 48 minutes after it merged;
  this is **12½ hours and many merges later** (2026-09-16 20:13Z → 2026-09-17 08:48Z). A change that
  broke this would have had far more than two chances in between.
- **The rate stands at rare and real**, not at one-off: one in Henry's 44-attempt sweep, zero in
  Rook's 60 since, and this. **Two sightings, two heads, twelve hours apart, the same three tests in
  the same file with the same assertions.**
- **Still no cause.** Both sightings say the native pane read invisible in a freshly launched worker,
  which points at the app's own startup on that runner rather than at inherited state.

**The card's "where to look first" section is unchanged and now has two runs to look at rather than
one.** Its attempt-1 logs are at `…/actions/runs/35201648560/attempts/1/logs`.

## THE WINDOW NOBODY HAD SWEPT IS SWEPT — Henry, 2026-09-17, and it is still two sightings

The card said *"the window also starts at 16:05Z, so anything older is unswept"*, and named that
sweep as the first step before anyone reads `NativePane`. Done, with Rook's detector — anchored to
the `✘`, because a bare `ipc.spec.ts:31` appears in every log as a passing line.

    80 CI attempts before 2026-09-16T16:05Z, read per attempt
    all on 2026-09-16, 13:07Z–15:58Z
    30 of them ran ipc.spec at all (the rest are board-only runs, where the suite does not run)
    0 sightings

**What the three sweeps now say together:** 30 attempts before the first sighting, 44 across the
window it sits in (1 sighting), 60 after it (0, Rook), and the second sighting on 2026-09-17. Two in
roughly 135 attempts that ran the file, and none at all in the three hours before the first.

**What it does not say.** Three hours is not "this is new": the runs before 13:07Z are unread, and
the API's window is what bounded this, not a decision. It is evidence about rarity, not about cause
or about age, and it does not implicate or clear `#129` any more than the earlier sweeps did.

**So this is a recurrence-waiter now**, under `c5`'s rule for cards that wait on an unforceable
event: Backlog, and the body opens with the exact failure text so the next sweep's grep finds it.
Nothing here needs doing until it fires again.

## THE THIRD SIGHTING, 2026-09-17 by Wren — run [`35269203926`](https://github.com/vibesyemmy/obsrv/actions/runs/35269203926), attempt 1

Found by the routine sweep, on main's own suite for `5f35046` (#325's merge, the first-launch
diagonal hint) — a change to renderer settings UI, nothing IPC or native-pane related. Read against
the raw log before posting, not inferred from a `conclusion`.

**Line for line, the same as both earlier sightings:**

    ipc.spec.ts:31   reports the URL the native pane navigated to   both tries
                     first line: "Test timeout of 30000ms exceeded."
    ipc.spec.ts:134  image mode hides the native pane …              both tries
                     :167  expect(native.isVisible()).toBe(true)   → false
    ipc.spec.ts:173  ignores malformed payloads                      both tries
                     :191  expect(after.visible).toBe(true)        → false

Run started 20:10:23Z. Nothing else in the run failed.

**What the third sighting changes:**
- **Every suspect so far is cleared by distance, not just this one's.** `#129` (the first sighting's
  suspect) is two days and dozens of merges behind this run; #325 touches no code this card's earlier
  readings named. Three sightings, three unrelated heads, no shared suspect across all three — the
  common factor, if there is one, is not in any single PR.
- **The gap from the second sighting is shorter than the first-to-second gap:** 08:48Z to 20:10Z is
  **~11h22m**, against ~12h30m before. Roughly one a day, not slowing and not obviously accelerating
  from three points.
- **Still no cause, and still the same tell.** `:134`/`:173` failed on their retries again — fresh
  workers, no inherited state — so all three sightings point at the native pane on the runner at that
  moment, not at any one test's or PR's state.

**Card reassigned rather than left as a waiter:** three sightings in **24 hours almost exactly**
(20:13Z to 20:10Z, a day apart) is enough to stop treating this as too rare to act on. Moved to
Doing, owned by Henry, on Opeyemi's word. The sweep's recurrence-watch grep should no longer match
this card's opening line — it is not waiting anymore.

### The same commit, re-run: green — so it is the runner, not the tree

**Henry re-ran the failed job** (`gh run rerun --failed`) on the identical commit `5f35046`, before
merging anything else and before accepting the reading above. **Attempt 2: success, zero `✘`, zero
flaky, and all three tests ✓** — `:31` in 82 ms where attempt 1 spent its whole 30 s.

**That is the strongest evidence this card has, and it is worth being precise about what it rules
out.** The three tests failed on **both tries** in attempt 1, which by the team's usual reading
(`ci-logs-and-local-e2e-traps`) suggests a deterministic failure rather than a flake — a retry runs
the test alone in a fresh worker, so surviving that normally means the test really is broken. **It
was not.** The same code, on the same commit, passed completely one attempt later.

So this is the second shape that memory names: **a condition that outlives the retry but not the
job** — the runner, the machine, the window server, something outside the tree. It is why
"failed both tries" must not be read as "deterministic" without a second attempt to check it against,
and this run is now the clearest example of that on record here.

**It also clears `#325` specifically.** All three tests passed on **both parents** of that merge
(`f57477d`, run `35266612365`; `375d4a8`, run `35264902655`) and on the merge itself once re-run.
Nothing in the first-launch diagonal hint is implicated, and the revert that was being held over it is
not needed.

**What it does not tell us:** what the condition is. Three sightings, three heads, and now one
demonstration that the tree is not the variable. The next thing worth having is what the *runner* was
doing — which is the "where to look first" section's question, now with a sharper target than before.

## HANDED TO DOGU 2026-09-18 by Henry, on Opeyemi's word — because the lead left is infrastructure

**Not because it stalled.** The work Henry did on it is done and its conclusion is the handover: three
sightings on three unrelated heads, and a re-run of the identical commit that went green — **which
proves the tree is not the variable**. What is left is the one thing nobody records: **what the runner
was doing at the moment it failed.**

**That is why it moves rather than waits.** Dogu took CI/CD pipeline health as a standing lane
(`chore-ci-reliability-watch`), and this card's remaining question is a CI-infrastructure question
wearing a product card's title. Henry holding it would mean holding a card whose next step is not his
to take.

**What is established, and should not be re-derived:**
- **Three sightings, all on `main`:** `20:13Z`, `08:48Z`, `20:10Z` — about 24 hours end to end. Each
  time `ipc.spec.ts:31` timed out at 30 s and `:134`/`:173` failed at `native.isVisible()` and
  `after.visible`, **on both tries**.
- **"Both tries" does not mean deterministic here.** A re-run of the same commit (`5f35046`, attempt 2)
  passed completely — zero `✘`, `:31` in 82 ms where attempt 1 spent its whole 30 s. So it is the
  shape `ci-logs-and-local-e2e-traps` calls *a condition that outlives the retry but not the job*.
- **Every suspect is cleared by distance**, not by inspection: no PR is common to all three heads, and
  `#325` — the head of the third sighting — touches no IPC or native-pane code.

**What would actually move it, and none of it is another suite run:** what the macOS runner's window
server was doing at that moment; whether the three sightings share a runner image, a concurrent job,
or a machine; whether an artifact exists that records anything outside the test process. **Henry has
no lead beyond that list**, and says so rather than handing over a card that looks further along than
it is.

**Nothing here is urgent.** It has been seen three times in 24 hours and has never reached a release.

## FIRST PASS, 2026-09-18 by Dogu — two of Henry's four questions answered, no runs re-executed

Read from existing data only: job-setup logs, uploaded failure artifacts, per-attempt CI logs. No
suite run of any kind, per Henry's own warning against a fourth baseline run.

**Runner image and region: both cleared, not implicated.** All three sightings' e2e job ran
`macos-14-arm64` at image release `20260831.0302`, Azure region `westus`. Checked against two
controls — the passing re-run of the third sighting's own commit (attempt 2) and an unrelated
clean run the same evening (`35286751102`) — **both controls used the identical image release and
region.** So this was simply the only image/region in rotation all week; it cannot be what
separates the three failures from every clean run around them. Answers Henry's "shared a runner
image" question directly: yes, shared — with everything else too.

**Concurrent job: not answerable from here.** These are GitHub-hosted ephemeral runners; the API
does not expose physical-host identity, so "was another job sharing this machine" has no data source
short of a self-hosted runner, which this repo does not use. Naming this as a dead end rather than
leaving it looking open.

**New: the uploaded failure artifacts exist and nobody had opened them.** `playwright-traces` from
all three sightings are still live (not expired) — `35145262453`'s artifact `10468022022`,
`35201648560`'s `10489339240`, `35269203926`'s `10519021701`. Each contains per-test
`test-failed-*.png` screenshots and, for the retry attempt, a full `trace.zip`. `bug-flakes-gate-the-gate`
established these uploads were once empty (`if: failure()` on a step order that never fired); that
is fixed now, and there was real content waiting.

**The screenshot at the moment of `:31`'s timeout is pixel-identical across all three sightings.**
Full-app screenshot, taken 30 seconds after the test called `navigate` and started waiting: in
every one of the three, the app is still showing its pristine first-launch "New tab" / "Point Obsrv
at a page" screen — the empty state from before any navigation, not a frozen mid-load state or a
blank pane inside an otherwise-normal window. **The native pane did not merely fail to report its
URL; nothing about the app's own chrome shows any sign the navigate call was ever acted on**,
across three unrelated heads, byte-for-byte the same image. That is a sharper version of "the pane
read invisible" than the card had — it is "the app looks exactly as if `navigate` had not been
called," which narrows where the break can be (something upstream of the pane even starting to
respond) more than it had been narrowed before.

**One precise correlation found, in ONE of the three sightings only — reporting it as partial, not
as the cause.** In `35145262453`'s raw log, the app process (pid `13613`) emits
`[13619:0916/203617.425062:ERROR:gpu/ipc/client/command_buffer_proxy_impl.cc:488] GPU state invalid
after WaitForGetOffsetInRange` at `20:36:17.425`. `ipc.spec.ts:31`'s first-try timeout fires at
`20:36:17.4755` — **50 ms later, same process.** This is not the deliberate GPU-crash testing
elsewhere in the same log (`gpu-reset.spec.ts`, `log.spec.ts:64` — both already ✓ and finished
several tests earlier, at 20:35:14–20:35:21); this is a second, unplanned GPU/command-buffer error
landing in the same 100ms window as the hang. **Checked the other two sightings for the same
signature (`GPU state invalid`, `GPU process exited`, `context lost`, and near variants) — neither
`35201648560` nor `35269203926` has anything matching, anywhere in the log.** So this either isn't
the mechanism, or the mechanism has more than one trigger and only one of the three left a log
trace. Rook's `gpu-reset-webgl-stall` hypothesis is not confirmed by this — but it is the first
piece of evidence that touches it at all, rather than being argued from shape alone.

**Not yet done, named rather than assumed complete:** the `trace.zip` files (richer than a
screenshot — action timeline, console, network) are downloaded but not yet opened; that's the next
thing to read before forming a stronger claim, not another suite run.
