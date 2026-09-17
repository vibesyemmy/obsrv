---
title: "On a machine with no app running, the first MCP call waits 12 s and gives two contradicting reasons"
column: next
kind: bug
criterion: A3
order: 62
---

FOUND BY HENRY 2026-09-17, in `a3`'s cold-machine run. **Unowned.**

## What a stranger's client receives

A bare MCP SDK client ran `npx -y getobsrv mcp` on a fresh macOS runner: no Obsrv app installed or
running, and no Electron cached. It called `obsrv_presets`, then `obsrv_snap`, then `obsrv_audit`, all
in the default `mode: auto`. **Reproduced on main's own packed build** (run `35168190686`, 0.60.0 at
main's head) and on npm `latest` 0.60.0 (run `35167299615`), with identical sentences:

1. **`obsrv_snap` took 16–19 s** (Electron's download was 2–4 s of that) and answered headless with
   `why: "launch-timeout"` and:
   > the Obsrv app was launched but did not answer within 12 s; rendered headlessly. It may still be
   > starting — the next call will find it.
2. **The next call didn't find it.** `obsrv_audit`, 1.4–2.1 s later, answered headless, also
   `launch-timeout`, with a different reason:
   > the launch exited immediately without a new instance starting — Obsrv's profile is already in use by
   > a process that is not answering the agent-control protocol (an older Obsrv version, or one still
   > finishing its own startup); rendered headlessly.

**Neither sentence describes what happened.** Nothing older was installed, and the first call's app
had been up for over 12 s. Read from `ensureLive` (`src/mcp/control.ts:288`):
- Call 1 found no app (`absent`), launched one and polled `discover()` for 12 s, then took the timeout
  branch for a cold start.
- Call 2 launched again, its process lost the single-instance lock to call 1's app and exited, and
  `discover()` still read `absent`, which is the "older version" branch.

**So the app call 1 launched never wrote a control file `discover()` could read, or never answered on
it.** The fresh profile has agent control off, and main writes a disabled stance at boot
(`writeDisabled`), which would read `not-asked`, not `absent`.

## Not established

- **What the launched app was doing:** whether it wrote `control.json` and where, whether a consent bar
  was raised, and whether it runs under the same userData path `discover()` reads. The runner can answer
  all of this. The next step is to read the app's control file and window during call 1, on CI.
- **What a user on a desk sees:** presumably a window opening with no explanation in the reply. **This
  run could not see a desk.**

## Why it matters

This is the first thing an agent does with Obsrv on a new machine, and the reply's explanation is wrong
twice, in different ways. The promise "the next call will find it" is the kind of sentence an agent
acts on.
