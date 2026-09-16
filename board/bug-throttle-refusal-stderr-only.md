---
title: "`inspect`, `audit` and `lint` answer `throttle: <id>` after the throttle was refused"
column: doing
owner: "Henry"
waiting: ""
kind: bug
order: 41
---

FOUND BY ROOK on 2026-09-16, auditing every `human()` call in `src/cli/main.ts` for
`bug-report-edit-invisible`. **Unowned.** Three lines to fix; not fixed on that branch because
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
