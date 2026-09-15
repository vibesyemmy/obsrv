# The Obsrv board

*57 cards, 28 open, 20 of those unclaimed.*

**This file is generated. The board is [`board/`](../board), one file per
card — edit those.** `npm run board` regenerates this; CI runs
`npm run board:check` and fails if the two disagree, so this cannot go
quietly stale the way a snapshot of somewhere else can.

## If you want to pick something up

Cards in **Next** are the ones worth starting. Each carries the criterion it
closes, an owner when it has one, and the file, commit or document that
defines *done* — enough to begin without having been in the conversation that
produced it.

**Claim it by editing its file** — set `owner:` and `column: doing` in
`board/<id>.md`, run `npm run board`, and open a pull request with both
changes. That is the whole mechanism; there is no separate board to update
and no one you have to ask to update it for you. An unowned card in Next or
Backlog is free; a card with an owner is being worked on, and a card in
Review is finished and waiting on the maintainer rather than on help.

**How to read a commit on a card.** Where a card names delivered work it
gives a branch and then a sha as `as of` — `fix/thing (as of 9fe0fda)`. The
**branch is the address**; the sha is a timestamp. Unmerged branches get
rebased when main moves, which leaves the content identical and every sha
different, so a bare sha on a card becomes wrong while still reading as
precise. Go to the branch. If its tip no longer matches the `as of`, that is
a rebase and not a different piece of work.

Two things worth knowing before you start, both of which this project has
learned the hard way and written down:

- [`docs/readiness.md`](readiness.md) is the definition of done for anything
  labelled with a criterion (`A1`…`E2`). The board tracks work; readiness
  states what would make the work finished.
- [`docs/limitations.md`](limitations.md) lists the things that look like bugs
  and are not. Worth two minutes before filing one.

---

## Backlog — 14

*Raised, not yet picked.*

### Note inventory: every note seen to fire on a real page

[`c5`](../board/c5.md) · **C5** · readiness · *unclaimed*

The 2026-09-13 sweep did this for notes and found gaps; never completed.

### Written compatibility policy

[`c1`](../board/c1.md) · **C1** · readiness · *unclaimed*

MCP output schemas are additionalProperties:false, so adding a field breaks sessions that listed tools earlier. Policy must say what may change before 1.0.

### Name breaking changes as such, by rule not habit

[`c2`](../board/c2.md) · **C2** · readiness · *unclaimed*

Partly met by habit. url changed meaning for live callers in 0.59.0.

### Auto-update: reach the new version without leaving the app

[`a2`](../board/a2.md) · **A2** · readiness · *unclaimed*

The updater checks GitHub daily and offers the release page; it never installs. Someone on 0.57.0 has no way to know.

### Cold-machine first run, on each surface

[`a3`](../board/a3.md) · **A3** · readiness · *unclaimed*

Never done on a machine that has never run Obsrv. Read the output as a stranger would.

### Close or write down the remaining known gaps

[`b2`](../board/b2.md) · **B2** · readiness · *unclaimed*

Settle gap closed 2026-09-14. Still open: the dialog note has never fired on a live site across four runs; whether to enter open shadow roots is undecided.

### Measure the noise ratio with two independent classifiers

[`b4`](../board/b4.md) · **B4** · readiness · *unclaimed*

zalando.de answered 143 findings; nobody has established how many a developer would act on. B5 now makes this interpretable.

### A live run that turns up nothing user-visible

[`b1`](../board/b1.md) · **B1** · readiness · *unclaimed*

Cannot be scheduled — met when a run finds nothing. Runs 13-16 each found something. docs/research/

### A mirrored redirect's second commit can still be counted as an arrival

[`bug-arrivals`](../board/bug-arrivals.md) · **B2** · bug · *unclaimed*

Deferred 2026-09-14 in commit 7d811f8. Two causes race for that commit; when it lands unmarked the arrivals counter counts it, so the spurious 'navigated after it loaded' note can fire on a redirect.

### `orientation: landscape` produces a portrait screen on every desktop preset

[`bug-orientation-name`](../board/bug-orientation-name.md) · **C2** · bug · *unclaimed*

src/shared/calibration.ts:40 — the flag names which STORED form to use (as-listed, or rotated a quarter turn), not the shape you get. 1080p-24 is stored 1920x1080, so the default gives landscape and `orientation: 'landscape'` rotates it to 1080x1920. `screenShape` then correctly reports 'portrait' beside it; both fields are right and answer different questions (comment at calibration.ts:37). cli/args.ts:190-200 documents all of it. Not a behaviour bug — a name that inverts its plain meaning. Evidence it costs: obsrv-e7 hit it on 2026-09-14 while hunting C4 parity defects, measured two different viewports without noticing, and was about to file it as a parity defect. Renaming is a breaking change to a public flag and an MCP field, so it is C2's to schedule, not a quiet fix.

### Drag tabs to re-arrange them, as every browser does

[`feat-tab-reorder`](../board/feat-tab-reorder.md) · chore · *unclaimed*

Requested by Opeyemi 2026-09-14. Nothing today: TabBar.tsx has no draggable/onDragStart, and the control server has openTab/closeTab/activateTab but no moveTab. Order is positional — StoredTabs keeps a list plus an active index (shared/tabsFile.ts), and that file already documents how badly indices behave when the list shifts: dropping an entry shifts every index after it and can strand the active one. A reorder shifts the list on purpose, so it must move the active index with it and survive a restore; the tabs-come-back-on-relaunch spec is where that gets proved. Open questions for whoever takes it: whether an agent gets a moveTab command too (C2 — a new control command is a surface change), and whether reordering while agent control is on can move the driven tab out from under a command, since the agent acts on whichever tab is in front.

### A dev app exited between 18:42 and 19:13 with no explicit stop

[`bug-dev-app-exited`](../board/bug-dev-app-exited.md) · bug · *unclaimed*

Observed by Kenya 2026-09-14. **Titled for what was seen rather than for a mechanism, at Kenya's insistence — it declined to let this be filed as "the lane reaps idle apps" because the code says otherwise and that would have been a second claim inferred from mechanism within the hour.** Nobody knows why this app exited. That is the card.

TIMELINE, local time:

- ~17:55 — Kenya deliberately killed pid 65770
- then     relaunched with `--no-build`, got pid 2299
- 18:42:47 — the shared log's last write (`window hidden; target rasterisation paused` / `window shown; … resumed`, repeatedly)
- 19:13 — pid 2299 gone, noticed incidentally while checking something else

So it died inside that half hour, after logging normally.

WHY THIS IS SURPRISING RATHER THAN EXPECTED, verified in the source rather than taken from the report:

- `scripts/lane.js:59` spawns the app `detached: true, stdio: 'ignore'` and calls `.unref()`. It is in its own process group and should outlive the shell that launched it.
- Nothing in `scripts/lane.js`, `scripts/devLane.js` or `src/main/controlServer.ts` reaps an idle app. The only kills are the explicit stop path — `devLane.js:157` SIGTERM, `devLane.js:167` SIGKILL after a grace. The `process.kill(pid, 0)` at `devLane.js:133` is a liveness probe, not a kill.

A LEAD, TO BE HELD LOOSELY: the last lines are occlusion transitions — the same macOS desk state the visibility and log specs skip over. That is a place to look, not a cause, and Kenya flagged it as exactly the kind of lead someone will harden into an explanation if it is written down carelessly.

WHAT CANNOT BE SAID: whether it crashed, was killed from outside the lane, or exited cleanly. The lane app writes to the shared `~/Library/Logs/Obsrv/obsrv.log` with no field naming its writer, so its own exit line — if it wrote one — is indistinguishable from the installed app's.

**Which makes this card blocked on [[bug-log-attribution]] in practice.** Investigating it means reading a log that cannot say which process produced a line. Stamping the line should land first, or whoever takes this spends the effort and comes back with the same two-facts absence.

COST TO REPRODUCE: a relaunch and an idle half hour, spent watching a process rather than driving anything. Kenya will take it if Opeyemi wants it chased; otherwise it sits here with the timeline intact.

Bears on documentation: nobody should write "the dev app stays up" in `docs/` until this is understood. It is the kind of sentence that becomes a support answer.

### Apply the breaking-changes policy to the last five releases

[`c2-retroactive`](../board/c2-retroactive.md) · **C2** · readiness · *unclaimed*

What C2's check actually asks and the register does not yet satisfy: read 0.56.0 through 0.60.0 for anything that broke a caller and add it to docs/breaking-changes.md. Cheap per release — the notes exist on GitHub — but it needs reading the diffs too, since the releases that named a change are exactly the ones least likely to have missed one. Depends on C1: the policy defining what counts has not been written, and applying an unwritten policy retroactively is how a register becomes a matter of taste.

### control.json survives a crash and then survives the uninstall

[`bug-control-json-crash-stale`](../board/bug-control-json-crash-stale.md) · bug · *unclaimed*

Measured by Rook 2026-09-14, and the way it was measured is the part worth copying.

Rook's first packaged-app run threw before `close()` and left a `control.json`; the clean run did not. **Two runs differing in one thing is a hypothesis, not a finding**, so it ran both deliberately with agent control on: a clean quit removes the file, `SIGKILL` leaves it — port, token, pid, mode `0600`.

Not a functional defect on its own. Discovery already treats a dead pid as no app (see `single-instance`), so a stale file does not mislead the MCP server or another instance.

The cost is that it is a **token on disk with no owner**, and it then survives deleting the app along with everything else in `bug-history-survives-uninstall`. A loopback token is low-value — it is bound to a port nothing is listening on — but "low-value credential left behind indefinitely after the program that made it is gone" is the sort of sentence that is easier to fix than to defend.

Cheapest fix is a sweep at startup rather than a handler at exit: a crash is by definition the case where the exit path did not run, so anything that relies on shutdown cannot close this. The app already knows how to judge a dead pid; the same check can delete rather than only ignore.

Related: `a4` for the full inventory, and `bug-history-survives-uninstall` for the removal question this feeds into.

---

## Next — 10

*Picked, not claimed — start here.*

### Sign and notarise the app

