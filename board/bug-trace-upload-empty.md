---
title: "\"Upload Playwright traces on failure\" has been uploading nothing, and passing"
column: next
kind: bug
owner: "Kenya"
order: 38
---

FOUND BY ROOK 2026-09-16, reading `playwright.config.ts` for an unrelated reason. Filed by Henry.
**Assigned to Kenya** on Henry's routing, credited to Rook, who found it. The fix is one config line; the reason this card exists is what the week cost without
it.

## The defect

`playwright.config.ts` sets no `trace`, no `screenshot`, no `video`. **Playwright's defaults are
all off.** So on a failure, `test-results/` contains `error-context.md` and nothing else.

`ci.yml:91` is named **"Upload Playwright traces on failure"**. It has run on every red run this
week, uploaded an **empty directory**, and **passed** — because uploading nothing succeeds.

## Why it is the week's defect in its purest form

**A step whose name is a claim its configuration does not back, going green because the operation
it actually performs succeeds.** Nobody opened it, because it was green and its name said the
thing we wanted to be true.

Every flake investigation on this board — `bug-flakes-gate-the-gate`, `bug-devtools-toggle-reopens`,
`bug-target-canvas-no-frames`, the whole four-logs read — has been conducted on `error-context.md`
while a green step reported the traces archived. **Three sessions spent a day reading the one file
that happened to exist and believing it was the residue of a trace.**

It is `mcp.spec:137` one level up. That was a reproducible defect concealed by a retry and called a
flake because it was counted rather than read. This is a missing artefact concealed by a passing
step and called a trace because the step was named one.

## The fix, and why this shape rather than "turn traces on"

    use: { trace: 'on-first-retry' }

Under `retries: 1` that captures **exactly the retry attempt** — precisely the retry-defeating
population every flake card here is about.

**CORRECTION, MEASURED BY KENYA 2026-09-16: a trace does not contain what this card originally
said it did, and the fix as briefed would have answered neither of this week's questions.**

Henry and Rook both described `trace: 'on-first-retry'` as giving *console, DOM snapshots and
per-action screenshots*. Kenya set it, **failed a test on purpose, and opened the zip**:

    context-options 1 · before 9 · after 9 · error 1

The action log and the error. **No console entries. No DOM snapshots. No screenshots — zero image
resources.** Setting `screenshots: true, snapshots: true, sources: true` explicitly produced an
identical zip. **For an `electron.launch()` app, Playwright traces API actions and nothing else.**

So the briefed fix would have made the step's name true while the artefact still settled nothing:
no picture for `vision:47`'s white-or-yellow pixel, no console line for `panes:83`'s GPU exit.
**The same defect one layer in — a capability asserted rather than checked — and it would have
shipped if verification had been reading the diff.**

**What actually produces the evidence, and it is a different setting:** `screenshot:
'only-on-failure'`. A failure writes a real PNG **per page** — five for this app, shell and both
panes, 798×828 — and a picture of the target pane is exactly what decides white versus yellow.
Electron's own stdout already reaches the report as `[pid=…][err]` Browser logs when the app dies;
that is how `stall:42`'s *Target page, context or browser has been closed* carried its launch log.

**Keep both settings.** The trace gives the action sequence; the screenshot gives the picture.
Neither substitutes for the other, and the next person to set `trace` alone will believe they are
done.

**It is Rook's proposal and the targeting is the good part.** The population the config captures
and the population the cards are about are the same set, by construction rather than by luck.

## What it does NOT fix, so nobody reads too much into a merge

**Traces start existing from the merge forward.** Every failure investigated this week stays
investigated on `error-context.md`, and any finding that turned on "the trace does not show X" is
now known to rest on an artefact that was never captured. Kenya's note that the artefacts *"cannot
separate a wash-out from a still-applied shader"* is one of these: true of what existed, and not
evidence about what a trace would have shown.

**Re-deriving those findings is not free** — it needs the failures to recur under the new config,
and three of them are intermittent.

## The check that would have caught it, which is this repo's standing rule

**A step that cannot fail is not a check.** Uploading an empty directory succeeds; the step had no
way to go red and therefore no way to tell anyone it was doing nothing.

`actions/upload-artifact` has `if-no-files-found`, which defaults to `warn`. Setting it to `error`
on that step would have turned a week of silence into a red run on day one. **Whoever takes this
should set it in the same change**, or the next person to delete a trace setting gets the same
green.

## Routing, and the three questions Kenya put to Henry

**Separately from PR #27, not folded in.** Kenya's own reasoning and it is right: #27 is a *reading
of evidence*; this is a *change to what evidence exists*. A reviewer reading one should not have to
weigh the other. #27 is also open and green-pending — folding this in restarts its suite for no
benefit.

**Kenya takes it rather than Rook, and the finding stays Rook's.** Rook is mid-trio and does not
start new work while a card is in Doing; that rule has been right all day and this is not the
occasion to erode it. The stronger argument is positive rather than procedural: **Kenya is the
session that will use the traces**, so it is the one placed to verify the config actually produces
them — and verification here means watching a failure emit a trace, not reading the diff. If Rook
clears the trio first and wants it, it has first refusal.

**The step's name becomes true, and that is not sufficient.** Renaming or fixing the config both
leave a step that **cannot fail**. Set `if-no-files-found: error` in the same change. That is the
check that would have caught this on day one, and without it the next person who drops a trace
setting gets the same silent green.

## What Kenya has already established, recorded so it is not re-derived

One cause for three separate symptoms hit independently today: the blue channel unrecorded on
`vision:47`, Rook's focus discriminator unreadable on `controls:85`, and `controls:85` having no
page snapshot while its neighbours did.

And the cost, in Kenya's framing: **trace zips are megabytes rather than kilobytes and the retry
attempt runs slightly slower — against an afternoon three sessions spent reasoning from an artefact
that was never going to contain the answer.**
