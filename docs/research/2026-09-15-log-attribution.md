# A log line that says which Obsrv wrote it

Built 2026-09-15 by Rook for `bug-log-attribution`. Two Obsrv processes, two
profiles, one log — observed rather than argued.

## What the log said before

```
2026-09-15T07:10:01.259Z info  obsrv 0.60.0 starting: electron 43.4.1, chrome 150…
2026-09-15T07:10:01.413Z info  gpu: compositing enabled, webgl enabled
```

`scripts/devLane.js:126` passes `--user-data-dir`, which moves `userData` and
**not** `logs`; `src/main/log.ts` opens `join(app.getPath('logs'), 'obsrv.log')`
and redirects only under `OBSRV_TEST=1`. So a dev-lane app and the installed
app write the same file, and no line says which wrote it.

**Whether they have ever interleaved is unknowable from the artefact**, and the
card had to be corrected once on exactly this point: with no field naming a
writer, "no lines mention the lane" fits *the lane never wrote* and *it wrote
and nothing identifies it* equally. That unreadability is the defect. The stamp
cannot answer the question backwards; it stops it being unanswerable from here.

## What it says now

Two processes launched seven seconds apart, differing only in their profile and
their lane environment, under an isolated `CFFIXED_USER_HOME`:

```
2026-09-15T08:35:16.755Z info  dev:dc1b#2942   obsrv 0.60.0 starting: … unpackaged
2026-09-15T08:35:16.910Z info  dev:dc1b#2942   gpu: compositing enabled, webgl enabled
2026-09-15T08:35:23.771Z info  lane:rook#2963  obsrv 0.60.0 starting: … unpackaged
2026-09-15T08:35:23.927Z info  lane:rook#2963  gpu: compositing enabled, webgl enabled

lines per writer:   2  dev:dc1b#2942
                    2  lane:rook#2963
```

One file, both writers, every line attributable.

## The identity is the profile and the process, not the build

This is the part that was nearly got wrong, and the caution came from Henry: a
stamp naming which **build** wrote a line is not one naming which **instance**.
Two lanes off the same commit are the same code and different Obsrvs; a build
tag would call them one writer, which is the failure the stamp exists to
prevent.

So the tag is `kind#pid`, where kind is derived from facts present at open time:

| kind | when | separates |
| --- | --- | --- |
| `app` | `app.isPackaged` | the installed app |
| `lane:<label>` | `OBSRV_DEV_LANE` set | one lane from another, by its label |
| `lane:<mark>` | a lane with no label | by four hex of its profile path |
| `test` | `OBSRV_TEST=1` | the e2e harness, which shares the machine with both |
| `dev:<mark>` | anything else | `npm run dev`, and any instance neither flag knows about |

The **profile** (`userData`) is what actually distinguishes instances — it is
precisely what `--user-data-dir` moves — and the **pid** distinguishes two runs
of one profile. Unit tests hold both cases directly: two lanes sharing a commit
must not collapse together, and two runs of one profile must not either.

## Why not move the dev lane's `logs`

It was the cheaper fix and it is the wrong one, for three reasons the card
gives and this run confirms: it helps future runs only, leaves every existing
line unattributable, and does nothing for an instance the flag does not know
about — including the installed app, the one most likely to be running beside a
lane. `dev:<mark>` is exactly that case, and it is the row a `logs` move would
have left out.

## What this does not do

- **It cannot attribute a single existing line.** Every line written before
  today stays anonymous, and no fix reaches them.
- **It does not establish that interleaving happened.** That remains
  unknowable, deliberately not investigated, and the card says so.
- **The writer is omitted, not blanked, when a caller has none.** A blank
  column would read as an instance whose name was lost.

## A note on running the proof

The first attempt hung: the two Electron processes outlived the script and its
`wait`, and a later check printed "(no stray app processes above)" directly
beneath two that were still running — a sentence keyed off nothing, in the same
session that spent the night on that defect. Both were killed and the absence
verified by counting rather than by asserting.

The real `~/Library/Logs/Obsrv/obsrv.log` was 882 lines and sha `b205b72b…`
before and after. Unpackaged runs log under `Library/Logs/Electron` rather than
`Library/Logs/Obsrv`, because the app name comes from the bundle; that is a
property of running `out/main/index.js` directly and not of the change.