[`a1`](../board/a1.md) · **A1** · readiness · owner: Rook (cert step is Opeyemi's)

A1'S GROUNDWORK ALREADY EXISTS, ON A BRANCH UNMERGED SINCE 2026-08-30. Henry cited `docs/signing.md` on this card without saying where it is; it is NOT on main, and a reader looking there finds nothing. Corrected here.

branch chore/signing (as of f3fdbe9, 2026-08-30)       .github/workflows/ci.yml   +42   HAS_SIGNING gate, CSC_IDENTITY_AUTO_DISCOVERY       docs/signing.md            +116  new file — the step-3 warning lives here       package.json               +1    dist:signed = build + electron-builder --config.mac.notarize=true

`HAS_SIGNING` is `secrets.CSC_LINK != '' && secrets.APPLE_API_KEY_ID != ''`, and the release step runs `dist:signed` only when it is true — so the fork case is already handled gracefully.

**AND IT STILL MERGES CLEAN, which corrects Henry's first reading of it.** "Two weeks stale, will need a rebase before anyone judges it" overstated the cost. Measured by Rook and verified here independently:

base                          3521bc8, 2026-08-29     commits on main since base    447     conflicts if merged today     0     commits touching ci.yml           3     commits touching package.json    60   (almost all `npm version` bumps)     commits touching docs/signing.md  0   (the file exists nowhere else, so nothing could)

447 commits and it still applies, because the branch touches three files and main has barely moved in two of those places — ci.yml's later additions (plugin-tag, tested-on-main) sit BELOW the release job this edits. Rook's own caveat, kept because it is the right one: re-measure on the day someone merges rather than trusting this number, since it is true of today's main and nothing guarantees tomorrow's.

**A SECOND CORRECTION, Rook's, and it changes the estimate rather than only the record.** Henry wrote that Rook "had the shape right without the branch in front of it". That was an inference and it was wrong. Rook had read `chore/signing:docs/signing.md` in full and the `main...chore/signing` diff before proposing anything — step 3's warning is where its `identityName=Restack Dev` build got its meaning, and its A1 design to Opeyemi opens by rebasing that branch. So the identity assertion was written to fit the existing `HAS_SIGNING` gate rather than to sit beside it. The groundwork is not merely known to exist; it has been read.

ROOK'S PROPOSED IDENTITY ASSERTION, stated concretely so it is judged as work rather than as a principle. Three lines after `dist:signed`, the build failing on any:

codesign -dv --verbose=4 <app>    authority must contain "Developer ID Application: Voicify Limited (NDXPR623CF)"     spctl -a -vvv -t install <app>    must say  source=Notarized Developer ID     xcrun stapler validate <dmg>      must pass, per DMG

A shell step in the release job, not a new subsystem. It replaces nothing in docs/signing.md: the doc explains why, the assertion makes the why unskippable.

THE POINT THAT MAKES IT AN IDENTITY CHECK RATHER THAN A SIGNATURE CHECK, and it is Rook's: **assert what it must EQUAL, never "is signed" or "is not unsigned".** `spctl` accepts an ad-hoc signature happily, and "signed" is exactly the answer that was true today and wrong — electron-builder reported success with `identityName=Restack Dev`. The team id in the string is what makes it an identity. A check whose pass fits both "signed as us" and "signed as anything" is this project's own defect family, pointed at the release.

SCOPE, deliberately not widened: NOT the local build. Enforcing it in `npm run dist` would fail on any machine without the cert, including a contributor's fork. It belongs where `HAS_SIGNING` is true.

LIVE RISK CONFIRMED 2026-09-14, found by Rook while doing A4 and not while looking for it. docs/signing.md step 3 carries a warning about electron-builder picking the wrong identity. **It reproduced verbatim on the first build anyone has run since that warning was written**: electron-builder signed with `identityName=Restack Dev` and REPORTED SUCCESS.

That is the dangerous half. A wrong-identity signature does not fail — it succeeds, loudly, with a green build log, and the identity is only visible if someone reads which one it used. Anyone cutting a release without checking would ship a build signed by the wrong entity and have no signal at all.

So docs/signing.md is right and is not sufficient: a warning in a document is read once, and this needs a check that fires every time. Whoever takes A1 should treat "assert the signing identity is the one intended, and fail the build otherwise" as part of the work rather than a follow-up.

Blocked on Apple issuing a Developer ID Application certificate. The cert in ~/Documents/obsrv-signing is Apple Distribution (Voicify Limited) — wrong type. Wiring waits on chore/signing.

### QUEUE — Rook: chore-guard now · flake-sync-165 next · a1 on Opeyemi

[`queue-rook`](../board/queue-rook.md) · chore · owner: Rook

UPDATED 2026-09-14 evening.

1. `chore-guard` — IN PROGRESS. Rook's own first preference; obsrv-91 released it rather than hold it against a maybe. Read the stale-lock section before building: that branch needs an observation, not a design. 2. `flake-sync-165` — QUEUED, on Opeyemi's word. Reshaped from a reproduction hunt into a margin measurement, because the flake was seen once and six runs were clean after; a hunt could end with nothing. The card now names the constants and the number to produce. 3. `a1` — BLOCKED on Opeyemi: the design, the Voicify-versus-Opeyemi identity, and the credentials. Its first step is the `chore/signing` rebase, inside the card. Rook has read that branch; it merges clean today, 447 commits on, zero conflicts.

Not Rook's unless asked: the three a4 follow-ups. Rook declined them unprompted as "mine by provenance, not by right", and `chore-uninstall-path` in particular is a decision about what Obsrv promises rather than a cleanup.

Updated 2026-09-14 evening, after the queue went stale within hours of being written — which is the failure mode this card is an instance of, not an exception to.

1. e2 — DELIVERED into Review, 717e924. See the e2 card. 2. a1 — BLOCKED, and not on the certificate any more. Rook has a design with Opeyemi and waits on his yes. Two things need his decision, not Rook's: the design itself, and the IDENTITY — the app would be signed as Voicify Limited, which is what Gatekeeper shows users, while `copyright` says Opeyemi Ajagbe and CI would hold Voicify's private key. The remaining mechanical step needs Opeyemi to type a p12 password, so it cannot be finished by any session alone.    Already settled by measurement, so nobody re-opens it: the identity PAIRS. Public-key SHA-256 of the cert's -pubkey against each .key — obsrv-developer-id.key matches the Developer ID leaf at 53c1b7ae; the 21:34 pair is a different keypair at 1cd2c04d. And the G2 CA is a PUBLIC intermediate, not account-gated — Henry relayed the opposite to Opeyemi and has corrected it. 3. bug-orientation-name — unstarted, and the next one to pick up when a1 is unblocked or if Rook wants work in the gap.

### QUEUE — Kenya: c5-elevated DONE · bug-retina DONE · c3 remains

[`queue-kenya`](../board/queue-kenya.md) · chore · owner: Kenya

Updated 2026-09-14 evening. Two of three delivered, and the order changed — Opeyemi picked bug-retina directly rather than c3, so the queue Henry wrote was overtaken by the user's own routing. That is the correct precedence and the card records it rather than hiding it: Henry's word routes work, Opeyemi's authorises it.

1. c5-elevated — DELIVERED into Review, 6b7acb4. Inverted the card's own fallback: `resizing` fires, keep the value. 2. bug-retina — DELIVERED into Review, cf52dc8, and it corrected the card's premise. See that card. 3. c3 — does skills/obsrv-screens/SKILL.md describe the tools that exist. NOT started; Kenya is putting it to Opeyemi before picking it up.

Henry asked Kenya to SPLIT docs/c5-note-inventory into two branches so bug-retina can merge first — it makes every other local run cheaper to read, so it is worth more merged before people run suites than after. Sequencing only; both still wait on Opeyemi's word given to Kenya directly.

### Whatever decides, something else must notice when the decision changes

[`lesson-agreement-two-facts`](../board/lesson-agreement-two-facts.md) · **B5** · chore · *unclaimed*

THE RULE, which is the general form and the reason this card exists: whatever decides something, a separate thing must notice when that decision changes. Three instances turned up in one afternoon and none of us saw the pattern until the third:
- a filtered test run decides nothing was compared — so the test must announce that it had no evidence (cbe4981)
- an EXPLAINED row decides a difference is excused — so something must notice when the difference is gone (d69b2c1)
- a motion probe would decide whether values are compared — so something must assert WHICH pages were compared

THE FINDING THAT PRODUCED IT (obsrv-e7, 2026-09-14). CI on cdd7056 failed the parity gate: `obsrv_audit pageHeight — moves: headless=1080 live=1065`, obsrv_lint the same, on tests/fixtures/moves-while-measured.html, which slides at 140 px/s. Read twice, fifteen px apart. The surfaces were never implicated. CI sequence: 586caab green (before the C4 work), cdd7056 failure (E2E, one test, one assertion, one page), 1d4e505 SUCCESS — so the red lasted one run and was never 'the C4 work'.

THE LESSON. This machine read 1080 twice on every local run, so the comparison was wrong from its first run and every local green was evidence that two reads landed in the same frame. A third kind of silence: not a VALUE that fits two opposite facts, but an AGREEMENT that fits two — two numbers matching means either 'these agree' or 'nothing moved between the reads'. Both gate verifications that day were sound and neither could have caught it: both test the LOGIC, and this was the INPUT.

THE DESIGN, argued between both sessions. obsrv-a6 proposed replacing the `moving` flag with src/shared/pageMotion.ts, which already answers 'was this page holding still' on both surfaces. obsrv-e7's objection, correct: THE PROBE ANSWERS PER-RUN TOO — a page that moves slowly, or only while loading, reads as still on a fast host, which is how `moves` got past everyone. A probe that silently decides whether to compare values gives a green that fits two facts again, harder to spot because nothing names it.

So: per page, store each surface's probe verdict and whether values were compared; assert that the value-compared set equals the expected set. A page that silently stops being compared goes red; so does one that starts. Take the UNION across surfaces — if either says moving, it was moving. KEEP THE FLAG as an override: a fixture whose purpose is motion should not depend on a probe agreeing about it on the day. Probe for discovery, flag for what we can state.

### A log line cannot be attributed to the dev app or the installed one

[`bug-log-attribution`](../board/bug-log-attribution.md) · bug · *unclaimed*

CORRECTED 2026-09-14, an hour after filing, because the card asserted more than had been measured. Kenya caught it and the objection lands on this card's own principle.

WHAT IS MEASURED (mechanism, confirmed in the source and by probe):
- src/main/log.ts:22 opens `join(app.getPath('logs'), 'obsrv.log')`; line 21 redirects logs into userData ONLY when OBSRV_TEST=1.
- scripts/devLane.js:126 passes `--user-data-dir` and line 127 sets OBSRV_AGENT_CONTROL, OBSRV_DEV_LANE and OBSRV_DEV_LANE_LABEL — NOT OBSRV_TEST.
- An Electron probe confirms `--user-data-dir` moves userData and leaves `getPath('logs')` in the real profile.

So a dev-lane app writes to the shared ~/Library/Logs/Obsrv/obsrv.log. That much is established.

WHAT WAS NOT MEASURED, and what the first version of this card wrongly stated as fact: that the two HAVE been interleaving. Kenya checked — /tmp/kenya-lane/profile has no logs directory, and the live log contains zero lines mentioning its lane label or worktree path.

AND THAT ABSENCE PROVES NOTHING, which is the whole point of the card and which I had to be shown on my own card. The log format has NO LANE FIELD. So "no lines mention the lane" fits two facts: the lane's app never wrote, or it wrote and nothing in a line identifies a writer. Kenya searched for a marker the format cannot carry. The second is likelier precisely because the format has no way to carry the first.

ONE DETAIL OF KENYA'S READ CORRECTED, since it slightly weakened its own conclusion: the log's last line is timestamped 17:42:47.152Z and the file's mtime is 18:42:47. Those are the SAME INSTANT — this machine is WAT (UTC+1), log lines are UTC, mtime is local. Kenya read them as an hour apart and concluded the log's entries predate most of its lane work. They do not; that line is the last write.

SO THE CARD STANDS AND ITS FIX MATTERS MORE, NOT LESS. Whether interleaving happened today is not merely unknown — it is unknowable from the artefact, by anyone, including the two sessions that produced it. That is the defect, stated better than the first draft stated it.

Which also settles the fix. Moving `logs` for the dev lane would help future runs and would still leave every existing line unattributable, and would do nothing for a third instance the flag does not know about. STAMP THE LINE. A log that names its own writer stays readable however many Obsrvs exist, and is the only version of this fix that makes the existing question answerable going forward.

Found by Rook 2026-09-14 while measuring A4's isolation, and confirmed here with a direct Electron probe.

`scripts/devLane.js:126` passes `--user-data-dir`, so the dev profile is genuinely separate from the installed app's. But that flag does NOT move `logs`. Measured:

--user-data-dir     moves userData, sessionData, crashDumps — NOT appData, logs, cache     CFFIXED_USER_HOME   moves home, userData, appData, logs, cache — NOT temp

So the dev app and the installed app both write `~/Library/Logs/Obsrv/obsrv.log` unless `OBSRV_TEST=1`.

Not a defect on its own — nothing is lost or corrupted. The cost is that **a line in that log does not say which of the two wrote it**, and this project has had two Obsrvs running side by side all day. Anyone debugging from the log while a dev build exists is reading an interleaving they cannot separate, and the log is what `docs/limitations.md` and the issue template both point people at.

The obvious fix is to move `logs` for the dev lane too. The less obvious and possibly better one is to stamp the line: a log that names its own writer stays readable even when someone runs a third instance the flag does not know about. That is the [[read-the-output-not-the-code]] principle — a sentence should name its own subject rather than depend on the reader knowing the context it was produced in.

Related: the same measurement produced `chore-electron-sandbox-note`, and the general fact is that Electron on macOS ignores `HOME` entirely.

### userData grows without bound — 1.3 GB, 94% of it Chromium cache

[`bug-userdata-unbounded`](../board/bug-userdata-unbounded.md) · bug · *unclaimed*

Measured by Rook 2026-09-14 on this machine's real profile while scoping A4.

~/Library/Application Support/Obsrv    1.3 GB total       Cache                                936 MB       Code Cache                           338 MB

Nothing prunes either. They are Chromium's own caches for every page Obsrv has ever rendered, and Obsrv renders arbitrary third-party pages by design — so this grows with use in a way an ordinary app's does not, and faster for the people who use the tool most.

**Filed separately from A4 deliberately.** A4 asks what an install leaves behind after an uninstall; this is what normal USE accumulates while the tool is working correctly. Folding it into A4 would let a criterion about residue absorb a defect about growth, and the two have different fixes and different urgency. A4's own residue finding — the 128 MB Electron zip in `~/Library/Caches/electron/` that survives `npm rm -g getobsrv` — stays on A4, because that one genuinely is uninstall residue.

What is NOT yet known, and should be established before choosing a fix, because the obvious fix is a cap and the obvious cap is wrong if the cache is load-bearing: whether these caches make repeat measurements of the same page faster or more consistent. Obsrv's whole product is that two measurements of the same page agree (B5), so a cache that quietly improves repeatability is not free to delete. Measure the effect on a repeat snap before capping anything.

The related limits question: `docs/limitations.md` says what Obsrv cannot measure and `README.md` has a *Privacy and files* section naming where files live. Neither says this directory grows without limit, which a user would want to know before it is 1.3 GB.

### The two walks cover a growing page differently — 3 screenfuls against 8

[`bug-walk-coverage-diverges`](../board/bug-walk-coverage-diverges.md) · **C4** · bug · owner: obsrv-e7

Measured 2026-09-14 (obsrv-a6), same file, same session, both surfaces:

headless  3 screenfuls, atEnd true, page measures 4712, covered 3072 → coverage note FIRES   live      8 screenfuls, atEnd true, page measures 6832, covered 6912 → no gap, SILENT

Same URL: a warning on one surface, nothing on the other, and the two measurements are of different amounts of page. Each answer is internally consistent, which is what makes it hard to notice.

FIXTURE NOW IN THE REPO: tests/fixtures/app-shell-grows.html (merged 586caab) — an app shell whose inner feed extends twice as it is walked. No existing fixture had that shape; every other app-shell fixture walks further than the page measures, so none can make walkCoverageNote fire on an element scroller.

Handed to obsrv-e7 to run through the C4 parity harness, which catches exactly this asymmetry (a note-bearing array present on one surface and empty on the other) and is how the panel silence and the inspect gap both surfaced. obsrv-e7's read: if live really never fires the coverage note on an app shell, it is a seventh defect rather than a footnote to the sixth.

Cause still open: the `hidden` divergence, the two walks scrolling differently, or the growth being timing-dependent. obsrv-a6's one-off comparison could not separate them.

### There is no supported way to remove Obsrv's data

[`chore-uninstall-path`](../board/chore-uninstall-path.md) · chore · *unclaimed*

Split from `bug-history-survives-uninstall` deliberately: that card is a privacy gap closable by a paragraph in the README, this one is a feature, and tying them means the cheap fix waits for the expensive one.

Deleting `Obsrv.app` removes the app and nothing else — measured, 87 entries before and 86 after. There is no `obsrv uninstall`, and `npm rm -g getobsrv` leaves the 128 MB Electron zip in `~/Library/Caches/electron/` (see `a4`).

Two shapes, and the lighter one may be enough:

- **A documented path list.** Four or five lines in the README naming every directory, so someone can remove them by hand and know they got all of it. No code, no risk of deleting the wrong thing on someone's behalf.
- **An `obsrv uninstall` command.** More usable, and it takes on the job of being careful — it must not delete a profile another instance is using, must say what it is about to remove before removing it, and must handle the CLI, the app and the MCP server having different footprints.

**Prefer the list first.** It is the part that makes the privacy statement true, it can ship immediately, and it is the specification the command would have to implement anyway. A command written before the list exists is a command whose completeness nobody can check.

Whoever takes the command: `a4`'s write-up (`docs/research/2026-09-14-a4-install-remains.md`) is the inventory, measured on a real packaged build rather than reasoned from the code.

### CI on main fails about one run in three, from at least three different tests

[`bug-ci-main-red-37pct`](../board/bug-ci-main-red-37pct.md) · **B5** · bug · *unclaimed*

**THE 37% HAS HOLES IN IT NOW, AND HENRY PUT THEM THERE.** 2026-09-15.

The concurrency groups added in 450d5f9 cancelled three main CI runs — 154c8e3, 5eeb5f8, 4ee2bf9 — within minutes of landing. The guard was written to protect main from exactly that, with a comment above it saying so.

**How it fails is the part to keep:** `cancel-in-progress` only protects a run that is IN PROGRESS. A run still PENDING — queued for a macOS runner, which is most of them here — is cancelled by a newer arrival in the same group whatever the flag says. Three commits pushed in quick succession each killed a queued predecessor.

Fixed by putting the sha in the group on main, so a main run is never in a group with another main run and there is nothing to supersede it.

**Why it belongs on THIS card: a cancelled run is a commit with NO CI answer, which is worse than a red one.** This card is a tally of which commits went red, and a hole in it is indistinguishable from a commit nobody broke — the same two-facts shape the card is about, introduced into the card's own evidence by the person keeping it.

So the 27-run window and the 10 failures stand as measured BEFORE 450d5f9. Any recount that spans it has to treat cancelled runs as missing data rather than as passes.

**ALL TEN NOW CLASSIFIED, which the card asked for.** Counts over every red run, not a sample:

live-drive:963     8 of 10        live-drive:1015   8 of 10   — the same eight, always together     sync.spec:165      5              sync.spec:138     2         — 7 for sync.spec as a file     devtools:92  2   devtools:116  2   sync-mirror-mark:41  2   stall  2   panes  2     cli-walk:173, cli-snap-tiled:65, select:54, tabs:266, throttle-live:55, text-scale:251   1 each

**`live-drive:963` and `:1015` are one fault, not two** — Rook's observation, and it holds eight for eight. They never appear apart. Counting them separately makes live-drive read as twice as noisy as it is, and it is already the dominant failure in the suite by a distance: eight of ten reds against sync:165's five.

Henry got this wrong twice before it was right. First by sampling only the first failing test in three of the ten runs and presenting those rows beside seven complete ones, which understated live-drive by three. Then, before that, by a grep that matched the first test in the log rather than the failing one and returned `browser-identity.spec.ts:41` for all seven runs — every row identical was the tell, and it is the same grep trap this project wrote down six hours earlier.

**TWO RUNS ARE A DIFFERENT CLASS.** `735f60f` (six specs) and `b89ec67` (seven) had unrelated specs failing at once — not six independent flakes, one environmental failure taking the run with it. Both contain `devtools:116` and `sync-mirror-mark:41`, which is a shared signature worth chasing. Excluding those two runs makes live-drive MORE dominant, not less: seven of eight, while sync:165 drops to four.

**`sync-mirror-mark.spec.ts:41` fails in both of them**, and that is the file created to fix the sync coupling by splitting a test into its own file. The split moved the problem rather than removing it — so "put it in its own file" is not the remedy for whatever `flake-sync-165` finds.

**Measured 2026-09-14 ~21:50, and it supersedes the single-test framing on `bug-resizing-test-flaky-ci`.** Henry reported "main is red" about one flaky test. It is not one test and it is not occasional.

**Every completed CI run on main since the C5 merge (3f92680), counted:**

27 runs,  10 failures,  17 successes   —  37% red

failed: 202d118 c494f7c e921b64 735f60f 6a8cd02 b89ec67 ddb2c72 67c4176 81f139f a1c9050

**At least three distinct tests, sampled rather than assumed:**

a1c9050   tests/e2e/live-drive.spec.ts:963    the resizing verdict     b89ec67   tests/e2e/cli-walk.spec.ts:173     6a8cd02   tests/e2e/devtools.spec.ts:92

Only the first is the one already carded. The other two are unexamined.

**HOW THIS WENT UNNOTICED FOR OVER THREE HOURS, which is the part that matters more than the rate.** Every merge this evening was verified the same way: run the suite locally, read the green, push, report it as verified. Nobody read CI after the push. Several of the failing commits — a1c9050, 81f139f, 284dac2 — touch nothing but board cards and generated docs, so the failures cannot be caused by what was merged, and were visible the whole time to anyone who looked.

Henry stated "typecheck clean, 1121/1121, pushed" repeatedly tonight. Each of those was true and none of them was about CI.

**WHY IT IS THE STRONGEST EVIDENCE FOR `ci-second-host`, not a distraction from it.** The local desk and CI disagree, repeatedly, across at least three unrelated tests. That is the card's thesis demonstrated at scale: one desk cannot tell you whether a result is about the tool or about the machine. B5's repeatability zero was established on the local desk alone and says the tool does not drift; CI says something drifts about a third of the time.

Those are not contradictory — B5 measured fixtures, these are live e2e — but nobody can say which kind of fact they are holding without the comparison `ci-second-host` asks for.

**WHAT THIS CARD ASKS FOR,** and it is deliberately not "fix the flakes":

- The failure for each of the ten runs, classified by test. Ten is small enough to read them all rather than sample three.
- Whether they share a cause — a shared app, a shared budget, host speed — or are three unrelated races that happen to coincide.
- A number for how long this has been true. The window measured here starts at the C5 merge because that is where Henry started looking, which is not evidence it started there.

**AND A GATE QUESTION FOR OPEYEMI, because it is a policy decision rather than an engineering one:** at 37% red, CI currently cannot tell anyone whether a change broke something. A red run means nothing, so a green run means nothing either. Either the flakes get fixed or the suite gets quarantined into "gating" and "informational" — and the second is how a suite quietly stops being a gate while still looking like one.

Related: `bug-resizing-test-flaky-ci` is one instance. `ci-second-host` is the measurement this argues for. `chore-guard` is about greens that mean nothing; this is reds that mean nothing, which is the same disease.

### The e2e suite still vanishes on a conflicting PR, and its absence is silent

[`bug-suite-absent-on-conflict`](../board/bug-suite-absent-on-conflict.md) · bug · *unclaimed*

Raised 2026-09-15 by Kenya, four minutes after `bug-pr-checks-absent` closed, having hit the same mechanism on PR #2.

That card fixed the BOARD CHECK by making it push-triggered. It did not fix the class its title promised. Measured:

board.yml      push: ALL branches                 cannot expire     ci.yml         push: main only + pull_request     STILL EXPIRES     b5-sweep.yml   no push trigger + pull_request     STILL EXPIRES     pages.yml      push: main only                    no PR dependency

On PR #2, while conflicting: `gh pr checks 2` listed the board check and nothing else; one run for the head sha. **The e2e job was never scheduled** — on the first pull request that would have exercised the branch the fix was written for.

**THE COST IS ALREADY BEING PAID.** Kenya has rebased three times on that branch and twice on the one before, *"all of them to buy a CI run rather than to resolve anything real"*. Every card that touches `board/` conflicts on the generated files once main moves, so this is the normal state of a second contributor rather than an edge case.

**THE DECISION, and it is why this is not a two-line copy of the board fix.** `board:check` is seconds on ubuntu with no dependencies, so making it unconditional costs nothing. The suite is **~17 minutes of macOS CI**. Making that unconditional on every branch push is a different trade entirely, and it would also double against `pull_request` — the concurrency groups added in 450d5f9 will NOT dedupe those, because `refs/heads/x` and `refs/pull/N/merge` are different refs and therefore different groups.

Options, none obviously right:

- **Suite on push for all branches, drop `pull_request`.** No double, no expiry. Costs a full macOS run on every branch push, including work-in-progress nobody wants tested yet, and loses fork PRs entirely.
- **Keep it as is and make the ABSENCE loud rather than the suite unconditional.** The bug is not that the suite fails to run — it is that nothing says it did not. A required status check, or a gate that refuses a merge when no suite run exists for the head sha, turns a silence into a refusal. Cheapest, and it matches the diagnosis: this whole family is silences that fit two facts.
- **Reduce how often PRs conflict**, by not committing the generated board files — explicitly rejected on `bug-pr-checks-absent` as the wrong turn, since those files are what makes staleness impossible. Recorded here so it is rejected once rather than re-proposed.

**What would settle the choice:** how often a PR here is conflicting at the moment someone wants to read its checks. Two data points so far and both were conflicting, which is suggestive and is not a rate.

**Do not close this on a green PR.** A PR whose checks are present proves nothing about the conflicting case — that is the exact error `bug-pr-checks-absent` was closed with, and this card exists because of it.

---

## Doing — 2

*Claimed. Someone is on it.*

### Three sessions were sharing one working tree

[`chore-worktree-discipline`](../board/chore-worktree-discipline.md) · chore · owner: Henry

Found 2026-09-14 when Kenya joined the room and reported being in /Users/opeyemiajagbe/Documents/Projects/Obsrv on main at f470827 — the same checkout Henry was mid-edit in, and the same one Rook described in the room at the older HEAD a5c1a3c. Kenya also saw its branch change under it (test/explained-table-staleness -> main), which was Henry merging and checking out main in that tree an hour earlier.

`git worktree list` showed only two worktrees, neither belonging to Rook or Kenya — so up to three sessions on one tree, which is the hazard Rook itself flagged in the room before anyone hit it, and which has cost this project a rebuild before (a `git checkout -- .` from one session dropped another's uncommitted work).

RESOLUTION ISSUED: nobody edits the shared checkout; each session takes its own worktree (Rook /tmp/obsrv-rook on feat/cli-version, Kenya /tmp/obsrv-kenya on docs/c5-note-inventory). Henry stays in the main checkout as the one already mid-change. obsrv-e7 has worked from /private/tmp/obsrv-c4-sweep all day, so the pattern is proven.

Also flagged: the git stash stack is SHARED across worktrees, so a bare `git stash pop` in one takes another's work. WIP commit, or stash push -u -m with a unique tag and apply by sha.

OPEN: this is currently a convention announced in a chat room, which is the weakest possible enforcement — it survives exactly as long as the room's scrollback. Worth deciding whether it belongs in CONTRIBUTING or a pre-edit check.

### Fixing the stale echo is a decision about what `issued` means

[`bug-stale-issued-echo`](../board/bug-stale-issued-echo.md) · bug · owner: Rook

ASSIGNED TO ROOK 2026-09-15 on Opeyemi's word. Owner set here so claiming costs no pull request.

**THE HISTORY THE CARD SAID TO GET IN FRONT OF YOU, now actually read rather than named.** The incident is `88635ed`, *"the loop breaker's bounce is a state, and every issued URL is an echo"*, 2026-09-03. Its own words:

> The bus remembers every URL it sent into a pane, not the latest. With two mirrored loads in flight into one pane the superseded one still commits, and a single "next expected URL" read that commit as a new document and reset the count: **252 loads** once the arm alone was in place. Any issued URL's commit is now an echo (not news, not a mirror, not a reset); an echo retires what was sent before it, a new document retires everything, entries older than 10 s are forgotten.

**So the current design exists precisely because a SUPERSEDED LOAD'S COMMIT could not be told from a NEW DOCUMENT.** Remembering every issued URL rather than the latest is the fix for that, and it is what today's fault abuses: a record that should have been retired by its own echo survives, and the next genuine load of the same URL looks exactly like that echo.

**THAT HISTORY RANKS THE THREE CANDIDATES, and it rules one of them out on the record rather than on taste:**

- *Retire on any new document rather than only on an echo* — read `88635ed` before costing this. **A new document already retires everything.** Whatever this candidate means, it is not that, and if it means loosening what counts as a new document it is walking straight back into the 252-load loop, which is the exact confusion that commit was written to end.
- *Bound the record's age below a test file's length* — the 10 s was chosen deliberately in that commit ("entries older than 10 s are forgotten"). Shortening it is choosing a smaller number for a reason, and the reason has to be better than "a test file runs in 3 s", because production is not a test file.
- **Make the record identify the LOAD rather than the URL** — this is the one the history argues for. The 252-load loop happened because the bus could not distinguish a superseded load's commit from a new document; identifying the load is exactly the distinction that was missing then and is missing now. It is the only candidate that makes the echo test *more* precise rather than less, so it does not trade a stale expectation for a weaker loop guard.

That is a reading of the history, not an instruction. If the load-identity candidate turns out to cost more than it looks, the ranking is wrong and the reasoning above is what to argue with.

**A STALE COMMENT IN THE FILE YOU ARE ABOUT TO EDIT.** `src/main/syncBus.ts`, in the `loopState()` doc block, says:

> `sync.spec.ts:165` fails on CI in five of ten red runs and **has never reproduced on this desk**, which is a difference nobody could measure.

It has now reproduced on this desk — 4 in 113, Rook's own measurement, in the work that landed that very comment. True when written hours ago and false when merged. Worth fixing in passing, and worth noticing as the thing this project keeps finding: a sentence that was accurate and quietly stopped being so, sitting in the code rather than in a doc.

Split out of `flake-sync-165` at Rook's insistence, and the insistence is right: this is a decision with a cost attached, not a tidy-up to append to the card that found it.

**The fault**, diagnosed and reproduced — see `flake-sync-165` and `docs/research/2026-09-15-sync-165-stale-echo.md`. A client-side redirect leaves a record in `issued[pane]` that is normally retired by its own echo. When that echo does not arrive, `ISSUED_MAX_AGE_MS` (10 s) will not prune it inside a 3 s test file, and the NEXT genuine load of the same URL is read as an echo. `mirror()` returns before comparing anything. About 4% of runs.

**Three candidates, all of which change what "echo" means for a superseded load:**

- **Retire on any new document**, not only on an echo.
- **Bound the record's age below a test file's length** — which is choosing a number, and the current number was presumably chosen for a reason nobody has written down.
- **Make the record identify the load rather than the URL**, so a second genuine load of the same address is distinguishable from the first one coming back.

**WHY THIS NEEDS A DECISION AND NOT A PATCH.** The `issued` map exists to stop the panes chasing each other. Loosening what counts as an echo is loosening the thing that prevents the loop — and the cost of getting that wrong is on the record: **the 252-load loop of 2026-09-03**. Whoever takes this should have that incident in front of them before choosing, because each candidate trades a stale expectation for a weaker loop guard, and the third is the only one that plausibly does not.

**The instrument already exists**, which is most of the work: `mirrorTrace()` and `sync-trace.spec.ts` land with `flake-sync-165` and will say which branch any candidate takes. Whoever fixes this can watch the fix change the branch rather than inferring it from a green suite.

**And the same discipline applies to the fix as to the trace:** four of the five mirror branches can be forced deliberately and `pane-destroyed` cannot — the spec says so in those words. Absence of `pane-destroyed` in a trace means nothing; absence of the other four means they did not happen.

---

## Review — 2

*Finished, waiting on the maintainer to merge.*

### Run the suite on a host unlike this laptop, more than once a release

[`ci-second-host`](../board/ci-second-host.md) · **B5** · chore · owner: Kenya

THE COMPARISON EXISTS, which is what this card asked for, and it comes out against B5's published number. Five runs a side, same code, same fixtures, same preset:

this laptop   Apple M4 Pro, 14 cores, 1x ultrawide      result fields moved: 0   182 s     CI            Apple M1 (Virtual), 3 cores                result fields moved: 3   225 s                   errors 0 and comparator control passed on both desks                   1,061 leaves a run, per-case leaf counts identical across desks

Both diverging cases are `grows-as-walked.html`, and the values say two different things.

**A NOTE THAT SOMETIMES DOES NOT FIRE.** On audit, `warnings.length` was 1, 1, 1, **0**, 1 across the five CI runs. The missing one is the page-is-still-moving note: "this page was still moving when it was measured: 40 had been replaced in the 254 ms after the figures were taken". On a 3-core VM that note fires four times in five. This is a real result difference and it is the one that matters: the tool's own warning about an unstable page is itself unstable there.

**A SENTENCE THAT EMBEDS A DURATION.** On lint, the same note fired all five times and its text still differed: 258 ms, 261 ms, 256 ms, 259 ms, 256 ms. Nothing about the page's measurement changed; the sentence quotes an elapsed time. A warning that embeds a duration can never be byte-identical across runs, so any sentence-level comparison flags it forever — on this desk too, if the note fired here at all.

**AND THE DIVERGENCE ITSELF VARIES.** The first CI run moved `pageHeight`, `summary.text.count` and `warnings[0]`; the second moved `warnings.length` and `warnings[0]` on audit and `warnings[0]` on lint. Same desk, same tree, different set. So "4 fields" and "3 fields" are both samples of a range rather than a figure, and the card records both rather than the tidier one.

NEXT, AND DELIBERATELY NOT DONE HERE: the classifier should separate "a sentence whose only difference is an embedded number" from "a sentence that appeared or did not". They are one bucket today, and they are opposite findings — the first is a wording property, the second is the tool answering differently. I did not change it after the numbers were taken, because the committed code should be the code that produced the artefacts on the card.

---

CLAIMED 2026-09-14 evening by Kenya, on Opeyemi's word given in his own session. IN DOING, not Review: the card is done when the COMPARISON EXISTS, and the second desk has not run yet. What exists is the harness that lets it, and one desk's numbers from it.

WHAT IS BUILT.

`scripts/b5-fixture-sweep.js` — the fixture half of the B5 sweep, committed. The original harness was five scratch files, thrown away on the grounds that the method was the thing to keep (docs/research/2026-09-14-b5-repeatability.md, "Reproducing it"). That is true for a method and false for a comparison: two desks cannot be compared unless both ran the same code, so this is the method made runnable rather than described.

It serves every fixture from memory so each run gets byte-identical bytes, runs `audit` and `lint` N times per fixture, flattens each reply to leaves, and classifies anything that moved as timing, path or result. It carries the original's vacuity guard — plant a raised count, a dropped finding and a changed sentence into the saved runs, and fail if the comparator cannot see them.

AND IT RECORDS THE DESK, which the original could not have known to do. `bug-retina` is why: three assertions recorded for two days as "fails on this laptop, passes on CI" turned out to track WHICH MONITOR WAS PLUGGED IN. Two hosts differing only in hardware tell you nothing if neither wrote down its display state. Every report carries CPU, cores, platform, and on macOS the `Resolution` / `UI Looks like` / `Main Display` lines that separate a 1x desk from a 2x one.

`.github/workflows/b5-sweep.yml` — the sweep on macos-14: different silicon, and a display that never moves. That fixed display is why CI is a useful second desk and also why it cannot finish the job — one unchanging desk is a second sample, not a range. Deliberately NOT part of the CI gate: a difference between desks is the result this card asks for, and a result that turns a pull request red is one people learn to route around. It runs weekly, on dispatch, and on a pull request that touches the harness itself — which is also how the first CI number gets taken, since `workflow_dispatch` is only offered for workflows already on the default branch.

THIS DESK, 2026-09-14 (baseline to compare CI against):

24 cases × 3 runs, preset laptop-768, Apple M4 Pro, 14 cores     main display 3440x1440, UI Looks like 3440x1440 — a 1x desk     result fields moved: 0 across 0 cases     errors: 0    comparator control: saw every planted difference     1,061 leaves compared per run, 109 s

That 0 agrees with the published fixture number, on the same machine that produced it, which is the weakest possible confirmation and is stated as such. The card turns on what CI answers.

TWO DEFECTS IN THE HARNESS, FOUND BEFORE IT PRODUCED A NUMBER ANYONE COULD USE. Both are on the card because both are the failure this whole criterion is about.

1. THE FIRST SMOKE RUN REPORTED A PERFECT GREEN OVER FOURTEEN CASES THAT HAD ALL FAILED TO LOAD. "result fields moved: 0" and "the comparator saw every planted difference", with every case carrying `load did not finish within 30000 ms` and 30 leaves where a real run has 50-180. Cause: `spawnSync` blocks the event loop that the fixture server runs on, so every run waited out its load budget against a server that could not answer until that run finished. Now async.

THE PLANTED-DIFFERENCE CONTROL PASSED THROUGHOUT, and was right to: plants go into the saved leaves, so they still differ when every run is equally empty. The control proves the comparator is not blind. It cannot prove there was anything to look at. So there is now a SECOND guard — each run must show it measured the page — and it checks the thing the first one structurally cannot.

2. THE SECOND GUARD THEN OVER-TRIGGERED, discarding `animated-tall` because its reply says "nothing to measure: the page had no visible text and no targets". That is a legitimate case, and in the original sweep five such cases were the STRONGEST result: their explanatory notes were byte-identical across all five runs. Only a load that never arrived makes a run empty of evidence rather than empty of findings.

Related, and the reason the fixture list changed: the first list was seven structural shapes, and 9 of its 12 valid cases had zero findings — so "0 fields moved" was a statement about 447 leaves, most of them the same four walk counts. Pages that actually produce findings (`audit`, `lint`, `contrast`, `hairline`, `app-shell-findings`) are in the core list now, which took it to 1,061. The original compared 3,375 a run over 33 cases; `--all` widens this one and the gap is honest rather than closed.

WHAT WOULD FINISH THE CARD: the CI run's numbers beside the ones above, both with their desks. A match means B5 survives with two desks behind it. A difference means B5's zero is about this machine, and every before-and-after measured against it inherits that. Done is when the comparison exists, not when it comes out a particular way — and per Henry, B5's zero is his and he would rather have it corrected than kept.

---

NEXT ON THIS CARD: the classifier puts two opposite findings in one bucket.

`scripts/b5-fixture-sweep.js` marks any differing warning string as a moved result field. Two things produce that, and they mean opposite things:

- **A sentence whose only difference is a number.** CI's lint runs all said "this page was still moving when it was measured: 40 had been replaced in the 258 ms after the figures were taken" — with 258, 261, 256, 259, 256. Nothing about the measurement moved. The sentence quotes an elapsed time, so it can never be byte-identical on any desk, and a sentence-level comparison will flag it on every run forever. That is a property of the wording, and the fix if anyone wants one is in the wording, not in the sweep.
- **A sentence that appeared or did not.** CI's audit runs had `warnings.length` 1, 1, 1, 0, 1: the same note, absent once. That is the tool answering differently about the same bytes, and it is the finding this card exists to surface.

The first is noise that will never go away. The second is the result. Today they arrive in one number, so a future run of this sweep reports "3 result fields moved" without saying whether any of it matters, and the person reading it has to open the artefact and diff the values by eye — which is what I did, and is not a thing a weekly job should require.

What I would do: normalise numbers inside a compared sentence, compare the normalised forms, and report three buckets rather than two — identical, same-sentence-different-number, and appeared-or-not. Then a zero in the third bucket is the claim B5 wants to make, and a non-zero in the second is a note to reword.

Deliberately not done while the card was open: changing the classifier after the numbers were taken would have left the committed code different from the code that produced the artefacts the card cites.

*Kenya's words, verbatim, landed by Henry — adding it needed a branch and a pull request, and Kenya had no word from Opeyemi for another one.*

### The resizing verdict is a race the fast desk always wins — 8 of 10 CI reds

[`bug-resizing-test-flaky-ci`](../board/bug-resizing-test-flaky-ci.md) · **C5** · bug · owner: Kenya

ASSIGNED TO KENYA 2026-09-15 on Opeyemi's word. Owner set here rather than by Kenya so it does not need a pull request merely to claim a card — that asymmetry is `bug-pr-checks-absent`'s problem, not this card's.

**THE RATE BELOW IS WRONG. It is not "about 1 run in 4" — it is EIGHT OF TEN.** That figure came from Henry's first count over four runs. All ten of main's reds are now classified (`bug-ci-main-red-37pct`), and `live-drive:963` is in eight of them. It is the most frequent failure in the suite, ahead of `sync.spec:165` at five.

**AND IT HAS A PARTNER IT HAS NEVER BEEN SEEN WITHOUT.** `live-drive:1015` appears in the same eight runs, eight for eight. Rook's observation, and it is a stronger constraint on the cause than either failure alone: this is one fault producing two symptoms, not two flaky tests that happen to agree. Counting them separately makes live-drive read as twice as noisy as it is.

The second symptom is the `info` cascade — `:1015` dies with `TypeError: Cannot read properties of undefined (reading 'token')` because `:963` left the shared app broken. So the second failure names the app when the first is what broke. Rook's `established.ts` in `chore-guard` makes that legible; it does not stop it.

**KENYA'S DIRECTION FOR THE FIX, in its own terms, and it is the reason this is Kenya's card.**

The wrong fix is loosening the assertion to accept either verdict, and the reason is sharper than "it asserts less": `expect(reason).toMatch(/resizing|animating/)` **would pass on a run where the cycle never started** — which is exactly what `expect(applied).toBeGreaterThan(20)` was written to catch. The loosening would un-catch the thing the test already catches.

**Assert the DISCRIMINATOR, not the label.** What distinguishes the two verdicts is whether the pane's viewport was still changing at the budget — a fact the test can measure directly by reading the viewport across the capture, rather than inferring from which branch the settle loop reached first. The label then becomes an observation the test records alongside its margin: how close the loop came to the other verdict.

> A test that asserts the state and records the label survives a faster host; one that asserts the label is asserting a race.

**WHAT THE FAILURE ACTUALLY IS, since it is not a broken provocation.** `expect(applied).toBeGreaterThan(20)` PASSES on the failing runs. The eight-preset cycle really runs; the pane really is being resized. Both labels are true of it — it IS resizing and it IS repainting — and which one `settleTarget` reports depends on which condition it reaches first, which depends on host speed. CI is a three-core VM; this laptop is a 14-core M4 Pro.

So this is the same shape as B5 and the Retina trio: a result about the machine, wearing the costume of a result about the code. Kenya has now met it three times in two days and caught it twice.

**main is RED as of c494f7c.** Found 2026-09-14 by Henry while checking something else — not by anyone watching CI, which is its own finding.

`tests/e2e/live-drive.spec.ts:963` — the test that proved `unsettledReason: 'resizing'` is reachable — fails on CI, and its failure poisons the rest of the file.

expected  { settled: false, unsettledReason: "resizing"  }     received  { settled: false, unsettledReason: "animating" }     at live-drive.spec.ts:1003, both attempts

**It is FLAKY, not broken.** The same test ran and PASSED on three earlier CI runs — 9e95410, bc29277, 4b46a49 — and failed on c494f7c, whose diff is board files and generated docs only and cannot have caused it. One failure in four observed CI runs.

**The vacuity guard held, which is what makes this diagnosable.** `expect(applied).toBeGreaterThan(20)` PASSED, so the eight-preset cycle really did run; the pane was genuinely being resized. The settle loop simply reached `animating` before it reached `resizing`. Without that guard this would look like a cycle that failed to start, and the fix would have been aimed at the wrong thing.

**THE SHAPE, and it is the day's:** a result that is about the machine, presented as a result about the code. `resizing` and `animating` are both true of a pane being cycled through eight viewports — it is resizing AND the page is repainting — and which one the loop reports depends on which condition it hits first, which depends on host speed. Kenya measured 3/3 locally; several CI runs agreed; this one did not.

This does NOT undo Kenya's finding. `resizing` is reachable and has been observed many times. What is not established is that this test *deterministically* provokes it, and the card that claimed it fires said nothing about the margin.

**THE CASCADE, which is the expensive half.** When :963 fails, the next test (`:1015`, the blank-page capture) dies with `TypeError: Cannot read properties of undefined (reading 'token')` — the exact `info` failure Kenya documented and Rook has just written a message for in `chore/suite-guard`. So one flaky test takes the file with it, and the second failure names the app when the cause is the first test. Rook's `established.ts` makes that cascade LEGIBLE; it does not stop it.

**What would settle it,** and the wrong fix is to loosen the assertion to accept either value — that would make the test pass while asserting nothing, which is the defect `chore-guard` exists to prevent:

- Measure the margin, as `flake-sync-165` now asks for its own case: across runs, how close does the settle loop come to the other verdict? A number, available every run.
- Then either make the provocation dominate on any host, or assert the discriminator that actually distinguishes the two — the pane's size changing, which is the thing being tested, rather than the label the loop happened to choose.

Related: `ci-second-host` is the card about exactly this question and Kenya has it open as PR #1. This failure is evidence for that card, arriving before it merged.

DELIVERED 2026-09-15 by Kenya, into Review. Branch `fix/resizing-verdict-race` (THE BRANCH IS THE ADDRESS). Cut from 1695eb3. NOT merged, NOT pushed — waits on Opeyemi's word given to Kenya directly.

THE TEST NOW ASSERTS THE STATE AND RECORDS THE LABEL.

Asserted: `applied > 20`, unchanged, which is what catches a cycle that never started. Then the discriminator — the test samples the target's viewport through the control surface at the same 80 ms cadence `settleTarget` polls it, and requires more than four readings taken, more than three distinct sizes during the capture, and the last size change within 1.5 s of the capture returning. Then `settled: false`.

Recorded, not asserted: which of `resizing` / `animating` came back, with its margin — distinct sizes, ms since the last change, applies, capture duration — pushed into a Playwright annotation so a CI log carries it.

ONE INVARIANT KEPT ON THE LABEL, because it is a real one on any desk: the reply's name must match its own sentence. `resizing` with a "keeps painting steadily" warning, or the reverse, means the two have been swapped. Any OTHER name on a pane measurably still moving throws rather than widening a tolerance — `timeout` and `blank` would be saying something untrue there.

THE NEW GUARD WAS WATCHED FAILING, not only passing. Stalling the cycle before the capture (1.5 s of applies, then stop, then shoot) took `sizes.size` to 0 and turned the test red. That run also exposed a diagnostic flaw in the first version: zero samples and a motionless pane both read as "no distinct sizes" and are opposite failures — the first says the test could not see, the second says there was nothing to see. They are separate assertions now, with separate messages.

VERIFIED: typecheck clean across all three configs; live-drive 45 passed, 58.1 s, twice.

NOT VERIFIED, and it is the half that matters: this desk only ever takes the `resizing` branch. The `animating` branch is what CI exercises and what the eight reds were, and no run on a slow desk has gone through this code yet. A green here is the less interesting half of the evidence.

AND THE CASCADE IS UNCHANGED, which is useful. The stalled-cycle run failed 2 tests, not 1: `:963` and `:1015` again. So the pairing does not depend on WHICH assertion fails in the first test. Per Rook's constraint: if this makes `:963` deterministic on CI and `:1015` keeps failing, that is evidence the cascade is a separate fault rather than a consequence.

---

## Done — 29

*Merged.*

### `settled` degrades to the old meaning on an older app, without saying so

[`bug-settled-fallback-silent`](../board/bug-settled-fallback-silent.md) · **C4** · bug · owner: obsrv-91

CLOSED 2026-09-14 — already fixed before this card was written, and the card was the one thing that was stale. obsrv-a6 raised it in review of obsrv-91's stack and obsrv-91 fixed it before merging: commit c8b7f15, merged in cdd7056, CI green at 1d4e505.

VERIFIED rather than taken on the peer's word: `git merge-base --is-ancestor c8b7f15 origin/main` → yes, and origin/main:src/mcp/server.ts ~1012 carries the warning, pushed into the same array as capture.warnings, saying the app is older than the capture's settle verdict, that `settled` therefore reports whether the navigation was confirmed rather than whether the page went paint-quiet, and to update the app for the other answer.

Closed rather than assigned deliberately: anyone taking it reads the code, finds the warning already there, and loses twenty minutes deciding whether they are looking at the right line. A card describing a fixed bug costs more than no card.

Original diagnosis below, which was exactly right.

`liveSnap` answered `settled: capture.settled ?? confirmed`. The fallback is RIGHT; the objection was that it was silent — one name meaning two things across app VERSIONS, in the commit whose whole point was removing that across surfaces.

### C5 is the criterion that catches what field comparison cannot

[`c5-elevated`](../board/c5-elevated.md) · **C5** · readiness · owner: Kenya

MERGED 2026-09-14 on Opeyemi's word, as 3f92680 on main, pushed. Verified here before pushing rather than taken on the branch's report: typecheck clean across all three configs, and live-drive 45 passed, 58.4 s against Kenya's 58.1 s.

And checked that the NEW TEST ACTUALLY RAN, which on this card of all cards is not a formality — a suite passing 45 while the one new test was skipped is exactly the defect being closed. `tests/e2e/live-drive.spec.ts:963`, listed as 35/45 in both runs, no skips, no flakes. Two runs, and unlike the retina verification these are genuine corroboration: the test provokes pane RESIZING, which is independent of the desk's display scale, so a second run on the same machine is not the same measurement twice.

C5 remains PARTLY MET and the merge does not change that: the 41 headless and MCP call sites are still unchecked, and readiness.md says so rather than implying otherwise.

DELIVERED 2026-09-14 by Kenya, into Review. Branch `docs/c5-note-inventory` (as of 856d268 + 5c6ad3d, rebased onto 98d3f82). THE BRANCH IS THE ADDRESS; the shas are a timestamp and do not survive a rebase — these are already the second set, the first being 6b7acb4 + d1706f0. Rebase was clean, no conflicts, and re-verified after it: live-drive 45 passed, 58.1 s, the same count and the same duration as before. Kenya confirmed 98d3f82 was in origin/main by merge-base before rebasing onto it rather than reading it off a message. NOT merged, NOT pushed — waits on Opeyemi's word given to Kenya directly. Split out from bug-retina at Henry's request so that one can merge first; no file appears in both branches, so they merge in either order.

Touches docs/breaking-changes.md, docs/note-inventory.md, docs/readiness.md, tests/e2e/live-drive.spec.ts. live-drive: 45 passed, 58.1 s.

d1706f0 also rewrites the 0.61.0 entry in docs/breaking-changes.md: `Decided 2026-09-14 rather than arrived at` now reads as OBSERVED, three of three. It keeps the eight-viewport cycle AND the 30,000-flip negative result, because the obvious two-preset test returns `animating` and reads as proof the value is unreachable — so the negative result is the load-bearing half of the record, not a curiosity.

THE CARD'S FALLBACK WAS WRONG AND IS NOW INVERTED. `unsettledReason: 'resizing'` FIRES. Seen 3 runs of 3, on a real page, in the app. KEEP THE VALUE — do not remove it. This also retro-justifies shipping the enum in 0.61.0: docs/breaking-changes.md says the state is real, and it now has an observation behind it rather than a decision.

Why it looked unreachable, which is the part worth keeping: settleTarget (ipc.ts:1093) exits on two EQUAL consecutive 80 ms viewport reads inside a 4 s budget. Flipping between TWO presets gives each pair of reads a coin-flip chance of agreeing, so it exits `settled` almost at once — Kenya measured that first, 30,000 flips deep, and got `animating`. EIGHT distinct viewports in rotation keep consecutive reads disagreeing across the whole budget, and only then does it fall through to 'resizing' at ipc.ts:1105. So the real-world shape is not `a capture that caught a resize` but `the viewport changing on essentially every read for four continuous seconds` — a window dragged by its corner while a capture runs. The card's guess that it needed a harness fixture rather than an HTML one was right; the guess that a preset flip would do it was the part that hid it for a day.

Delivered:
- tests/e2e/live-drive.spec.ts — the positive case beside the existing negative assertion at :955, so the pair reads `this is when it fires` and `this is when it must not`. Full spec 44 passed, 1 skipped, 55.6 s, unfiltered.
- docs/note-inventory.md — 58 emitting call sites; the 17 on the live surface hand-checked: 3 observed, 14 never seen, published as such with file and line.
- docs/readiness.md — C5 PARTLY met, with the 41 unchecked headless/MCP sites named as unchecked rather than implied done.

THE FOURTH SHAPE OF THE DAY'S DEFECT, named by obsrv-91 against its own shipped proposal, and the one that belongs highest on this card: A VALUE NEVER OBSERVED FITS TWO FACTS — either it cannot happen, or nobody has provoked it hard enough. Removing it on the first is right; removing it on the second is data loss. The two are indistinguishable until someone designs an experiment to make it fire.

obsrv-91 added `resizing` yesterday, told its user plainly it had never seen it fire, and proposed removing the value if it proved unreachable — suggesting a preset flip as the way to try. The flip is exactly what cannot produce it. So a CHEAP attempt to provoke a value feels like a test of reachability and is not: `nobody has made it happen` was never evidence it could not, and the error was reasoning as though one honest try settled it. obsrv-91's own words: its verification habit is to make checks fail on purpose, and this is the same move pointed at a value rather than an assertion.

TWO METHOD FINDINGS Kenya asked be kept out of the commit message: 1. A phrase sieve over the suite UNDERCOUNTS. Matching note text mechanically said `55 of 58 never asserted`; spot-checking six found four that ARE asserted, through regexes and partial phrases the matcher cannot see (cli-snap-tiled.spec.ts:102, cli-walk.spec.ts:137, others). The sieve is in the file as a pointer to where to look, explicitly not as a result. A number that reads as measurement and is not is the same defect as the note that had never fired. Anyone automating C5: this is the trap. 2. live-drive.spec sets `info` (control port and token) in the FIRST test of the file, so any -g filtered single-test run dies on `Cannot read properties of undefined (reading 'token')`. It reads like a bug in whatever test you just wrote. Cost a run.

### A genuine navigation mistaken for an echo — sync:165 diagnosed, not fixed

[`flake-sync-165`](../board/flake-sync-165.md) · bug · owner: Rook

MERGED 2026-09-15 on Opeyemi's word, as f4c3d36 on main. Typecheck exit 0 across all three configs, 1141/1141 unit, board:check green, sync.spec + sync-trace.spec 10 passed in 15.3 s. "Not fixed" was verified rather than taken: syncBus.ts carries only loopState(), mirrorTrace(), the MirrorDecision type and a trips counter.

**The card is Done and the bug is not.** The diagnosis is complete and the fix is `bug-stale-issued-echo`. A card closes when its work is done; the fault closes when the fault is gone.

The title conflicted on merge and was resolved by JUDGEMENT rather than regeneration — the branch carried the original *"went flaky once on the loop-breaker test"*, which this work proves wrong on both counts. Worth noting against the generator's rule: *regenerate, never hand-resolve* is about the GENERATED files. A card is a source and needs a real decision.

**FOUND. Branch `fix/sync-loop-margin` (as of f027a74), in Review — 1141/1141 unit, typecheck clean, board:check green. Merging waits on Opeyemi's word to Rook directly.**

**The mechanism: a genuine navigation is mistaken for an echo.** The previous test loads `redirect.html`, which does `location.replace('hairline.html')`. The bus issues that replacement into `target` and records it in `issued['target']`. Normally target's own commit comes back as an echo and RETIRES the record — sometimes that commit does not arrive before the next test starts. `ISSUED_MAX_AGE_MS` is **10 s** while the whole file runs in about **3 s**, so nothing prunes it. The next test's genuine load of hairline.html into target then matches the stale record, `retire()` calls it an echo, and `mirror()` returns **before any URL comparison runs**. Native sits on tall.html until the 5 s poll gives up.

**Two failing traces and two passing ones differ by exactly one line:**

passing   +2571 native->target issued hairline.html               +2577 target->native echo   hairline.html   <- retires the record               +2684 native->target issued tall.html               +2797 target->native issued hairline.html   <- step 2 mirrors, correct

failing   +2726 native->target issued hairline.html                     (the retiring echo never arrives)               +2838 native->target issued tall.html               +2952 target->native echo   hairline.html   <- read as an echo, nothing mirrored

**WHAT ROOK HAD WRONG, in its own words and worth keeping.** It expected the stale entry to be swept by step 1's mirror of TALL. It is not — and in the PASSING runs it is not swept either. What saves a passing run is that the record was retired earlier, by its own echo. **So the fault is not a missing sweep; it is a missing echo.** The hypothesis named the right exit for the wrong reason, and only the trace separated those.

Henry's guess — `other.getURL() === url` comparing a superseded URL — was one exit too late: the decision never reaches it.

**THE FIXTURE KNEW.** `tests/fixtures/redirect.html` carries this comment, written long before any of this:

> *Commits this URL, then replaces it: the client-side redirect shape SyncBus must survive without leaving a stale expectation behind.*

It leaves one about 4% of the time. The fixture named exactly what to test for and nothing ever checked it.

**Numbers, replacing every premise this card was written on:** margin 106–111 ms over 28 runs against a 3,000 ms window — a constant cannot explain a 4% event. **4 failures in 113 runs** on an idle fast machine, so not a slow-VM fault; six-core load left step times indistinguishable from idle. The directionality falls out of the previous test driving the native pane — **nothing in the bus is asymmetric, the test order is.**

**NOT FIXED, DELIBERATELY.** Verified: the `syncBus.ts` changes are pure instrumentation — `loopState()`, `mirrorTrace()`, the `MirrorDecision` type, a trips counter. Read-only, no behaviour change. The fix is `bug-stale-issued-echo`, because it is a decision rather than a tidy-up.

Write-up with the reproduction: `docs/research/2026-09-15-sync-165-stale-echo.md`.

**DECISION TRACE BUILT, AND EVERY BRANCH FORCED BEFORE ANY OF IT WAS BELIEVED** — `tests/e2e/sync-trace.spec.ts`, Rook, 2026-09-15. Still hunting: 25 runs with the trace, 0 failures, 60 more running.

**Four of five branches watched firing on purpose:** `issued`, `echo`, `already-there`, `trip`.

**The near-miss is the reason this mattered.** Rook's first attempt at `already-there` did not fire — loading the same URL into the *mirrored* pane is an echo and exits a branch earlier. It only reaches `already-there` when the SOURCE pane reloads: the bus never issued that pane anything, so it is not an echo, and the decision runs on to find the other pane already there. **Had the branch not been forced deliberately, the trace would have shipped with a line that never prints, and its absence would have been read as meaning something.**

**`pane-destroyed` CANNOT be forced, and the spec says so in those words.** Destroying a pane means tearing down the tab session the rest of the file shares — a destroyed pane is a tab that has gone, not a pane sitting idle. So, for anyone reading a trace: **absence of `pane-destroyed` means nothing; absence of the other four means they did not happen.** A known blind spot, named in the instrument rather than left for a reader to trip over.

**The instrument-perturbation risk, flagged by Rook rather than waited for:** `note()` now runs on every mirror, and 25 clean runs against a measured ~7% (2 in 28) is roughly a 1-in-6 coincidence. Not yet evidence the trace moved the fault, and not yet evidence it did not. 60 more runs are what settles it.

**THREE OUTCOMES, AND THE TRACE DECIDES BETWEEN THEM WITHOUT ANYONE ARGUING.** Rook's hypothesis, offered explicitly at the weight the margin hypothesis had an hour before it died:

- `target -> native echo hairline.html` — **Rook is right.** At step 2 the test loads HAIRLINE into `target`; the mirror begins with `retire('target', HAIRLINE, now)`, and HAIRLINE is a URL the bus issued into `target` during the PREVIOUS test, which leaves both panes on hairline.html. A surviving entry makes `retire` return true, the decision takes `echo`, and it returns before any URL comparison runs. Asymmetric for a concrete reason: `native` is the pane whose leftovers get swept, `target` carries a stale HAIRLINE from the test before. It usually does not happen because step 1's mirror of TALL retires everything sent at or before TALL, sweeping the stale entry — so the fault needs that sweep to have missed.
- `already-there` — **Henry's guess is right**, that `other.getURL() === url` compared against a superseded URL or a pane mid-commit.
- `issued`, with native still never moving — **both are wrong and the fault is downstream of the decision entirely**, in the load rather than in the choosing. Rook's note: this is the outcome neither proposed, and it is not the least likely.

**THE MARGIN IS NOT THE MECHANISM. The premise of this card is dead, killed by the first measurement taken against it — 2026-09-15, Rook.**

A readout on the loop breaker's own state (`sync.loopState()`, reads state and changes none), taken at the instant the test starts:

[loop-margin] sinceLastMirror=107ms  window=3000ms  alternations=0  spare=-2893ms

The test does not survive because the 3 s window expired. It starts **107 ms** in, with 2.9 seconds of the window still to run. It passes because `alternations` is **0** — `syncBus.ts:134` resets the count on any mirror that was not a *bounce*, and a bounce needs `inPage && armed && now - armed < BOUNCE_MS`. Four cross-document loads in a row never bounce, so the count never leaves zero.

**Measured over 28 runs of the file alone, plus three under six-core load:**

failures         2 of 28   ≈ 7%     margin at start  106–111 ms, EVERY run, idle and loaded     step times       9–119 ms across 76 completed steps, against a 5,000 ms budget     trips            0 on every passing run

- **The margin is a constant, not a variable.** It cannot explain a 7% event: a cause has to vary at least as much as its effect. This is not "unsupported", it is refuted.
- **Load is not the variable either.** Three runs under six busy cores gave step times indistinguishable from idle (11–132 ms). The slow-VM hypothesis was the whole reason `LOOP_WINDOW_MS = 3_000` looked suspect, and this desk reproduces the failure without being slow.
- **A step that normally takes 9–119 ms and occasionally exceeds 5,000 ms is not a slow mirror. It is a mirror that never happened.** Forty times the budget is not contention.

**THE FAILURE IS THE SAME ON BOTH DESKS, AND IT IS DIRECTIONAL.** All five CI reds and Rook's local failure are identical:

-   "native": ".../fixtures/hairline.html"     expected
+   "native": ".../fixtures/tall.html"         received
"target": ".../fixtures/hairline.html"     matched
Timeout 5000ms exceeded, at sync.spec.ts:182:60

`target` holds the new URL; `native` never follows. Step 2 of four, loading hairline into `target`. Never the reverse pair, never both stale. A symmetric fault would show `native` current and `target` stale on some runs; none do. **The stall is target→native.**

**`navigation mirror loop broken` appears in NONE of the five CI reds**, and `trips=0` on every passing local run. So the breaker is involved in neither the pass nor the failure — and obsrv-a6's remedy, splitting a test into its own file, was treating something that is not the cause. That is now evidence rather than the suspicion recorded lower down.

**WHERE IT STOPS, and why the next step is a different shape of work.** `mirror()` has at least four early exits — echo-retire, a destroyed pane, `other.getURL() === url`, and the trip — and **from outside the bus they are indistinguishable**. That is this project's own defect family in the instrument again: one silence fitting four facts. What would separate them is a decision trace — the last N mirror decisions with the branch each one took, read off a failing run. An instrument, not a fix, and the same move as the `loopState` readout that killed the premise.

**PENDING OPEYEMI'S DECISION.** The work approved was a margin measurement. The margin is measured and is not the mechanism. Continuing into a decision trace is a different scope and Rook has not assumed it.

**Rook's caution about its own evidence, kept because it is the right one:** one local failure is a shape, not a rate. "Identical to CI" rests on a single specimen on its side, and it is still collecting rather than treating 1-of-20 as characterised.

GO-AHEAD FROM OPEYEMI 2026-09-15. Owner set here rather than by Rook so claiming does not cost it a pull request — same reason as on the resizing card.

**THE INSTRUMENT IS NOW A COMPARISON, NOT A NUMBER, and that is better than the card was written for.** There is a desk where the margin is visibly insufficient and one where it is comfortable. `LOOP_WINDOW_MS = 3_000` against a three-core CI VM roughly four times slower than this laptop is a hypothesis with a shape, and it is testable rather than speculative. The failing side is available without waiting for luck — a CI run, or local load enough to stretch the handover past three seconds.

**FREQUENCY, corrected twice and now settled:** `sync.spec.ts:165` is in five of main's ten CI reds, four of them outside the two environmental runs. Second in the suite, behind `live-drive:963`/`:1015` at eight. See `bug-ci-main-red-37pct` for the full classification.

**`sync-mirror-mark.spec.ts:41` FAILS TOO, in both environmental runs** — and that is the file obsrv-a6 created to fix this very coupling by splitting a test into its own file. So the split moved the problem rather than removing it. Whatever this card finds, *"give it its own file"* is not the remedy, and that is now evidence rather than the card's earlier suspicion.

**Rook's own constraint, kept because it is the right one:** it counted Henry's table before accepting the premise from it, and found that `live-drive:963` and `:1015` never appear apart — one fault, two symptoms. The same scepticism applies here: if this card's margin explains `sync:165` but not `sync:138` (two reds, same file), that is a signal they are different faults sharing a file, not one.

**THE PREMISE BELOW IS WRONG AND HENRY WROTE IT.** The card was reshaped from a reproduction hunt into a margin measurement on the grounds that it *"failed once and six consecutive runs were clean"*, so hunting it could honestly end with nothing.

**It is not rare. `sync.spec.ts:165` appears in five of main's ten CI failures** — four outside the two environmental runs. The six clean runs were on this laptop; CI is a three-core VM roughly four times slower. That is `ci-second-host`'s thesis, and Henry failed to apply it to a card written an hour after correcting the identical error elsewhere.

The margin measurement is still the right instrument and is now better founded: there is a desk where the margin is visibly insufficient and one where it is comfortable, so it is a COMPARISON rather than a single number. `LOOP_WINDOW_MS = 3_000` against a machine four times slower is a hypothesis with a shape and is testable rather than speculative. The failing side is available without waiting for luck — a CI run, or local load enough to stretch the handover past three seconds.

And `sync-mirror-mark.spec.ts:41` — the file obsrv-a6 created to fix this by splitting the test out — fails on CI too. The split moved the problem. Whatever this card finds, "give it its own file" is not the remedy.

It is second in frequency rather than first: `live-drive:963`/`:1015` is eight of ten. See `bug-ci-main-red-37pct`.

QUEUED FOR ROOK 2026-09-14 on Opeyemi's word, behind `chore-guard`. Not started.

**RESHAPED FROM A HUNT INTO A MEASUREMENT, because a hunt for this can honestly end with nothing.** It failed once and six consecutive runs were clean afterwards. "Reproduce it" is a done-condition that may never be reachable, and chasing it would burn a session to report an absence — which this project has spent the day learning not to read as evidence.

The constants make a better question available. Read from `src/main/syncBus.ts`:

LOOP_ALTERNATIONS = 2      two consecutive reversals trips the breaker     LOOP_WINDOW_MS    = 3_000  ...if they fall inside three seconds     BOUNCE_MS         = 1_500     ISSUED_MAX_AGE_MS = 10_000

And `sync.spec.ts:165` is titled *"three navigations back and forth within a second"*. So the test is not near the threshold — **it sits on it**. Three back-and-forth navigations produce two reversals, and two is what trips the breaker. It passes because `alternations` is reset when the gap since `lastMirror` reaches `LOOP_WINDOW_MS` (`syncBus.ts:134`), and it fails when a preceding test's mirror is still inside that window.

**So the measurable question nobody has asked: how much of the 3 s window is left when this test starts, and how does that vary run to run?** That is a number, it exists on every run, and it says how much margin the file actually has rather than whether a rare event recurs.

What would make the card done:

- The gap between the previous mirror and this test's first navigation, sampled across runs. If it clusters just above 3 s, the file is one slow step from red and the split fixed the symptom rather than the coupling.
- Whether that margin is smaller on a loaded machine. The one observed failure came from a FULL-SUITE run; the six clean ones were not. That difference is the most likely cause and it is testable directly — run the file alone, then under load.
- The honest null is a real result: if the margin is large and stable, say so and close it. A number showing comfort is worth more than an unreproduced flake left open.

Context that makes this worth doing rather than shelving: obsrv-a6's remedy for the adjacent failure was moving a test to its own file (`sync-mirror-mark.spec.ts`), not timing the handover. That removed the test that was tipping it over and left the coupling in place, which is why this showed up again without an added test. Anyone adding another test to `sync.spec.ts` inherits this, and nothing in the file says so.

Reported by obsrv-e7 from its full-suite run, 2026-09-14: 'quick legitimate reversals are not a loop' failed once and passed on retry. That is the test obsrv-a6 was working around earlier the same day - a new test dropped into sync.spec made it fail half its runs because the file shares one app and the loop breaker counts reversals within LOOP_WINDOW_MS (3 s); the remedy was moving that test to its own file (sync-mirror-mark.spec.ts), not timing the handover.

So this is the same fragility showing without an added test, which means the shared-app coupling in sync.spec is closer to the edge than the fix implied. Worth knowing before anyone adds another test to that file. Not reproduced by obsrv-a6; six consecutive runs were clean after the split.

INTO REVIEW 2026-09-15, branch `fix/sync-loop-margin` off ef5df9d. Write-up: docs/research/2026-09-15-sync-165-stale-echo.md. The margin measurement is done and the answer is that the margin is not the mechanism; the mechanism is now known, reproduced here, and traced.

THE FAULT: a genuine navigation mistaken for an echo. The previous test loads redirect.html, which does location.replace('hairline.html'); the bus issues that replacement into `target` and records it in issued['target']. Normally target's own commit comes back as an echo and RETIRES the record. Sometimes that commit does not arrive before the next test starts — and ISSUED_MAX_AGE_MS is 10 s while the whole file runs in about 3 s, so nothing prunes it. The next test's genuine load of hairline.html into target then matches the stale record, `retire()` calls it an echo, and mirror() returns BEFORE issuing anything to native. Native sits on tall.html until the 5 s poll gives up.

EVIDENCE: two failing traces and two passing ones, differing by exactly one line — the retiring echo (`target->native echo hairline.html`) is present in every pass and absent in every failure, between the redirect's issue and step 1. tests/fixtures/redirect.html's own comment, written long before this, says the shape "SyncBus must survive without leaving a stale expectation behind". It leaves one about 4% of the time.

MEASURED, replacing the card's premises: margin at start 106-111 ms over 28 runs (3,000 ms window, so 2.9 s still to run) — a constant cannot explain a 4% event; 4 failures in 113 runs on an IDLE fast machine, so it is not a slow-VM fault; three runs under six busy cores had step times indistinguishable from idle; trips=0 on every passing run and `navigation mirror loop broken` in none of the five CI reds. Direction (target->native, never the reverse, both desks) falls out of the previous test driving the native pane — nothing in the bus is asymmetric, the test order is.

RULES OUT: the loop breaker, in both the pass and the failure. LOOP_WINDOW_MS being too tight. And splitting the file — sync-mirror-mark.spec.ts was created to fix this coupling by moving a test out and fails on CI too; a stale record inside one bus is not cured by moving a test to another file.

INSTRUMENTS, both of which had to be made honest before being believed: sync.loopState() (reads state, decides nothing) and sync.mirrorTrace() (the last 64 decisions with the branch each took). Four of mirror()'s five branches are forced deliberately in tests/e2e/sync-trace.spec.ts and watched; `pane-destroyed` CANNOT be forced without tearing down the shared tab session, and the spec says so — absence of that branch in a trace means nothing, absence of the other four means they did not happen. Forcing caught a real defect in the instrument: the first attempt at `already-there` never fired, because loading the same URL into the MIRRORED pane is an echo and exits a branch earlier.

NOT FIXED, deliberately: this card was to measure, and the fix changes behaviour the rest of the bus depends on. Three candidates, argued on the write-up: retire on any new document rather than only on an echo (moving `issued[from].clear()` above the echo check, which also changes what echo means for a superseded load — see the 252-load loop of 2026-09-03); bound the record's age to something shorter than a test file (10 s today, 1-2 s would do, smallest and least principled); or make the record identify the load rather than the URL (most correct, largest). Whoever takes that should pick with the 2026-09-03 history in front of them.

### Write: what an agent can do to the machine

[`d2`](../board/d2.md) · **D2** · readiness · owner: obsrv-a6

docs/agent-control.md — every control command grouped by what it means, the four gates, the consent bar, and the boundary it does not cross (0600 control.json is readable by anything running as you). Merged c33ee74.

### Write: what leaves the machine, and what is written where

[`d3`](../board/d3.md) · **D3** · readiness · owner: obsrv-a6

README § Privacy and files — one outbound request (the daily version check), every file named with its directory, and the log stated for what it does not record. Verified: zero log call sites record a URL. Merged c33ee74.

### Issue template that asks for what we need

[`e1`](../board/e1.md) · **E1** · readiness · owner: obsrv-a6

.github/ISSUE_TEMPLATE/bug_report.yml — requires the JSON, asks for address, command, surface, version and host display. config.yml puts the limitations page in front. Merged c33ee74.

### Make diagnostics reachable from the README

[`e2`](../board/e2.md) · **E2** · readiness · owner: Rook

MERGED 2026-09-14 on Opeyemi's word, pushed. E2 is MET.

Verified here before pushing rather than taken on the branch's report. typecheck clean across all three configs; the version flag answers 0.60.0 on both `--version` and `-v`, bare semver on stdout, nothing on stderr, exit 0, matching package.json.

The claim worth checking independently was "works where the build or the download is what broke", and my own checkout has out/ present, so a run here proves nothing about it. Built the case instead: everything npm ships (`files` is bin, out, skills, README, LICENSE, .claude-plugin, .mcp.json) minus out/ and node_modules.

node bin/obsrv.js --version   ->  0.60.0, exit 0   node bin/obsrv.js snap ...    ->  exit 1, "out/main/cli.js is missing"

The second line is what makes the first mean anything: without a control showing the environment really is broken, a version answer could just be a working install. First attempt at this was WRONG and would have reported a defect — I copied only bin/obsrv.js, it crashed on `require('./electronPath.js')` at line 14, and that looked like the version check being unreachable behind a missing module. bin/electronPath.js is committed and inside `files`, so no real install lacks it. I had constructed an install npm could never produce.

TWO PATHS NOW ANSWER THE SAME QUESTION, which in this project is usually where a defect lives, so it was checked rather than assumed: bin/obsrv.js reads `../package.json` from bin/, cliVersion() reads `../../package.json` from out/main/. The same repo-root file, identical inside app.asar, with app.getVersion() as the fallback. They agree by construction rather than by being kept in step.

REBASED THREE TIMES while waiting: 717e924, 43b110e, cfe22c5, content unchanged throughout. The card tracked it as `feat/cli-version (as of ...)` and stayed true across all three — the convention earning itself rather than being argued for. The last rebase was checked for having preserved Kenya's C5 edit to docs/readiness.md, since both branches touched that file: intact, and the branch's diff turns out to touch only the E2 section.

DELIVERED 2026-09-14 by Rook, into Review. Branch `feat/cli-version` (as of 43b110e, rebased onto 403717b), worktree .claude/worktrees/rook-cli-version. THE BRANCH IS THE ADDRESS; the sha is a timestamp and does not survive a rebase — this is the second sha, the first being 717e924.

That rebase is also the convention's first observed instance rather than a predicted one, and Henry found it by looking at the worktree rather than by being told, so it is worth saying how it was checked. A file-count comparison is NOT sufficient: `git diff 717e924 43b110e` spans every main commit in between and shows 15 files, which proves nothing either way. The check that settles it is each commit's OWN patch: `diff <(git show --format=\"\" A) <(git show --format=\"\" B)`. Result here — identical but for one blob index and one hunk offset in src/cli/main.ts (@@ -1556 becomes @@ -1566, because main moved ten lines in that file). Textbook clean rebase, content unchanged. NOT merged, NOT pushed — merging waits on Opeyemi's word given to Rook directly.

What it does: bin/obsrv.js answers --version and -v from package.json BEFORE it looks for out/ or the Electron binary, so the flag works on the machine where the build or the download is what broke. The built entry answers the same flag under Electron. --help lists it. Bare semver on stdout, nothing on stderr, exit 0.

Evidence, measured not read:
- RED first: parseArgs(['--version']) threw `unknown command: --version` — COMMAND, not flag, because the token is argv[0] and hit the command check rather than the flag loop.
- GREEN: 1118/1118 unit, typecheck clean.
- `node bin/obsrv.js --version` → 0.60.0 in a checkout with no out/ and no Electron binary present.
- tests/unit/cliLauncher.test.ts pins that: launcher beside its own package.json, no out/, no node_modules, so every Electron route fails there and a version on stdout proves it never took one.
- Not run: e2e (nothing in it touches this path).

Also landed: README (Agent & CI line + Privacy and files paragraph naming all three places the version lives), issue template now says `obsrv --version` (0.61.0+), docs/readiness.md E2 → met 2026-09-14.

Original card below.

Partly met by D2/D3: the log's location is now reachable from the README and the issue template. The gap that remains is that there is no `obsrv --version` — where a CLI user would look.

### Release notes and a register for 0.61.0's three breaking changes

[`c2-0610-breaking`](../board/c2-0610-breaking.md) · **C2** · readiness · owner: obsrv-a6

docs/breaking-changes.md — a durable register, newest first, each entry saying what breaks, what to do, and why. Holds 0.59.0's `url` change and 0.61.0's three (presetId/profileId removed; walk sentences notes->warnings; unsettledReason gains resizing, carrying the session-restart instruction because a stale MCP schema rejects a correct reply). Linked from README and the limitations page. Corrected readiness.md, which had the `url` change in 0.60.0 when git tag --contains puts it in v0.59.0. Merged 9f92351.

Still open, deliberately: the 0.61.0 entries are marked unreleased/pending — the fixes are obsrv-e7's and unmerged, and the `resizing` enum is a decision Opeyemi has not made. Draft release notes for 0.61.0 are in obsrv-a6's scratchpad, to be applied when the release is cut.

### Field-level sweep: both surfaces answer the same

[`c4`](../board/c4.md) · **C4** · readiness · owner: obsrv-e7

Merged cdd7056, pushed 2026-09-14. ALL SEVEN COMMITS NOW READ BY A SECOND PAIR OF EYES: obsrv-a6 reviewed 02656b8 and 5214d59 before the merge, and 80f3675, 603e605, c8b7f15 and 165429a after it (c48ca63 read in working-tree form). Nothing found that makes the merge wrong.

Work: tests/e2e/surface-parity.spec.ts drives audit/lint/inspect/snap through both surfaces over 11 pages and gates every remaining difference against an EXPLAINED table with a reason each; docs/research/2026-09-14-c4-field-sweep.md argues each finding. Six defects found and fixed, divergences 36 -> 22, plus a seventh found in note text. Suites: unit 1116, e2e 508 passed / 3 failed (the documented Retina trio, green on CI).

Two review findings, both raised as follow-ups rather than blockers:

1. The gate cannot go stale-detect. An EXPLAINED entry that no longer diverges is never flagged, so the table drifts into a list of things that USED to differ, and an entry means either 'still diverges, here is why' or 'nobody removed it' with no way to tell. Same silence-fits-two-facts shape the sweep itself exists to find. Carded: bug-explained-table-stale.

2. 80f3675's comment cites cli/main.ts:933-938 for the three headless sentences; those lines are the load and the inspect ask. The real site is ~945-953. Appears twice in that commit. Carded with the staleness one.

NOT closed by this: the seventh divergence, in note text on app-shell-grows, which a field-level gate structurally cannot catch (see the `hidden` card); and `resizing` is a schema value added today that has never been observed to fire (see C5).

### The parity gate cannot tell a live exemption from a forgotten one

[`bug-explained-table-stale`](../board/bug-explained-table-stale.md) · **C4** · bug · owner: obsrv-a6

Merged a5c1a3c and pushed 2026-09-14 (commits d69b2c1 + cbe4981, rebased onto 1d4e505).

The gate failed when a difference had no reason; nothing failed when a reason had no difference, so a row meant either 'still diverges, here is why' or 'nobody removed it'. The head of EXPLAINED already claimed the table 'cannot go stale without going red' — now true, and self-pruning: closing a divergence forces its exemption out.

VERIFIED four ways, and again after the rebase:   clean table                      -> 12 passed (twice)   planted stale row                -> RED, naming tool, field and reason   planted row for a tool never run -> quiet (the guard holds)   filtered run, nothing compared   -> fails loudly, 'nothing to check'

The fourth exists because the first verification attempt was wrong: with -g the per-page tests never populate `rows`, so a planted stale row came back green. cbe4981 makes that loud.

obsrv-e7 wrote the same fix concurrently and discarded it: its version had no answeredBoth guard, so a tool that errored everywhere would have had every exemption called stale.

CAVEAT ON THE MERGE, recorded because it is the day's own lesson: pushed while CI on the base (1d4e505) was still running. Local green was the only evidence, and local green on this machine is exactly what proved insufficient an hour earlier — see the 'agreement that fits two facts' card. If CI on a5c1a3c is red, check 1d4e505's own run before attributing it here.

NOT observed: `answeredBoth` returning false for a row carrying an error. The branch it feeds IS observed; the predicate has not been seen to fire on a real error.

### Check the skill describes the tools that exist

[`c3`](../board/c3.md) · **C3** · readiness · owner: Kenya

MERGED 2026-09-14 on Opeyemi's word, as 83392d6 on main. Verified before pushing: typecheck clean, 1121/1121 unit, board:check green, and both review fixes confirmed present in the merged SKILL.md rather than assumed to have survived the conflict resolution.

C3 STAYS PARTLY MET. The skill now names the version it was written against, documents `obsrv --version`, carries the warnings-versus-notes rule and the live-only `resizing` clause. What it does not do is discharge the criterion: the skill is one document, and C3 is about whether what we tell agents matches what the tools do.

REVIEW ROUND 1 found two defects and both were in the FIX, none in the audit. That asymmetry is the finding. Nine claims read against source came back clean; four paragraphs written from freshly-learned material did not, and one of them committed the exact family the card existed to close — a sentence true of `obsrv_drive` alone, stated of all eight tools, written into the fix for three sentences of that kind.

DELIVERED 2026-09-14 by Kenya, into Review. Branch `docs/c3-skill-audit` (as of the tip; THE BRANCH IS THE ADDRESS, the sha is a timestamp). Cut from 0893bd7. NOT merged, NOT pushed — waits on Opeyemi's word given to Kenya directly. Claimed by editing this file, which is the first card claimed under the repo board rather than through Henry.

STATUS: PARTLY MET, and the unchecked part is named below rather than rounded up. The same precedent as C5.

WHAT WAS CHECKED, EACH AGAINST THE CODE RATHER THAN AGAINST THE PROSE'S PLAUSIBILITY. Nine claims read out of SKILL.md and looked up in src/:
- the eight tool names — all registered (Henry's up-front measurement, confirmed)
- `mode` / `why` values (requested, headless-only, no-display, declined, launch-timeout) — match the enum at server.ts:345 exactly
- `obsrv_report` and `obsrv_diff` have no `mode` or `why` field — true; neither key exists in either output shape
- the 1.5 MiB inline cap — MAX_INLINE_IMAGE_BYTES = 1_572_864 (lib.ts:16)
- "at most 200 findings listed" — server.ts:1360 and :1661
- 7 mm taps / 2 mm text — DEFAULT_TAP_MM, DEFAULT_TEXT_MM (cli/audit.ts:23)
- diff's 2048px CSS viewport limit — server.ts:1201
- the eight throttle preset ids — shared/throttle.ts:42-49, all eight, spelled as the skill spells them
- the render-slot wait landing "in its warnings or notes" — matches server.ts:145

THREE DEFECTS FOUND, ALL OF THE PREDICTED SHAPE: stable tool name, moved behaviour, nothing fails.

1. `unsettledReason` was enumerated in Caveats as animating / timeout / uncovered / blank / loading — five of the six. `"resizing"` was missing, and it is the LIVE-ONLY value, in the one place the live Review section sends a reader to for that field. It became real earlier the same day (c5-elevated), so the skill was wrong about the thing this room had just proved. Now documented with what provokes it: a viewport that keeps moving for the whole budget, not a capture that followed a preset change.

2. `obsrv --version` was absent from Commands, which is where a CLI user looks. It has existed since the E2 merge. Added with the property that makes it worth having — it answers before the build or the Electron binary is looked for, so it works on the machine where one of those is what broke.

3. NO VERSION MARKER ANYWHERE IN THE FILE, which is the finding under the other two rather than a nitpick. Nothing in the skill said which surface it was written against, so no reader could tell the 0.60.0-era prose from the current shape, and neither defect above could have been noticed by reading. Now: "Written against Obsrv 0.61.0 (2026-09-14)", with `obsrv --version` and any MCP reply's `version` named as the check and docs/breaking-changes.md as the list of what moves under stable names.

ONE ADDITION THAT IS NOT A DEFECT FIX: the warnings-vs-notes rule (warnings is about the page, notes is about the call) is now stated in The MCP tools, with the 0.61.0 move of the live walk's sentences named. The skill was not wrong here — it never told anyone to read the old location — but it gave an agent nothing to decide with, and this is the field that moved most recently.

NOT CHECKED, AND THIS IS WHAT KEEPS IT AT PARTLY MET: the skill is 265 lines of prose and nine claims were verified against source. The Review (live) walkthrough, the regression loop, and the diff caveats were read for staleness but not executed. A claim about what a tool SAYS can only be settled by running it, which is C5's standard, and by that standard this card is an inventory rather than a proof. The honest next step is running the Review (live) sequence end to end against the current build and checking each sentence it produces.

REVIEW ROUND 1, Henry on 452b212: two findings, both in the FIX rather than in what it fixed, both confirmed against source by Kenya before changing anything, both corrected.

(1) "or any MCP reply's `version`" was FALSE. `version: z.string()` appears exactly once in src/mcp/server.ts — line 707, inside driveOutputShape. Seven of the eight tools do not carry it, so an agent told this reads a snap reply, finds nothing, and concludes it has an old Obsrv: the exact failure the paragraph was added to prevent. It is also C3's own shape — a sentence true of one tool, stated of all — introduced while closing three of the same kind. Now: `obsrv --version`, or `obsrv_drive`'s `version` field, named as the only reply that carries one.

(2) The staleness rule was ONE-DIRECTIONAL and today only the other direction is true. The header said "written against 0.61.0" and "where they differ, the reply is right and this page is out of date". But package.json is 0.60.0 and docs/breaking-changes.md still marks 0.61.0 unreleased, so every reader's version differs by being OLDER, and the rule told them the page was stale when the page is ahead of their install. A version mismatch fits two facts — the page is behind the tool, or ahead of it — and the rule named only the first. Now the header says the page is ahead of the current release and spells out both directions, with the marked claims (`0.61.0+`) as the ones to read as future.

THE TRAP, KEPT VISIBLE because Henry nearly published it as a result and it is the same one from note-inventory.md: the eight-of-eight tool count is a MENTION count. It says the skill mentions lint; it says nothing about whether what it says about lint is true. Two of the three defects above are inside sentences about tools that count as present. A completeness number over a document measures the index, not the content.

### Regenerate the public board as part of cutting a release

[`chore-board-on-release`](../board/chore-board-on-release.md) · chore · *unclaimed*

CLOSED 2026-09-14 — dissolved rather than done, by moving the board into the repo.

The card asked for regeneration at release time, which was the best available answer while the source lived in an artifact only one session could read. It is now the wrong granularity: `docs/board.md` is generated from `board/` in the same commit, and CI runs `npm run board:check` on every push, so a card edited without regenerating fails the build immediately rather than surviving until the next release.

Releases were never the right trigger. The board went stale in six hours, then ten minutes, then twenty — all of them well inside one release.

docs/board.md is public (github.com/vibesyemmy/obsrv/blob/main/docs/board.md) and is the only surface an outside contributor has. It is generated by `npm run board` and nothing regenerates it, so it drifts from the artifact the moment a card moves — and a stale board is worse than none, because it sends someone to claim work that is already done.

It was built with three guards against reading as current when it is not: a generation date, a line saying the artifact is authoritative, and a reproducible generator. Those make drift VISIBLE. This card makes it RARE.

The obvious hook is `npm version`, which already runs scripts/sync-plugin-version.js and git-adds the plugin manifest — the same shape of problem (a generated file that must not lag the thing it describes) already solved once in this repo. Adding the board there means the public copy is never more than one release behind.

ONE PROBLEM TO SOLVE FIRST, and it is why this is not a two-line change: `npm run board` takes a dump directory as an argument, because the board lives in a Claude Artifact that a shell script cannot read — the dump comes from the Artifact tool's read_db with out_dir, which only an agent session can call. So a release hook cannot regenerate it unattended today.

Three options, roughly in order of how much they are worth:
- Make the release checklist say 'ask the session to run npm run board and commit it' — honest, costs nothing, relies on a human remembering.
- Have the version hook FAIL when docs/board.md is older than the newest card's updatedAt, so a release cannot be cut on a stale board. Needs a dump to compare against, so it has the same reachability problem, but only as a check rather than a build.
- Export the board to a committed JSON alongside the markdown, so the generator has a repo-local source and only the export needs a session. Then `npm run board` is reproducible by anyone and the drift check is trivial.

The third is the one that makes the file honest rather than merely fresh, and it is the one worth the time.

### Install, use, uninstall — then list what remains

[`a4`](../board/a4.md) · **A4** · readiness · owner: Rook

MERGED 2026-09-14 on Opeyemi's word, as 89b17f4 on main. Verified before pushing: typecheck clean across all three configs, 1121/1121 unit, board:check green.

THE CARD IS DONE AND THE CRITERION IS NOT MET, and those are different things. The work asked for was to measure what remains; it was measured, on a real packaged build. A4 in docs/readiness.md reads NOT met, and the remaining work lives in bug-history-survives-uninstall, chore-uninstall-path and bug-control-json-crash-stale rather than in this card. Closing the card does not close the criterion.

docs/board.md conflicted on the merge and was resolved by regenerating, which is the first time the rule in scripts/build-board.js's header was exercised on main rather than on a branch. It held.

ASSIGNED to Rook 2026-09-14 evening as gap work while A1 is parked on Opeyemi. Chosen because the card says in its own words that the check has NEVER BEEN RUN — which is what Rook asked for, work that measures something nobody has measured rather than restating it — and because it sits in the launcher and headless path Rook is warmest on after e2. It also tests e2's own territory from the other end: e2 made the CLI answer on a machine where the build or the download is what broke; a4 asks what a fresh install actually puts on that machine and what survives removing it.

Temp leak closed by src/shared/pruneTemp.ts. ~/.obsrv and the Electron profile untouched by that fix; nobody has measured what is left behind.

HARD CONSTRAINT, and it is the reason this card has sat unclaimed safely: DO NOT uninstall from, or delete, the real ~/.obsrv, the real Electron profile, or anything under Opeyemi's own HOME. He uses this machine and the dev lane lives there. Run the whole cycle under an ISOLATED HOME — the same move Kenya used for the dev lane with OBSRV_DEV_HOME — so install, first run, and uninstall all happen somewhere disposable and the measurement is of a fresh machine rather than of this one. A reading taken from a HOME that has run Obsrv for weeks answers a different question and would look identical.

WHAT DONE LOOKS LIKE: a list, per surface, of what exists on disk after install, after one real use, and after uninstall — with the paths named. The interesting number is the third one. A finding of `nothing remains` is a real result and needs the same evidence as a finding of `these four paths remain`, because an empty list fits both `it cleaned up` and `I looked in the wrong place`.

STARTED 2026-09-14 evening, branch `chore/a4-install-remains` off 9134567. Claimed by editing this file, which is the mechanism now — Rook's board writes were never a permission (bug-board-access, dissolved).

SCOPE THIS PASS, Opeyemi's call: the CLI and MCP surfaces — a global npm install into a throwaway prefix, a real CLI run, an MCP server run, `install-skill` — all under a disposable HOME. The desktop app half (an unsigned DMG built locally, mounted, run, removed) waits on a separate yes, and is where `settings.json`, `history.json`, `tabs.json` and `obsrv.log` live, so the criterion is not fully answered until it is done.

FOUND BEFORE RUNNING ANYTHING, by reading: this card and docs/readiness.md:50 both name `~/.obsrv` as where the app's state lives. NOTHING in the source writes there. The app uses Electron's `app.getPath('userData')` (`~/Library/Application Support/Obsrv`, per ipc.ts for settings/history/tabs/control.json) and `app.getPath('logs')` (`~/Library/Logs/Obsrv`, per main/log.ts). `~/.obsrv-dev` is the dev lane (scripts/devLane.js), and `~/.claude/skills` is install-skill's target. So the criterion has been pointing at a path that may not exist — the "I looked in the wrong place" half of its own warning, sitting inside the check.

GATE BEFORE ANY INSTALL: prove the isolated HOME is actually honoured before trusting a single path in the result. Setting the variable is not evidence it was used, and a reading from a contaminated HOME is indistinguishable from a clean one. If Electron ignores HOME for some paths, that finding outranks this card — every isolated-lane assumption in the project, the dev lane included, rests on it.

INTO REVIEW 2026-09-14, branch `chore/a4-install-remains` off 9134567. Full write-up: docs/research/2026-09-14-a4-install-remains.md. Real profile counted before and after (22,251 entries in ~/Library/Application Support/Obsrv, unchanged; all five sentinel paths identical), so "nothing of Opeyemi's was touched" is evidence rather than an assurance.

THE GATE FAILED, AND THAT IS THE BIGGEST FINDING. Electron on macOS IGNORES HOME for home/userData/appData/logs/cache — os.homedir() follows it, Chromium does not. A HOME-only sandbox writes into the real profile while every Node-level check reports the fake path. CFFIXED_USER_HOME moves them; --user-data-dir moves userData/sessionData/crashDumps but NOT logs, so the dev lane and the installed app share one ~/Library/Logs/Obsrv/obsrv.log. Neither lever moves app.getPath('temp'). Anything in this repo that isolates by HOME needs re-checking.

THE CRITERION NAMED A PATH NOTHING WRITES. `~/.obsrv` does not exist on a machine that has run Obsrv for weeks, and no source writes it. Corrected in docs/readiness.md.

WHAT REMAINS after `npm rm -g getobsrv`: 128 MB, and it is ~/Library/Caches/electron/<sha>/electron-v43.7.0-darwin-arm64.zip — put there by @electron/get on first run, outside node_modules, removed by nothing, documented nowhere. Plus ~/.claude/skills/obsrv-screens (correct, but install-skill has no removal and nothing says it survives). CLEAN, measured on a real render and a real MCP handshake: no obsrv-cli-* and no obsrv-mcp-* entry left anywhere.

APP HALF DONE 2026-09-14 on Opeyemi's word, same branch. Unsigned arm64 DMG built from this tree, mounted, copied into a disposable home's Applications, launched under CFFIXED_USER_HOME, a page loaded by typing its URL, quit cleanly, bundle deleted. Isolation read from INSIDE the running app (app.getPath) rather than inferred afterwards. Real profile counted before and after: 22,251 entries, unchanged.

THE RESULT IS THAT A4 IS NOT MET. Deleting Obsrv.app removes exactly one thing: the app. 87 entries after one page load, 86 after deleting the bundle. What stays: settings.json, tabs.json, obsrv.log, the whole Chromium profile (Cookies, Local Storage, Session Storage, Trust Tokens, TransportSecurity, the caches) and — the one that matters — history.json, the addresses visited in the app. The README says history.json holds them; nothing says it outlives the app, and there is no uninstall command.

ALSO MEASURED: control.json (port, token, pid, 0600) is removed on a clean quit and SURVIVES a SIGKILL — proved deliberately with both, since two runs differing in one thing is a hypothesis. Harmless to discovery (a dead pid reads as no app) but it then survives the uninstall too.

TWO ASIDES, neither A4's: the locally built DMG carries no quarantine attribute, so nobody testing a local build reproduces the README's "damaged" dialog. And electron-builder signed it with `Restack Dev` and reported success — docs/signing.md step 3's warning, reproduced without trying. That one belongs to a1.

### Record what the thresholds were calibrated against

[`b3`](../board/b3.md) · **B3** · readiness · owner: obsrv-a6

docs/thresholds.md — seven judged numbers, each answering what it derives from / was calibrated against / would move it, sorted into standard-borrowed, calibrated, reasoned-only, and definitional. Linked from README, limitations, audit.md, lint.md. Merged 1e1594a.

### fit-cap and onion-skin fail rather than skip when the desk scales the capture

[`bug-retina`](../board/bug-retina.md) · bug · owner: Kenya

MERGED 2026-09-14 on Opeyemi's word, as 98d3f82 on main, pushed. Verified by Henry before pushing rather than taken on the branch's own report: npm run typecheck clean across all three configs (tsconfig.node / web / mcp — the single-config shortcut is what let a red commit reach main earlier this week), and fit-cap + onion-skin 7 passed, 16.9 s, matching Kenya's 16.3 s.

WHAT IS AND IS NOT PROVEN AFTER THE MERGE. Henry first wrote that his run exercised only `skip false` and that Kenya's forced-scale run was the evidence for the other direction. Kenya corrected that as too generous and it is; the corrected version, checked against docs/e2e-flakes.md rather than argued:

(a) PROVEN, physically, 2026-09-12: the three assertions FAIL on a real 2x main display. The flakes doc records it — external monitors disconnected, the Mac on its built-in Liquid Retina XDR alone (3024x1964, 2x), three runs in a row red, while the same commit's CI on macos-14 passed the whole suite. (b) PROVEN, synthetically, today: with --force-device-scale-factor=2 the probe returns 2 and the predicate skips; plain launch returns 1 and it does not. (c) NOT PROVEN, and it is the join between them: nobody has run captureScale() — written today — on a machine whose DISPLAY is 2x. The 09-12 observation predates the probe.

And (b) is weaker than it looks: --force-device-scale-factor forces the APP's scale, while the documented cause is the HOST DISPLAY's scale (e2e-flakes.md: capturePage answers at the host display's scale whatever the target's own density). Those are different knobs that happen to produce the same ratio, so (b) shows the arithmetic and the predicate agree — not that the probe reads a real 2x desk correctly.

HENRY'S AND KENYA'S GREEN RUNS ARE THE SAME EVIDENCE, NOT TWO. Both are 1x desks exercising `skip false`. Two sessions agreeing looked like corroboration and was one measurement taken twice — which is this project's agreement-fits-two-facts defect, arriving in the verification of the card that is about exactly this.

ONE RUN ON THE BUILT-IN DISPLAY ALONE closes (c), and the same run says whether onion-skin's 50% test belongs in the skip.

DELIVERED 2026-09-14 by Kenya, into Review. Branch `fix/retina-desk-skip` (as of 9fe0fda + 59b6097, cut from 2c7c0a9). THE BRANCH IS THE ADDRESS; the shas are a timestamp — Kenya rebases on request when main moves, and the content survives while the shas do not. NOT merged, NOT pushed. Opeyemi picked this card directly. MERGE THIS ONE FIRST — it makes every other local run cheaper to read; it shares no file with the C5 branch, so the two merge in either order and the sequencing is a choice rather than a constraint.

Touches docs/e2e-flakes.md, tests/e2e/fit-cap.spec.ts, tests/e2e/helpers/captureScale.ts, tests/e2e/onion-skin.spec.ts. fit-cap + onion-skin: 7 passed, 16.3 s. Typecheck clean.

A FLAKE FOUND, REMOVED, AND DELIBERATELY NOT FILED AS EXPLAINED (59b6097). After the rebase a three-spec run came back 51 passed, 1 flaky: fit-cap read a pane at 218 where the window's own size says 368 — a layout measured against a window still at its launch size, setContentSize(1900,1100) not yet landed. Kenya GUESSED contention from its own dev app, which docs/e2e-flakes.md documents as a known cause, then TESTED the guess rather than filing it: three runs with the dev app stopped, three with it running, all six passed. The documented cause is NOT this one, and an entry in the flakes doc saying otherwise would have been worse than no entry. Repeating the same three-spec shape gave 52 passed, no flake — one occurrence in two runs of that shape, none in six isolated. So 59b6097 polls the window's content size in beforeAll before anything reads a pane: it REMOVES the race and does not DIAGNOSE the failure, and the commit message says that in those words rather than claiming a fix.

STILL NOT VERIFIED, and it is the same shape as the resizing value on the C5 card: nobody has watched the skip fire on a real 2x desk. --force-device-scale-factor=2 is the same arithmetic, not the same machine. One run on the built-in display alone settles it — and that same run says whether onion-skin's 50% test belongs in the skip.

THE CARD'S PREMISE WAS WRONG AND THE CORRECTION MATTERS MORE THAN THE FIX. The three are PASSING on this machine. Kenya ran them before touching anything: fit-cap.spec.ts + onion-skin.spec.ts, 7 passed, 17.0 s, no skips. system_profiler says the main display is a 3440x1440 ultrawide at 1x — the external monitor is plugged back in. Henry verified independently: `UI Looks like: 3440 x 1440`, Main Display: Yes.

So `every local full run currently reports three failures` was true on 2026-09-12 and is NOT true today. The trio tracks WHAT IS PLUGGED IN, not which machine. Henry had been telling Opeyemi `they fail on this laptop and pass on CI`, which is the wrong axis and makes a green local run look like evidence the problem is gone. It is not.

THE FIX: both specs probe the desk once in beforeAll; the three assertions that read a scaled capture skip with the scale named in the reason. tests/e2e/helpers/captureScale.ts, modelled on helpers/deskState.ts. Never skips on CI.

The probe MEASURES rather than infers — capture the real window, divide by the size that window reports. Deliberately not a host list and not a `scaleFactor > 1` guess about displays, because what breaks the assertions is the CAPTURE, and that is directly observable.

VERIFIED BOTH DIRECTIONS, since a skip that never fires and a skip that always fires are identical in a green run:
- --force-device-scale-factor=2 → probe reports 2 → skip = true
- plain launch → probe reports 1 → skip = false
- fit-cap + onion-skin on this desk: 7 passed, no skips, 16.4 s
- typecheck clean

TWO THINGS LEFT UNDONE ON PURPOSE, both written into docs/e2e-flakes.md rather than a commit message: 1. onion-skin.spec.ts's 50% test also reads a captured pixel and was NOT skipped — it was not among the three observed red on 2026-09-12, and it should join them on an observation rather than on the symmetry. 2. A SKIP IS NOT A FIX. On a 2x desk those assertions still cannot run, so what they cover is unproven there. Making them desk-independent means comparing captures to each other or reading the frame bus.

### A suite that measured nothing must be as loud as two suites at once

[`chore-guard`](../board/chore-guard.md) · chore · owner: Rook

MERGED 2026-09-15 on Opeyemi's word, as 2f33e43 on main. Verified before pushing: typecheck clean across all three configs, 1141/1141 unit — reconciling Rook's 1121 + 20 new tests exactly — and board:check green.

**AND THE GUARD WAS WATCHED FIRING ON MAIN**, not merely covered by tests that pass. Two unit suites started two seconds apart:

obsrv: the unit suite is already running (pid 26730, started 2s ago).     Two suites in one worktree make both results untrustworthy — test:e2e rewrites out/ while the CLI specs read it.

The first run completed normally, 6.22 s. Live holder named, age real, the refusal saying which of the two conditions it found. That is what obsrv-91 asked for at the design stage and it holds outside the worktree it was built in.

**THE DEFECT IT CAUGHT IN ITSELF is the thing to carry forward.** The first version of the stale message said *"It died 0s ago"* about a suite killed ten seconds earlier — the caller had no age to hand and passed a literal zero. A sentence keying off nothing, inside the fix for sentences that key off nothing, in the one message whose whole job is to be believed. It would have passed review, because a zero is a plausible number. Only running it against a real corpse made it wrong.

The three caveats are in the merge commit as well as here, deliberately: a card can be edited by anyone and a commit travels with the change. `mcp.spec.ts` and `rendering.spec.ts` accumulate the same module-level state and are NOT checked. `noEvidenceMessage` existing is not the same as its being used. A residual takeover race remains — two processes seeing one dead holder, the loser refused on the re-read rather than serialised.

Note for anyone in `live-drive.spec.ts`: this rewrote its `info` access through `established()`, while Kenya was working in that file on the resizing card.

FREE AS OF 2026-09-14 evening. obsrv-91 raised it with its user twice and got silence rather than a refusal, then released it rather than hold a card against a maybe while someone else was free and wanting it: "mine only in the sense that nobody else has it, which is not a claim on a card." If its user later says take it, it will ask what is left rather than start a second copy, and Henry hears before it touches anything.

**THE PART obsrv-91 SAYS IT WOULD HAVE GOT WRONG FIRST, and it is the difference between a guard and a green light.** The STALE-LOCK branch needs an OBSERVATION, not a design.

A guard that has only ever been seen to refuse a *live* suite has been shown capable of refusing. That is not the same as being right about WHICH of the two it found. Both branches produce a refusal; only one of them is correct in a given moment, and a refusal you cannot tell apart is what gets the lock deleted by the first person it blocks — after which nobody trusts it again.

So: kill a suite mid-run, leave the lock behind, and watch the refusal NAME IT AS STALE. Until that has been seen, the two branches are indistinguishable in the only way that matters.

obsrv-91 flags this as the same shape that caught it and obsrv-a6 yesterday — both had verified their gates by making them fail on purpose, and both experiments were sound and blind, because what was wrong was not the assertion but what it was fed. A check shown capable of failing is still only a claim about the check.

SCOPE WIDENED 2026-09-14 on obsrv-91's argument, which is right: this card and the evidence-assertion are two halves of one thing, and building them apart gets one of them wrong.

HALF ONE — refuse to start a suite while another is running. Two concurrent suites in one worktree made both greens untrustworthy and cost a full afternoon.

THE HARD PART, and the reason a naive lock file is worse than nothing: the guard must distinguish ANOTHER SUITE RUNNING from A STALE LOCK LEFT BY A SUITE THAT DIED. Those are identical from a lock file alone. A guard that refuses on a stale lock gets its lock deleted by the first person who hits it, and then nobody trusts it again. Whatever it checks — a pid, a port, a live process — the refusal text must SAY WHICH OF THE TWO IT FOUND.

HALF TWO — a suite that passed having measured nothing is indistinguishable from one that passed having checked everything. obsrv-a6 hit this with a -g filtered run; Henry hit the same shape verifying the surface-parity staleness check, which passed green on a planted stale row because filtering had starved the rows it compares. The fix there was a vacuity guard (surface-parity.spec.ts:368) that fails when the comparison had no evidence. Generalise it.

Kenya's find is the third instance in one day and belongs in the same fix: live-drive.spec sets `info` (control port and token) in the FIRST test of the file, so any -g filtered single-test run of it dies on `Cannot read properties of undefined (reading 'token')` — which reads like a bug in whatever test you just wrote.

So: a concurrent suite, a stale lock, and a run that asserted nothing are three ways to get a green that means nothing, and the guard should name which one it is looking at in all three cases.

INTO REVIEW 2026-09-14, branch `chore/suite-guard` off 4b46a49. Write-up with every message copied from a real run: docs/research/2026-09-14-suite-guard.md. 1141/1141 unit, typecheck clean across all three configs.

THE STALE-LOCK OBSERVATION, which obsrv-91 said was the difference between a guard and a green light, was made rather than designed. A real `npm test` started, SIGKILLed mid-run so no exit path could run, the lock left behind, and the next suite's first words recorded verbatim: "taking over a stale lock from the unit suite — pid 25891, which is no longer running. It died 16s ago without releasing." A dead holder is taken over, not refused — refusing on a corpse is what gets the lock deleted by hand.

AND THE FIRST VERSION OF THAT MESSAGE WAS WRONG, which only running it could show. It said "It died 0s ago" about a suite killed ten seconds earlier: the caller had no age to hand and passed a literal 0. A sentence keying off nothing, in the one message whose job is to be believed. The age now travels out of the lock file with the takeover, and a 42-second dead holder is asserted in tests/unit/suiteLock.test.ts so it cannot quietly become a constant again.

HALF ONE: scripts/suiteLock.js + scripts/suite.js, one lock per worktree over all three suites — the interference is BETWEEN them, since test:e2e rewrites out/ while the CLI specs read it. Atomic mkdir, holder file, process.kill(pid,0), the pattern bin/electronPath.js already uses for the install lock. Live holders are refused with pid and age; the refusal says in words that it is a live holder and not a leftover file.

HALF TWO: src/shared/established.ts. Kenya's live-drive.spec case before and after, same -g command — before `TypeError: Cannot read properties of undefined (reading 'port')`, after `info (the control port and token) was never established: this file's first test did not run in this suite`. The first names the app, the second names the run. surface-parity.spec.ts's vacuity assertion — the only one anyone had written — now takes its wording from noEvidenceMessage so the next one is not discovered the same way; observed still firing under -g.

WHAT IT DOES NOT DO, stated because an unaudited file looks identical to an audited one: mcp.spec.ts and rendering.spec.ts also accumulate module-level state and have NOT been checked against this. noEvidenceMessage existing is not the same as its being used. Also a residual takeover race (two processes seeing the same dead holder; the loser is refused on the re-read rather than serialised) — electronPath.js's takeover mutex is the heavier pattern if it ever shows up. It has not.

### Calibrate thin text: sweep 12 / 14 / 16 device px against real pages

[`b3-thinpx`](../board/b3-thinpx.md) · **B3** · chore · owner: obsrv-a6

Swept 9 sites x 2 presets x 5 thresholds (90 runs). At 14 the rule fires on 1 of 9 sites; findings cluster at 8-11px weight 300 with nothing between 12 and 14, so 12-15 are the same answer. 2x is zero everywhere by arithmetic. The prediction that this would be B4's largest noise source was wrong and docs/thresholds.md now says so. linear.app crosses between 14 and 16 — the plateau is stripe's, not the web's. Merged d32952f.

### Two peer sessions cannot read the board at all

[`bug-board-access`](../board/bug-board-access.md) · bug · owner: Henry

CLOSED 2026-09-14 — dissolved by moving the board into the repo, not fixed. Nothing was granted to anyone.

The diagnosis below stands and is worth keeping, because the wrong half of it is instructive: this was recorded as a sharing permission for hours, and the measurement that settled it showed three accounts rather than one account with a gap — so there was no addressee to share with and the permission fix never existed.

`board/` is writable by everyone who can open a pull request, which is all four of us. Claiming a card is editing its file. The read half had already been solved by the generated file being public.

Raised 2026-09-14. Rook (room #21) and Kenya (#23, and direct) both get the same refusal reading the artifact's `tasks` collection:

no such artifact, collection, or document (or no access — the two are deliberately indistinguishable)

Three times each, independently. Two sessions blocked identically is one permission, not two coincidences.

NARROWED 2026-09-14 after the push of 403717b. This was recorded as ONE problem and is TWO, and the read half already had an answer sitting in the repo: `git pull && cat docs/board.md` works for every session, because the generated board is a public file and the artifact is not the only copy. Henry spent hours treating the artifact as the only board while the workaround was the very file he had built for exactly this. So the live cost is WRITES ONLY.

That also changes what the fix has to be. If reads are served by the repo and writes are not, then the question is not `how do we share the artifact` but `what is the write path for a session that cannot reach it` — and one answer is that there may not need to be one, if claiming a card can happen through the same public file by pull request. That is a different design from sharing an org-internal artifact more widely, and it should be chosen rather than defaulted into.

WHAT IT COSTS RIGHT NOW: neither can claim a card, set an owner, or move anything to Review. Every board move today has gone through Henry by hand, which means the board is accurate only while one session is awake to update it, and a card sits `unclaimed` while someone is actively working it. That is exactly the quiet staleness docs/board.md was built to guard against, arriving through the door nobody watched.

Both refused to hand-edit docs/board.md instead, which was right — scripts/build-board.js says in its own header that the snapshot exists to be regenerated rather than edited back into agreement, and a generated file saying `Kenya, Doing` while the artifact says `unclaimed` is the defect the file exists to prevent.

The message is deliberately ambiguous between `does not exist` and `you cannot see it`, so the refusal itself cannot tell us which. Needs Opeyemi: check who the artifact is shared with. If org-internal sharing cannot reach these sessions at all, then the artifact is not usable as a multi-session board and docs/board.md is not a snapshot of the real board but the only board — which is a different design and should be decided rather than drifted into.

### `blocked` and `panel` dropped by the scroll-report whitelist — fixed

[`bug-blocked-not-forwarded`](../board/bug-blocked-not-forwarded.md) · **C4** · bug · owner: obsrv-e7

SUPERSEDED BY THE C4 CARD — kept for the history, not for tracking. This card was opened when the finding looked like one bug; it grew into the five-then-seven-commit stack that the 'Field-level sweep' card now carries, and it went stale describing pre-merge state.

The fix itself: obsrv-e7 found and fixed it. Root cause was parseScrollReport in shared/ipcPayloads.ts — a whitelist, so a field added to the type, the preload and the control reply still arrived undefined until named there. It dropped `panel` too, which left the live surface silent on a locked page with no dialog role. Reviewed by obsrv-a6 (commit 02656b8) and the panel half independently reproduced on a separate fixture.

Merged in cdd7056 and pushed 2026-09-14. Live status and open questions are on the C4 card.

### FIXED: the coverage note measures whether the page grew instead of guessing

[`bug-hidden-two-meanings`](../board/bug-hidden-two-meanings.md) · **C4** · bug · owner: Henry

Merged 219223e, pushed 2026-09-14. Suite: 516 passed, 3 failed (the documented Retina trio, which fail on this laptop and pass on CI), 0 flaky. Unit 1251.

THE ORIGINAL CARD'S FIX WAS WRONG and was abandoned before building. It said: headless hedges, live is right, make headless match live. Henry built the missing counter-example first — a STATIC page behind an open dialog — and live announced 'the page grew as it was walked' directly beneath its own note saying 'the page never moved'. So:

app-shell-grows    headless said held; the feed had grown   dialog-over-tall   live said grew; the page was static

Each surface was right on the page its author had tested and wrong on the other. Matching one to the other would have replaced a hedge with a false statement.

THE REAL DEFECT was one level down: `held` inferred from `documentLocked`, a question nothing measured. THE FIX: the walk records the page's height at its first step; the note compares it with the height measured afterwards. Grew, or did not. The disjunction is gone from both surfaces rather than re-pointed.

A wrong turn worth keeping: the first version compared the walk's FIRST step against its LAST, which reads 'did not grow' on grows-as-walked.html — a fixture named for growing — because it extends after the walk's last step. Caught because a fixture whose name predicts its answer gave the opposite one.

When nobody measured (older app, no step taken) the sentence keeps its old hedge, with a unit test pinning that branch. A disjunction is the honest shape of an answer nobody took; the fault was stating a guess as fact.

Rode the same chain the blocked/panel fix mapped out: scrollHost, preload, ScrollReport, controlServer, and the ipcPayloads whitelist that silently drops unnamed fields — which has now caught three sessions in one day.

tests/fixtures/dialog-over-tall.html is committed beside app-shell-grows.html. Either alone argues convincingly for the wrong fix; only the pair makes it measurable.

### B5: the same page measured twice answers the same

[`done-b5`](../board/done-b5.md) · **B5** · readiness · owner: obsrv-a6

docs/research/2026-09-14-b5-repeatability.md — 0 of 3,375 fields on fixtures, 0 of 49 on berkshirehathaway.com, 0 of 22 across releases against a control finding 7.

### Deleting Obsrv.app leaves your browsing history behind, undocumented

[`bug-history-survives-uninstall`](../board/bug-history-survives-uninstall.md) · bug · *unclaimed*

SHIPPED 2026-09-14 on Opeyemi's word — the cheap half, which is the half that closes the privacy gap. README's *Privacy and files* section now carries a **"Removing Obsrv does not remove any of that"** paragraph: deleting Obsrv.app removes the app and nothing else, `npm rm -g getobsrv` removes the CLI and nothing else, there is no uninstall command yet, and here are the three paths to remove by hand.

It names `history.json` explicitly as the line that matters for privacy, which is the whole point of the card. Every path was verified to resolve before being written into a README that tells people to `rm -rf` it:

~/Library/Application Support/Obsrv    1.3 GB, 38 entries   settings, history, tabs, Chromium profile     ~/Library/Logs/Obsrv                    60 KB,  1 entry     obsrv.log     ~/Library/Caches/electron              477 MB,  3 entries   the Electron runtimes

The 477 MB corrects the card's own 128 MB, and the difference is instructive rather than an error: Rook measured a disposable home holding ONE Electron version; this machine has three, because the cache is keyed by version and nothing prunes it. The README says "one copy per version Obsrv has used" rather than quoting either number as the size.

Also warned in the paragraph: quit Obsrv first, and check no other Electron app relies on that cache — it is not Obsrv's directory, it is Electron's.

THE EXPENSIVE HALF IS STILL OPEN as `chore-uninstall-path`. This card is closed because the privacy statement is now true, not because removal is solved. Splitting them is what let this ship tonight.

Measured by Rook 2026-09-14 on a real packaged build — unsigned arm64 DMG built from this tree, mounted, copied into a disposable home's Applications, launched under `CFFIXED_USER_HOME`, one page loaded by typing its URL, quit cleanly, then the bundle deleted, which is what dragging to the Trash does.

after one page load     87 entries, 6 MB     after deleting the app  86 entries, 6 MB

**One entry went, and it was the app.** What stays: `settings.json`, `tabs.json`, `obsrv.log`, the whole Chromium profile — Cookies, Local Storage, Session Storage, Trust Tokens, TransportSecurity, the caches — and `history.json`.

**Lead with the history, not the megabytes.** `history.json` is, in the README's own words, "the addresses you have visited in the app". A user who deletes an app they used to look at private pages has every reason to think those addresses went with it. They did not, there is no uninstall command, and no document says where to look.

The README's silence is the pointed part rather than an oversight of omission. Its *Privacy and files* section goes out of its way to say what IS cleaned up — headless CLI runs "use a throwaway Electron profile under `os.tmpdir()` and remove it on exit", and the MCP server "prunes its own, older than a day, at startup". Against that care, saying nothing about the app's own state reads as though there were nothing to say.

**Two things this card wants, and they are separable** — see `chore-uninstall-path` for the second:

1. The README says what survives deleting the app, and where it is. Cheap, and it closes the privacy gap on its own. 2. A supported way to remove it.

RELATED README ACCURACY, found in the same run and recorded here so it is not lost: a **locally built DMG carries no quarantine attribute**, so nobody testing a local build reproduces the "damaged" dialog the install instructions describe, and may conclude the instructions are wrong. Not a false statement — the instructions are right about downloaded DMGs — just silent about which builds they apply to.

Isolation for this measurement was read from INSIDE the running app (`app.getPath` for home, userData, logs, appData, cache, temp) rather than inferred from the filesystem afterwards, for the reason this project keeps relearning: a directory nothing consulted and a directory that came out empty look identical. `CFFIXED_USER_HOME` held on the real packaged app; temp never moved. Opeyemi's own profile was counted before and after at 22,251 entries, unchanged.

### D1: a limitations page

[`done-d1`](../board/done-d1.md) · **D1** · readiness · owner: obsrv-a6

docs/limitations.md, linked from the README above the Quickstart.

### Prune the temp directories captures leave behind

[`done-prune`](../board/done-prune.md) · **A4** · bug · owner: obsrv-a6

src/shared/pruneTemp.ts — 10,045 entries / 400 MB had accumulated.

### audit and lint say when the page moved under them

[`done-motion`](../board/done-motion.md) · **B2** · bug · owner: obsrv-a6

src/shared/pageMotion.ts — stripe.com moved finding boxes 438 CSS px between runs in silence.

### The Pages job's actions are a major behind and running on borrowed time

[`chore-pages-actions-node20`](../board/chore-pages-actions-node20.md) · chore · *unclaimed*

DONE 2026-09-14, same evening, on Opeyemi's word. Bumped in e921b64:

configure-pages        v5 -> v6    release notes say "upgrade to node 24"     upload-pages-artifact  v3 -> v5    moves to upload-artifact v7, the transitively-flagged one     deploy-pages           v4 -> v5

Release notes read before bumping rather than trusting version numbers: none of the three changes an input this workflow passes.

**CLOSED ON THE EVIDENCE THE CARD ASKED FOR, not on a green run.** The card said done means the annotation is GONE FROM A RUN, because a green deploy fits both "the deprecation is cleared" and "forcing still works and it was green before too". So the annotations were queried directly, and — this is the part that makes it evidence — the same query was run against the PREVIOUS run first, to prove it can find one:

run 34887702706 (v5/v4/v3)   1 annotation: "Node.js 20 is deprecated... forced to run on Node.js 24"     run 34887893056 (v6/v5/v5)   0 annotations

A zero from a query nobody has watched return non-zero is not evidence of absence. The control is what turns it into one. `gh run view | grep -i ANNOTATION` had already returned nothing on BOTH runs, which would have been a false negative had it been trusted.

ONE THING FOUND WHILE VERIFYING, and worth keeping rather than filing: **GitHub Pages caches.** Immediately after the deploy the live page still read `main @ c40a297`, 51 cards; with a cache-buster it read `main @ e921b64`, 52 cards. Nothing was wrong with the deploy.

That is the stamp earning its place. A cached copy shows an OLDER COMMIT IN ITS OWN STAMP, so a reader can see it is behind instead of trusting a page that looks current. Had the page carried no provenance, a cached view would be indistinguishable from a fresh one — which is the entire failure this board was restructured to remove, arriving one layer further out in the CDN.

Raised 2026-09-14, from an annotation on the very first Pages deploy (`Board on Pages`, run 34887222584 — green, with this warning):

Node.js 20 is deprecated. The following actions target Node.js 20 but are     being forced to run on Node.js 24: actions/configure-pages@v5,     actions/deploy-pages@v4, actions/upload-artifact@v4.     https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/

**It works today and that is exactly the problem worth naming.** The runner is already *forcing* these onto Node 24 rather than refusing them, so the deploy is green on a compatibility shim rather than on support. The changelog is dated September 2025 — a year old. Forcing is the step before removal, and when it is removed the failure lands on the job that publishes the public board.

`actions/upload-artifact@v4` is not named directly in `pages.yml`; it comes in transitively through `actions/upload-pages-artifact@v3`.

**Every one has a newer major, measured rather than assumed** (`gh api repos/<r>/releases/latest`, 2026-09-14):

used in pages.yml                    latest     actions/configure-pages@v5      ->   v6.0.0   (2026-03-25)     actions/deploy-pages@v4         ->   v5.0.1   (2026-09-01)     actions/upload-pages-artifact@v3 ->  v5.0.0   (2026-04-10)     actions/upload-artifact (transitive) v7.0.1   (2026-04-10)

So the change itself is three lines in `.github/workflows/pages.yml`.

**What is NOT established, and must not be assumed by whoever takes this:** that the newer majors run on Node 24. A version number is not evidence; the annotation is. The card is done when a deploy runs on the bumped versions and the Node 20 annotation is *gone from that run* — not when the numbers look newer. This project has spent a day on checks whose pass fitted two facts, and "I bumped it and CI was green" fits both "the deprecation is cleared" and "it was green before too, because forcing still works".

Note that the rest of the repo is current — `ci.yml` uses `actions/checkout@v7` and `actions/setup-node@v7`, and neither was flagged. Only the Pages job is behind, because it was written today against the versions in GitHub's own quickstart.

Low urgency, non-zero cost of ignoring: the thing that breaks is the public board's deploy, and it will break on a runner image change nobody here controls or is warned about beyond this annotation.

### The toolbar's navigate answers within a budget

[`done-navigate`](../board/done-navigate.md) · bug · owner: obsrv-a6

Commit 630ebe6. IPC.navigate returned the unbounded navigateBoth; the address field never synced on a page that never finishes loading.

### A mirrored commit is marked, not withheld

[`done-mirror`](../board/done-mirror.md) · bug · owner: obsrv-a6

Commit 7d811f8. Withholding url-changed made sync.spec depend on a race; clean main failed 1 run in 6, now 0 in 6.

### A conflicting PR runs no CI at all — and board PRs conflict by design

[`bug-pr-checks-absent`](../board/bug-pr-checks-absent.md) · bug · owner: Henry

MERGED 2026-09-15 on Opeyemi's word, as 450d5f9 on main.

**CLOSING NOTE CORRECTED, on Kenya's push-back, and the correction matters more than the closure.** This originally read "confirmed after the merge too". **What was confirmed is the BOARD CHECK.** The full suite was not, and the suite is the job whose absence costs a reviewer something.

Four minutes after this card closed, PR #2 hit the same mechanism: `gh pr checks 2` showed the board check and nothing else, one run for the head sha, `CONFLICTING` because main had moved to 154c8e3. The e2e job — the entire point of that PR, it being the first machine that would exercise the branch — was never scheduled.

**So the fix is real and narrow.** Measured across every workflow:

board.yml      push: ALL branches                 fixed — cannot expire     ci.yml         push: main only + pull_request     STILL EXPIRES     b5-sweep.yml   no push trigger + pull_request     STILL EXPIRES     pages.yml      push: main only                    no PR dependency

The general case — any workflow gated on `pull_request` inherits the expiry — is `bug-suite-absent-on-conflict`. This card fixed one instance of it and its title promises the class.

**And the cost is being paid by someone else:** Kenya has now rebased three times on this branch and twice on the last, *"all of them to buy a CI run rather than to resolve anything real."*

FIXED 2026-09-15 on Opeyemi's word — he chose the concurrency route. **Both halves, because the first alone fixes nothing observable.**

**Half one, concurrency.** Groups added to `ci.yml` and `b5-sweep.yml`; `pages.yml` already had one. Keyed on workflow and ref, and the non-obvious part is what does NOT get cancelled:

cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}

Cancelling a superseded run on a branch saves a runner and loses nothing. Cancelling one on **main** would destroy a per-commit CI outcome — and this project counts those; `bug-ci-main-red-37pct` is a tally of which commits went red. A guard that improves throughput by deleting the evidence is the wrong trade here, and the default idiom (`cancel-in-progress: true`) would have made it silently.

This is preparatory. On its own it changes nothing a reviewer would see: no double-run currently exists, Kenya's having come from a temporary `push` trigger since removed. It is what stops half two creating the duplicate artefacts Kenya produced by hand.

**Half two, and this is what closes the bug: `board.yml`, `board:check` on push to EVERY branch.** Lifted out of `ci.yml` rather than added beside it, so it runs once rather than twice.

A branch push always happens and has no merge ref to compute, so the check cannot expire the way a PR's silently did. `ci.yml` keeps its `pull_request` trigger for everything else; the board check no longer depends on a PR being mergeable.

Ubuntu, no `npm ci` — the generator is plain Node with no dependencies, so it answers in seconds on a branch whether or not the macOS suite is worth running there.

**KNOWN GAP, written into the workflow rather than left to be discovered:** a pull request from a FORK pushes to the fork, not here, so `board.yml` does not run for one. This repo has had no fork PRs. When it does, `ci.yml`'s `pull_request` trigger covers them — and only when they are mergeable, which is the original bug, narrowed to a case that has never occurred.

**OBSERVED, in both directions, on a non-main branch** — which `ci.yml` could never have done, its push trigger being `branches: [main]`:

04:30  fix/board-check-on-push   success    the branch as it stood     04:30  fix/board-check-on-push   FAILURE    a deliberately stale docs/board.md     04:31  fix/board-check-on-push   success    after reverting it

The refusal named the line rather than only failing:

board: docs/board.md does NOT match board/. Run `npm run board` and commit the result.       first difference at line 1327:         committed: "<!-- deliberately stale: proving board.yml refuses -->"         board/:    "<end of file>"

A guard nobody has watched refuse is a claim, and this card is about exactly that — so the staleness was planted deliberately and reverted, rather than the green being taken as proof.

**The conflicting-PR half is evidenced rather than assumed, and the evidence is Kenya's from earlier the same night:** when it added a temporary `push` trigger to its branch while PR #1 was CONFLICTING, *"the sweep started within seconds"*. So push events fire on a branch whose PR cannot compute a merge ref. That is the property `board.yml` relies on, observed before it was relied on rather than argued from the trigger line — which is the mistake that created this card.

`pages.yml`'s stale reference to `ci.yml`'s board:check was corrected in passing.

**THE SENTENCE THAT NAMES THE BUG, Kenya's, and it replaces the framing below.** Not *"a conflicting PR runs nothing"* — that describes a mechanism. What a reviewer experiences is:

> **The PR's CI state silently expires, without anyone touching the PR, and no event says the checks went away.**

A green check from ten minutes ago and no check at all look identical in `gh pr checks` output to anyone not reading an absence. Nothing fires, nothing is marked, and the PR page does not say it used to know something. That is this project's oldest defect — a silence that fits two facts — arriving in the review surface.

Kenya watched it happen three times on PR #1 without touching the branch.

**WHAT CAUSES IT, narrowed — and the narrow version is the useful one.** Kenya first reported that main moving to `43409d6` (a readiness-only commit) had conflicted its branch, and concluded that any commit at all is enough. Checked, and it is not:

43409d6   docs/readiness.md only          NOT in the PR — cannot conflict it     178d36c   docs/board.md, docs/board.html  both in the PR — this is what did it

`43409d6` was merely where main's HEAD sat when Kenya looked, which is a different thing from what moved underneath it. Kenya re-checked and agreed, noting it had been wrong *in the direction that made the bug look worse than it is*.

**So only commits touching the generated board files conflict a board-touching branch, and pausing card edits is a REAL mitigation rather than a futile one.** Henry's pause worked; it simply arrived one commit late, `178d36c` having already been pushed when he decided to stop. That matters because the wider version implies nothing helps, and would have argued for abandoning the generated files — which is the wrong turn named at the bottom of this card.

Found by Kenya 2026-09-14 on PR #1, the first pull request this repository has ever had. Cause identified by Henry; **the positive half is not yet observed** — see the test below.

**THE OBSERVATION**, Kenya's, checked rather than inferred:

gh api '...actions/runs?event=pull_request' --jq .total_count   ->  0     gh api '...actions/runs?event=push'         --jq .total_count   ->  267     gh pr checks 1                                                  ->  no checks reported

267 runs in this repo's history, every one a push. Actions are enabled, `allowed_actions: all`, and nothing in the repo settings restricts pull requests.

**THE CAUSE, evidenced:** PR #1 is `mergeable: CONFLICTING`, `mergeStateStatus: DIRTY`, and

gh api repos/vibesyemmy/obsrv/git/ref/pull/1/merge   ->  404 Not Found

`pull_request` workflows run against `refs/pull/N/merge`. GitHub cannot compute that merge commit while the PR conflicts, so there is no ref to run against and no run is scheduled. Not a settings problem; not "PRs are broken here".

**WHY THIS LANDS ON THE BOARD, and it is the part that makes it urgent rather than trivia.** The write path shipped this evening is *edit a card, regenerate, open a pull request*. `docs/board.md` and `docs/board.html` are generated from every card, so **any two branches that touch any card conflict on them once main moves** — that is not an edge case, it is the normal state of a second concurrent contributor. Kenya hit it on c3 within hours.

So `board:check` — the guard whose entire purpose is to stop a hand-resolved board reaching main — **does not run on precisely the pull requests where hand-resolution is possible.** It runs on the clean ones, which did not need it.

**HENRY'S ERROR, recorded because it is the reason nobody looked.** Asked earlier the same evening whether board:check covered PRs, Henry answered: *"ci.yml has a bare `pull_request:` with no branch filter, and board:check is a step in the `test` job, so it runs on every PR. The branch is covered, which is where the conflict happens."* That was read off a trigger line and had never been observed, because no PR had ever existed to observe it on. A check nobody has watched succeed — the same shape as the log that could not be attributed and the grep that returned zero, on the same day, stated as reassurance.

**POSITIVE HALF NOW OBSERVED — the diagnosis is confirmed, not inferred.** Kenya rebased PR #1 onto 69de54b, resolved by regenerating (board:check green, 54 cards), force-pushed. Verified independently by Henry after:

before rebase   mergeable CONFLICTING   refs/pull/1/merge  404        pull_request runs  0     after rebase    mergeable MERGEABLE     refs/pull/1/merge  af50d6c    pull_request runs  2                     gh pr checks 1 -> typecheck · unit · shader parity · e2e   pending

So `pull_request` is not broken here and never was. A conflicting PR has no merge ref to run against, and every PR this repository had ever had was conflicting — there being one.

Worth sitting with: the first pull request in the repo's history had to be made mergeable before anyone could observe whether a mechanism the project had been relying on for months existed at all. It did. Nobody knew.

**POSSIBLE FIXES — and the ranking changed once Kenya produced the collision by hand.**

Kenya's interaction finding, which kills the option that looked cheapest: its commit scheduled the sweep TWICE, once from a temporary `push` trigger and once from the `pull_request` paths filter. Two runs of one workflow on one tree. A small waste now, and a confusing artefact later — two `b5-sweep-ci.json` files from a single commit, differing only by desk-identical noise, is exactly the thing someone reads as a repeatability result.

**So "run board:check on push for all branches" is worse than it looked.** It makes that double permanent for every workflow that also runs on pull requests, and this repo's CI runs on both. The cheap fix buys a guard and pays in duplicate runs and duplicate artefacts.

In order, as they stand now:

- **Add a `concurrency:` group keyed on workflow and ref**, then reconsider the push trigger. Deduplication first, coverage second — otherwise the coverage fix creates the artefact problem. This is the standard idiom and it is one block.
- **Accept the gap and rely on the main-push run as the backstop it already is.** Leaves a window where a hand-resolved board sits on main until the next push run, which is usually seconds.
- **Require checks by branch protection**, so a PR with none cannot merge. Needs a rule and a human to hold the line, and it turns this from a silent gap into a visible block.

What NOT to do, because it is the tempting one: nothing here needs the board's generated files to stop being committed. They are what makes staleness impossible, and the conflicts are the price of that, not a defect in it.

Related: `chore-guard` is the card about a green that means nothing. This is an ABSENT green that means nothing, which is the same family and arguably worse — nothing even claims to have checked.

---

*Regenerate with `npm run board`. Counts above: 10 readiness, 11 bugs, 7 chores, among the open cards.*
