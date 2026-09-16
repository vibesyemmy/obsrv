---
title: "`inspect`, `audit` and `lint` answer `throttle: <id>` after the throttle was refused"
column: done
owner: "Henry"
kind: bug
order: 41
---

FOUND BY ROOK on 2026-09-16, auditing every `human()` call in `src/cli/main.ts` for
`bug-report-edit-invisible`. Three lines to fix; not fixed on that branch because
there is no failing test to write first, and that is the decision this card asks for.

**When Chromium refuses a throttle, three commands say so where callers are told not to look,
and their machine output claims the throttle anyway.** `target.setThrottle()` resolves with a
message when the DevTools conditions could not be applied — a debugger already attached by other
tooling, say — and `null` when they are in force (`src/main/targetSource.ts:565`). `snap` sends
that message through `warn()` (`main.ts:343`), so it reaches `warnings[]`. `inspect` (`:939`),
`audit` (`:1015`) and `lint` (`:1138`) send it through `human()`, stderr only — and each then
answers `throttle: <id>` in its machine output, copied from the *request* (`cmd.spec.throttle`),
not from what was applied.

So a caller reads `throttle: "slow-3g"` beside measurements taken under no throttle at all, and
the only sentence saying so is on the stream `compatibility.md` tells it to ignore. That fails
the test `bug-report-edit-invisible` proposed and this audit applied: *would a caller reasoning
about the output be wrong without it?* Yes — and worse than the stuck-chrome case, because here a
structured field actively asserts the false condition.

**It is `bug-report-edit-invisible` with a different field** (Henry's framing, and the reason a
reader who fixed one should recognise the other at once): the machine surface reports what was
*asked for* rather than what *happened* — a reply confident about a state it did not verify —
and the only place the truth appears is the stream callers are told to ignore.

**And a fact about the surface, not about anyone's effort:** because a refusal cannot be forced
from outside the process, this behaviour cannot be regression-tested today. Whatever fix lands,
that sentence stays true until one of the routes below gives the test a subject.

## Why it was not fixed on the branch that found it

The fix is `warn`-shaped — push `refused` into the `notes` (inspect) or `warnings` (audit, lint)
array that already reaches `machine()` at `:1000`, `:1122`, `:1256`. It is not on
`fix/report-diff-trio` because a refusal cannot be forced from the CLI's own process: it needs
`webContents.debugger.attach` to throw, which nothing in the test harness can arrange without a
hook in the product. Shipping three lines on a reading, with no test that watched them fail, is
the thing this board keeps finding at the bottom of its errors. Whoever takes this decides
between:

- **a test hook** — an env flag the harness can set to make `applyThrottle` refuse, so an e2e
  can assert the sentence lands in the machine output; a product change made for a test, which
  the repo has done before and should say so;
- **extracting the assembly** — the machine-output composition for each command into a function
  a unit test can drive with a fake `refused`, which is a refactor of three long inline objects;
- **shipping on the reading**, on Opeyemi's word, with `snap`'s identical line at `:343` as the
  precedent and the card saying it was not watched.

## What the check must not be

A run under a throttle that *works* proves nothing here. The vacuity check is: the assertion has
to see a non-null `refused` reach the array. If the harness cannot produce one, the test has no
subject and a green from it is the defect `CONTRIBUTING.md` names.

## The live surface has the same shape, by reading — added 2026-09-16 by Henry

Found while checking `drive`'s set-and-read-back fields for `bug-onion-skin-zero-means-three-things`.
**Read in the code, not observed.** Main's `IPC.setThrottle` handler (`src/main/ipc.ts:486`) awaits
the same `target.setThrottle()` and, on a refusal, only `log.warn`s it. The renderer's store keeps
the id it asked for, `status` mirrors the store, and `obsrv_drive` answers `throttle: <id>`, the
request again, with nothing in `warnings`. The control server's `setThrottle` confirms on that
mirrored id, so its reply agrees with the store, not with Chromium.

Not reproduced: a refusal needs a second debugger client on the target, and one wasn't tried. A fix
here would likely want the refusal carried back the way `setOnionSkin`'s now is (#66): refused in
main, with the sentence in the reply's `warnings`.

## RESOLVED 2026-09-16 by Henry — the refusal reaches the reply, on both surfaces, under a test that forces it

**The decision this card asked for, taken as an engineering call: the test hook.**
`OBSRV_TEST_THROTTLE_REFUSAL`, read only under `OBSRV_TEST=1`, is thrown inside `applyThrottle`'s own
`try`, so the sentence under test is the product's own (`throttle <id> not applied: <message>`). It's
a product change made for a test, and the comment beside it says so. The precedent is #59's
`OBSRV_TEST_FIRST_VIEWPORT_DELAY_MS`. It refuses only a throttle that applies conditions, so lifting
one (`none`) still works under it and the test can turn it off.

**Headless.** `inspect`, `audit` and `lint` now put the refusal among their notes, which already
reach both stderr and the reply: inspect's `notes`, and audit's and lint's `warnings`, where their
notes have always gone. It's said once, not twice. `throttle` keeps its documented meaning, the flag
it was given (the parity spec's allowlist says so), and the note beside it says it didn't take.

**Live.** The control server's `setThrottle` now applies the throttle in main **before the renderer
is asked**, the way #66 refuses an onion skin. A refusal isn't sent to the renderer, the target puts
back the throttle it had, and the reply is `applied: false` with the sentence in `warnings`.
`obsrv_drive` and a live `obsrv_snap` carry it into their own `warnings`. Before this, the renderer
showed the throttle, main's attempt was refused into the log, and every reply and status after it
named a throttle that wasn't applied. **Not changed:** a throttle picked by hand in the side panel
still logs a refusal and shows the throttle asked for, which the code's own comment calls
deliberate. The card is about what a caller reads.

**Tests:** `tests/e2e/throttle-refused.spec.ts`. Headless: `inspect`, `audit` and `lint`, each with
the refusal forced (the sentence in its array exactly once, and once on stderr) and without it (no
such sentence). Live: a harness app launched with the flag. The control reply is `applied: false`
with the sentence and the target still at `none`, and lifting isn't refused. `obsrv_drive` and a
live `obsrv_snap`, through a client that has listed the tools, carry the sentence in `warnings`.
**Every assertion needs the forced message to arrive**, which is the card's vacuity rule. **Fix:** 5/5,
plus `mcp-live`'s existing throttle test. **Control (the wiring removed, the hook kept):** all 5 failed,
at inspect `notes: []`, audit and lint `warnings: []`, the live reply's `applied`/`throttle`, and
`drive`'s `throttle`.

**A wrong turn worth keeping:** the first headless test read `notes` for all three commands, and audit
and lint failed *on the fix*, because their notes are emitted as `warnings`. That same first cut also
printed the sentence twice on stderr, which the once-on-stderr assertion would have caught. Their
first control failed at the same wrong key, so it proved nothing and was re-run.
