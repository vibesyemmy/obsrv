# The Obsrv board

*Generated 2026-09-14 from the team board. 45 cards, 28 open, 19 of those unclaimed.*

This is a snapshot of a live board that lives in a Claude Artifact with a
shared database. That board is organization-internal and cannot be made
public, so this file is how the work reaches everyone else. **The artifact is
authoritative; this file is a copy** — if the two disagree, the artifact is
right and this needs regenerating with `npm run board`.

## If you want to pick something up

Cards in **Next** are the ones worth starting. Each carries the criterion it
closes, an owner when it has one, and the file, commit or document that
defines *done* — enough to begin without having been in the conversation that
produced it.

**Open a pull request against the card.** Say which card id you are taking in
the description. An unowned card in Next or Backlog is free; a card with an
owner is being worked on by that session or person, and a card in Review is
finished and waiting on the maintainer rather than on help.

Two things worth knowing before you start, both of which this project has
learned the hard way and written down:

- [`docs/readiness.md`](readiness.md) is the definition of done for anything
  labelled with a criterion (`A1`…`E2`). The board tracks work; readiness
  states what would make the work finished.
- [`docs/limitations.md`](limitations.md) lists the things that look like bugs
  and are not. Worth two minutes before filing one.

The live board, for anyone in the organization: https://claude.ai/code/artifact/05cfdc1c-4854-40e8-b46e-bdf5e58d6c36

---

## Next — 8

*Picked, not claimed — start here.*

### Run the suite on a host unlike this laptop, more than once a release

`ci-second-host` · **B5** · chore · *unclaimed*

obsrv-e7's proposal, 2026-09-14, and the evidence points both ways at once:
- the Retina trio (fit-cap:43, onion-skin:96, onion-skin:116) FAILS on this laptop and PASSES on CI — documented since 2026-09-12
- the `moves` pageHeight comparison PASSED on this laptop on every run and FAILED on CI

One host cannot tell you which of those you are looking at. Today the slow machine found a real bug before a human did, and the only reason it was a discussion rather than a shipped defect is that CI ran before the next merge.

B5 established the tool does not drift run to run ON THIS MACHINE, with a control that made the zero mean something. This is the same question across hosts, and nobody has asked it: the fixture sweep run somewhere unlike this laptop, compared against the numbers already published in docs/research/2026-09-14-b5-repeatability.md. If they differ, B5's number is about this machine rather than about the tool.

Cheapest version is probably a CI workflow that runs the fixture half of the B5 sweep on a schedule rather than a full second suite.

### Sign and notarise the app

`a1` · **A1** · readiness · owner: Rook (cert step is Opeyemi's)

Blocked on Apple issuing a Developer ID Application certificate. The cert in ~/Documents/obsrv-signing is Apple Distribution (Voicify Limited) — wrong type. Wiring waits on chore/signing.

### QUEUE — Rook: e2 DONE · a1 blocked on Opeyemi · bug-orientation-name next

`queue-rook` · chore · owner: Rook

Updated 2026-09-14 evening, after the queue went stale within hours of being written — which is the failure mode this card is an instance of, not an exception to.

1. e2 — DELIVERED into Review, 717e924. See the e2 card. 2. a1 — BLOCKED, and not on the certificate any more. Rook has a design with Opeyemi and waits on his yes. Two things need his decision, not Rook's: the design itself, and the IDENTITY — the app would be signed as Voicify Limited, which is what Gatekeeper shows users, while `copyright` says Opeyemi Ajagbe and CI would hold Voicify's private key. The remaining mechanical step needs Opeyemi to type a p12 password, so it cannot be finished by any session alone.    Already settled by measurement, so nobody re-opens it: the identity PAIRS. Public-key SHA-256 of the cert's -pubkey against each .key — obsrv-developer-id.key matches the Developer ID leaf at 53c1b7ae; the 21:34 pair is a different keypair at 1cd2c04d. And the G2 CA is a PUBLIC intermediate, not account-gated — Henry relayed the opposite to Opeyemi and has corrected it. 3. bug-orientation-name — unstarted, and the next one to pick up when a1 is unblocked or if Rook wants work in the gap.

### QUEUE — Kenya: c5-elevated DONE · bug-retina DONE · c3 remains

`queue-kenya` · chore · owner: Kenya

Updated 2026-09-14 evening. Two of three delivered, and the order changed — Opeyemi picked bug-retina directly rather than c3, so the queue Henry wrote was overtaken by the user's own routing. That is the correct precedence and the card records it rather than hiding it: Henry's word routes work, Opeyemi's authorises it.

1. c5-elevated — DELIVERED into Review, 6b7acb4. Inverted the card's own fallback: `resizing` fires, keep the value. 2. bug-retina — DELIVERED into Review, cf52dc8, and it corrected the card's premise. See that card. 3. c3 — does skills/obsrv-screens/SKILL.md describe the tools that exist. NOT started; Kenya is putting it to Opeyemi before picking it up.

Henry asked Kenya to SPLIT docs/c5-note-inventory into two branches so bug-retina can merge first — it makes every other local run cheaper to read, so it is worth more merged before people run suites than after. Sequencing only; both still wait on Opeyemi's word given to Kenya directly.

### Whatever decides, something else must notice when the decision changes

`lesson-agreement-two-facts` · **B5** · chore · *unclaimed*

THE RULE, which is the general form and the reason this card exists: whatever decides something, a separate thing must notice when that decision changes. Three instances turned up in one afternoon and none of us saw the pattern until the third:
- a filtered test run decides nothing was compared — so the test must announce that it had no evidence (cbe4981)
- an EXPLAINED row decides a difference is excused — so something must notice when the difference is gone (d69b2c1)
- a motion probe would decide whether values are compared — so something must assert WHICH pages were compared

THE FINDING THAT PRODUCED IT (obsrv-e7, 2026-09-14). CI on cdd7056 failed the parity gate: `obsrv_audit pageHeight — moves: headless=1080 live=1065`, obsrv_lint the same, on tests/fixtures/moves-while-measured.html, which slides at 140 px/s. Read twice, fifteen px apart. The surfaces were never implicated. CI sequence: 586caab green (before the C4 work), cdd7056 failure (E2E, one test, one assertion, one page), 1d4e505 SUCCESS — so the red lasted one run and was never 'the C4 work'.

THE LESSON. This machine read 1080 twice on every local run, so the comparison was wrong from its first run and every local green was evidence that two reads landed in the same frame. A third kind of silence: not a VALUE that fits two opposite facts, but an AGREEMENT that fits two — two numbers matching means either 'these agree' or 'nothing moved between the reads'. Both gate verifications that day were sound and neither could have caught it: both test the LOGIC, and this was the INPUT.

THE DESIGN, argued between both sessions. obsrv-a6 proposed replacing the `moving` flag with src/shared/pageMotion.ts, which already answers 'was this page holding still' on both surfaces. obsrv-e7's objection, correct: THE PROBE ANSWERS PER-RUN TOO — a page that moves slowly, or only while loading, reads as still on a fast host, which is how `moves` got past everyone. A probe that silently decides whether to compare values gives a green that fits two facts again, harder to spot because nothing names it.

So: per page, store each surface's probe verdict and whether values were compared; assert that the value-compared set equals the expected set. A page that silently stops being compared goes red; so does one that starts. Take the UNION across surfaces — if either says moving, it was moving. KEEP THE FLAG as an override: a fixture whose purpose is motion should not depend on a probe agreeing about it on the day. Probe for discovery, flag for what we can state.

### Regenerate the public board as part of cutting a release

`chore-board-on-release` · chore · *unclaimed*

docs/board.md is public (github.com/vibesyemmy/obsrv/blob/main/docs/board.md) and is the only surface an outside contributor has. It is generated by `npm run board` and nothing regenerates it, so it drifts from the artifact the moment a card moves — and a stale board is worse than none, because it sends someone to claim work that is already done.

It was built with three guards against reading as current when it is not: a generation date, a line saying the artifact is authoritative, and a reproducible generator. Those make drift VISIBLE. This card makes it RARE.

The obvious hook is `npm version`, which already runs scripts/sync-plugin-version.js and git-adds the plugin manifest — the same shape of problem (a generated file that must not lag the thing it describes) already solved once in this repo. Adding the board there means the public copy is never more than one release behind.

ONE PROBLEM TO SOLVE FIRST, and it is why this is not a two-line change: `npm run board` takes a dump directory as an argument, because the board lives in a Claude Artifact that a shell script cannot read — the dump comes from the Artifact tool's read_db with out_dir, which only an agent session can call. So a release hook cannot regenerate it unattended today.

Three options, roughly in order of how much they are worth:
- Make the release checklist say 'ask the session to run npm run board and commit it' — honest, costs nothing, relies on a human remembering.
- Have the version hook FAIL when docs/board.md is older than the newest card's updatedAt, so a release cannot be cut on a stale board. Needs a dump to compare against, so it has the same reachability problem, but only as a check rather than a build.
- Export the board to a committed JSON alongside the markdown, so the generator has a repo-local source and only the export needs a session. Then `npm run board` is reproducible by anyone and the drift check is trivial.

The third is the one that makes the file honest rather than merely fresh, and it is the one worth the time.

### Two peer sessions cannot read the board at all

`bug-board-access` · bug · owner: Henry

Raised 2026-09-14. Rook (room #21) and Kenya (#23, and direct) both get the same refusal reading the artifact's `tasks` collection:

no such artifact, collection, or document (or no access — the two are deliberately indistinguishable)

Three times each, independently. Two sessions blocked identically is one permission, not two coincidences.

WHAT IT COSTS RIGHT NOW: neither can claim a card, set an owner, or move anything to Review. Every board move today has gone through Henry by hand, which means the board is accurate only while one session is awake to update it, and a card sits `unclaimed` while someone is actively working it. That is exactly the quiet staleness docs/board.md was built to guard against, arriving through the door nobody watched.

Both refused to hand-edit docs/board.md instead, which was right — scripts/build-board.js says in its own header that the snapshot exists to be regenerated rather than edited back into agreement, and a generated file saying `Kenya, Doing` while the artifact says `unclaimed` is the defect the file exists to prevent.

The message is deliberately ambiguous between `does not exist` and `you cannot see it`, so the refusal itself cannot tell us which. Needs Opeyemi: check who the artifact is shared with. If org-internal sharing cannot reach these sessions at all, then the artifact is not usable as a multi-session board and docs/board.md is not a snapshot of the real board but the only board — which is a different design and should be decided rather than drifted into.

### The two walks cover a growing page differently — 3 screenfuls against 8

`bug-walk-coverage-diverges` · **C4** · bug · owner: obsrv-e7

Measured 2026-09-14 (obsrv-a6), same file, same session, both surfaces:

headless  3 screenfuls, atEnd true, page measures 4712, covered 3072 → coverage note FIRES   live      8 screenfuls, atEnd true, page measures 6832, covered 6912 → no gap, SILENT

Same URL: a warning on one surface, nothing on the other, and the two measurements are of different amounts of page. Each answer is internally consistent, which is what makes it hard to notice.

FIXTURE NOW IN THE REPO: tests/fixtures/app-shell-grows.html (merged 586caab) — an app shell whose inner feed extends twice as it is walked. No existing fixture had that shape; every other app-shell fixture walks further than the page measures, so none can make walkCoverageNote fire on an element scroller.

Handed to obsrv-e7 to run through the C4 parity harness, which catches exactly this asymmetry (a note-bearing array present on one surface and empty on the other) and is how the panel silence and the inspect gap both surfaced. obsrv-e7's read: if live really never fires the coverage note on an app shell, it is a seventh defect rather than a footnote to the sixth.

Cause still open: the `hidden` divergence, the two walks scrolling differently, or the growth being timing-dependent. obsrv-a6's one-off comparison could not separate them.

---

## Doing — 1

*Claimed. Someone is on it.*

### Three sessions were sharing one working tree

`chore-worktree-discipline` · chore · owner: Henry

Found 2026-09-14 when Kenya joined the room and reported being in /Users/opeyemiajagbe/Documents/Projects/Obsrv on main at f470827 — the same checkout Henry was mid-edit in, and the same one Rook described in the room at the older HEAD a5c1a3c. Kenya also saw its branch change under it (test/explained-table-staleness -> main), which was Henry merging and checking out main in that tree an hour earlier.

`git worktree list` showed only two worktrees, neither belonging to Rook or Kenya — so up to three sessions on one tree, which is the hazard Rook itself flagged in the room before anyone hit it, and which has cost this project a rebuild before (a `git checkout -- .` from one session dropped another's uncommitted work).

RESOLUTION ISSUED: nobody edits the shared checkout; each session takes its own worktree (Rook /tmp/obsrv-rook on feat/cli-version, Kenya /tmp/obsrv-kenya on docs/c5-note-inventory). Henry stays in the main checkout as the one already mid-change. obsrv-e7 has worked from /private/tmp/obsrv-c4-sweep all day, so the pattern is proven.

Also flagged: the git stash stack is SHARED across worktrees, so a bare `git stash pop` in one takes another's work. WIP commit, or stash push -u -m with a unique tag and apply by sha.

OPEN: this is currently a convention announced in a chat room, which is the weakest possible enforcement — it survives exactly as long as the room's scrollback. Worth deciding whether it belongs in CONTRIBUTING or a pre-edit check.

---

## Review — 3

*Finished, waiting on the maintainer to merge.*

### C5 is the criterion that catches what field comparison cannot

`c5-elevated` · **C5** · readiness · owner: Kenya

DELIVERED 2026-09-14 by Kenya, into Review. Branch `docs/c5-note-inventory`, commit 95ad923, in /tmp/obsrv-kenya. NOT merged, NOT pushed — waits on Opeyemi's word given to Kenya directly.

THE CARD'S FALLBACK WAS WRONG AND IS NOW INVERTED. `unsettledReason: 'resizing'` FIRES. Seen 3 runs of 3, on a real page, in the app. KEEP THE VALUE — do not remove it. This also retro-justifies shipping the enum in 0.61.0: docs/breaking-changes.md says the state is real, and it now has an observation behind it rather than a decision.

Why it looked unreachable, which is the part worth keeping: settleTarget (ipc.ts:1093) exits on two EQUAL consecutive 80 ms viewport reads inside a 4 s budget. Flipping between TWO presets gives each pair of reads a coin-flip chance of agreeing, so it exits `settled` almost at once — Kenya measured that first, 30,000 flips deep, and got `animating`. EIGHT distinct viewports in rotation keep consecutive reads disagreeing across the whole budget, and only then does it fall through to 'resizing' at ipc.ts:1105. So the real-world shape is not `a capture that caught a resize` but `the viewport changing on essentially every read for four continuous seconds` — a window dragged by its corner while a capture runs. The card's guess that it needed a harness fixture rather than an HTML one was right; the guess that a preset flip would do it was the part that hid it for a day.

Delivered:
- tests/e2e/live-drive.spec.ts — the positive case beside the existing negative assertion at :955, so the pair reads `this is when it fires` and `this is when it must not`. Full spec 44 passed, 1 skipped, 55.6 s, unfiltered.
- docs/note-inventory.md — 58 emitting call sites; the 17 on the live surface hand-checked: 3 observed, 14 never seen, published as such with file and line.
- docs/readiness.md — C5 PARTLY met, with the 41 unchecked headless/MCP sites named as unchecked rather than implied done.

THE FOURTH SHAPE OF THE DAY'S DEFECT, named by obsrv-91 against its own shipped proposal, and the one that belongs highest on this card: A VALUE NEVER OBSERVED FITS TWO FACTS — either it cannot happen, or nobody has provoked it hard enough. Removing it on the first is right; removing it on the second is data loss. The two are indistinguishable until someone designs an experiment to make it fire.\n\nobsrv-91 added `resizing` yesterday, told its user plainly it had never seen it fire, and proposed removing the value if it proved unreachable — suggesting a preset flip as the way to try. The flip is exactly what cannot produce it. So a CHEAP attempt to provoke a value feels like a test of reachability and is not: `nobody has made it happen` was never evidence it could not, and the error was reasoning as though one honest try settled it. obsrv-91's own words: its verification habit is to make checks fail on purpose, and this is the same move pointed at a value rather than an assertion.\n\nTWO METHOD FINDINGS Kenya asked be kept out of the commit message: 1. A phrase sieve over the suite UNDERCOUNTS. Matching note text mechanically said `55 of 58 never asserted`; spot-checking six found four that ARE asserted, through regexes and partial phrases the matcher cannot see (cli-snap-tiled.spec.ts:102, cli-walk.spec.ts:137, others). The sieve is in the file as a pointer to where to look, explicitly not as a result. A number that reads as measurement and is not is the same defect as the note that had never fired. Anyone automating C5: this is the trap. 2. live-drive.spec sets `info` (control port and token) in the FIRST test of the file, so any -g filtered single-test run dies on `Cannot read properties of undefined (reading 'token')`. It reads like a bug in whatever test you just wrote. Cost a run.

### Make diagnostics reachable from the README

`e2` · **E2** · readiness · owner: Rook

DELIVERED 2026-09-14 by Rook, into Review. Branch `feat/cli-version`, commit 717e924, worktree .claude/worktrees/rook-cli-version. NOT merged, NOT pushed — merging waits on Opeyemi's word given to Rook directly.

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

### fit-cap and onion-skin fail rather than skip when the desk scales the capture

`bug-retina` · bug · owner: Kenya

DELIVERED 2026-09-14 by Kenya, into Review. Commit 64e3c51 on `docs/c5-note-inventory` in /tmp/obsrv-kenya. NOT merged, NOT pushed. Opeyemi picked this card directly.

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

---

## Backlog — 16

*Not started, not yet picked.*

### sync.spec.ts:165 went flaky once on the loop-breaker test

`flake-sync-165` · bug · *unclaimed*

Reported by obsrv-e7 from its full-suite run, 2026-09-14: 'quick legitimate reversals are not a loop' failed once and passed on retry. That is the test obsrv-a6 was working around earlier the same day - a new test dropped into sync.spec made it fail half its runs because the file shares one app and the loop breaker counts reversals within LOOP_WINDOW_MS (3 s); the remedy was moving that test to its own file (sync-mirror-mark.spec.ts), not timing the handover.

So this is the same fragility showing without an added test, which means the shared-app coupling in sync.spec is closer to the edge than the fix implied. Worth knowing before anyone adds another test to that file. Not reproduced by obsrv-a6; six consecutive runs were clean after the split.

### Note inventory: every note seen to fire on a real page

`c5` · **C5** · readiness · *unclaimed*

The 2026-09-13 sweep did this for notes and found gaps; never completed.

### Check the skill describes the tools that exist

`c3` · **C3** · readiness · *unclaimed*

skills/obsrv-screens/SKILL.md — unknown for 0.60.0.

### Written compatibility policy

`c1` · **C1** · readiness · *unclaimed*

MCP output schemas are additionalProperties:false, so adding a field breaks sessions that listed tools earlier. Policy must say what may change before 1.0.

### Name breaking changes as such, by rule not habit

`c2` · **C2** · readiness · *unclaimed*

Partly met by habit. url changed meaning for live callers in 0.59.0.

### Auto-update: reach the new version without leaving the app

`a2` · **A2** · readiness · *unclaimed*

The updater checks GitHub daily and offers the release page; it never installs. Someone on 0.57.0 has no way to know.

### Cold-machine first run, on each surface

`a3` · **A3** · readiness · *unclaimed*

Never done on a machine that has never run Obsrv. Read the output as a stranger would.

### Install, use, uninstall — then list what remains

`a4` · **A4** · readiness · *unclaimed*

Temp leak closed by src/shared/pruneTemp.ts. ~/.obsrv and the Electron profile untouched; the check has never been run.

### Close or write down the remaining known gaps

`b2` · **B2** · readiness · *unclaimed*

Settle gap closed 2026-09-14. Still open: the dialog note has never fired on a live site across four runs; whether to enter open shadow roots is undecided.

### Measure the noise ratio with two independent classifiers

`b4` · **B4** · readiness · *unclaimed*

zalando.de answered 143 findings; nobody has established how many a developer would act on. B5 now makes this interpretable.

### A live run that turns up nothing user-visible

`b1` · **B1** · readiness · *unclaimed*

Cannot be scheduled — met when a run finds nothing. Runs 13-16 each found something. docs/research/

### A mirrored redirect's second commit can still be counted as an arrival

`bug-arrivals` · **B2** · bug · *unclaimed*

Deferred 2026-09-14 in commit 7d811f8. Two causes race for that commit; when it lands unmarked the arrivals counter counts it, so the spurious 'navigated after it loaded' note can fire on a redirect.

### A suite that measured nothing must be as loud as two suites at once

`chore-guard` · chore · *unclaimed*

SCOPE WIDENED 2026-09-14 on obsrv-91's argument, which is right: this card and the evidence-assertion are two halves of one thing, and building them apart gets one of them wrong.

HALF ONE — refuse to start a suite while another is running. Two concurrent suites in one worktree made both greens untrustworthy and cost a full afternoon.

THE HARD PART, and the reason a naive lock file is worse than nothing: the guard must distinguish ANOTHER SUITE RUNNING from A STALE LOCK LEFT BY A SUITE THAT DIED. Those are identical from a lock file alone. A guard that refuses on a stale lock gets its lock deleted by the first person who hits it, and then nobody trusts it again. Whatever it checks — a pid, a port, a live process — the refusal text must SAY WHICH OF THE TWO IT FOUND.

HALF TWO — a suite that passed having measured nothing is indistinguishable from one that passed having checked everything. obsrv-a6 hit this with a -g filtered run; Henry hit the same shape verifying the surface-parity staleness check, which passed green on a planted stale row because filtering had starved the rows it compares. The fix there was a vacuity guard (surface-parity.spec.ts:368) that fails when the comparison had no evidence. Generalise it.

Kenya's find is the third instance in one day and belongs in the same fix: live-drive.spec sets `info` (control port and token) in the FIRST test of the file, so any -g filtered single-test run of it dies on `Cannot read properties of undefined (reading 'token')` — which reads like a bug in whatever test you just wrote.

So: a concurrent suite, a stale lock, and a run that asserted nothing are three ways to get a green that means nothing, and the guard should name which one it is looking at in all three cases.

### `orientation: landscape` produces a portrait screen on every desktop preset

`bug-orientation-name` · **C2** · bug · *unclaimed*

src/shared/calibration.ts:40 — the flag names which STORED form to use (as-listed, or rotated a quarter turn), not the shape you get. 1080p-24 is stored 1920x1080, so the default gives landscape and `orientation: 'landscape'` rotates it to 1080x1920. `screenShape` then correctly reports 'portrait' beside it; both fields are right and answer different questions (comment at calibration.ts:37). cli/args.ts:190-200 documents all of it. Not a behaviour bug — a name that inverts its plain meaning. Evidence it costs: obsrv-e7 hit it on 2026-09-14 while hunting C4 parity defects, measured two different viewports without noticing, and was about to file it as a parity defect. Renaming is a breaking change to a public flag and an MCP field, so it is C2's to schedule, not a quiet fix.

### Drag tabs to re-arrange them, as every browser does

`feat-tab-reorder` · chore · *unclaimed*

Requested by Opeyemi 2026-09-14. Nothing today: TabBar.tsx has no draggable/onDragStart, and the control server has openTab/closeTab/activateTab but no moveTab. Order is positional — StoredTabs keeps a list plus an active index (shared/tabsFile.ts), and that file already documents how badly indices behave when the list shifts: dropping an entry shifts every index after it and can strand the active one. A reorder shifts the list on purpose, so it must move the active index with it and survive a restore; the tabs-come-back-on-relaunch spec is where that gets proved. Open questions for whoever takes it: whether an agent gets a moveTab command too (C2 — a new control command is a surface change), and whether reordering while agent control is on can move the driven tab out from under a command, since the agent acts on whichever tab is in front.

### Apply the breaking-changes policy to the last five releases

`c2-retroactive` · **C2** · readiness · *unclaimed*

What C2's check actually asks and the register does not yet satisfy: read 0.56.0 through 0.60.0 for anything that broke a caller and add it to docs/breaking-changes.md. Cheap per release — the notes exist on GitHub — but it needs reading the diffs too, since the releases that named a change are exactly the ones least likely to have missed one. Depends on C1: the policy defining what counts has not been written, and applying an unwritten policy retroactively is how a register becomes a matter of taste.

---

## Done — 17

*Merged.*

### `settled` degrades to the old meaning on an older app, without saying so

`bug-settled-fallback-silent` · **C4** · bug · owner: obsrv-91

CLOSED 2026-09-14 — already fixed before this card was written, and the card was the one thing that was stale. obsrv-a6 raised it in review of obsrv-91's stack and obsrv-91 fixed it before merging: commit c8b7f15, merged in cdd7056, CI green at 1d4e505.

VERIFIED rather than taken on the peer's word: `git merge-base --is-ancestor c8b7f15 origin/main` → yes, and origin/main:src/mcp/server.ts ~1012 carries the warning, pushed into the same array as capture.warnings, saying the app is older than the capture's settle verdict, that `settled` therefore reports whether the navigation was confirmed rather than whether the page went paint-quiet, and to update the app for the other answer.

Closed rather than assigned deliberately: anyone taking it reads the code, finds the warning already there, and loses twenty minutes deciding whether they are looking at the right line. A card describing a fixed bug costs more than no card.

Original diagnosis below, which was exactly right.

`liveSnap` answered `settled: capture.settled ?? confirmed`. The fallback is RIGHT; the objection was that it was silent — one name meaning two things across app VERSIONS, in the commit whose whole point was removing that across surfaces.

### Write: what an agent can do to the machine

`d2` · **D2** · readiness · owner: obsrv-a6

docs/agent-control.md — every control command grouped by what it means, the four gates, the consent bar, and the boundary it does not cross (0600 control.json is readable by anything running as you). Merged c33ee74.

### Write: what leaves the machine, and what is written where

`d3` · **D3** · readiness · owner: obsrv-a6

README § Privacy and files — one outbound request (the daily version check), every file named with its directory, and the log stated for what it does not record. Verified: zero log call sites record a URL. Merged c33ee74.

### Issue template that asks for what we need

`e1` · **E1** · readiness · owner: obsrv-a6

.github/ISSUE_TEMPLATE/bug_report.yml — requires the JSON, asks for address, command, surface, version and host display. config.yml puts the limitations page in front. Merged c33ee74.

### Release notes and a register for 0.61.0's three breaking changes

`c2-0610-breaking` · **C2** · readiness · owner: obsrv-a6

docs/breaking-changes.md — a durable register, newest first, each entry saying what breaks, what to do, and why. Holds 0.59.0's `url` change and 0.61.0's three (presetId/profileId removed; walk sentences notes->warnings; unsettledReason gains resizing, carrying the session-restart instruction because a stale MCP schema rejects a correct reply). Linked from README and the limitations page. Corrected readiness.md, which had the `url` change in 0.60.0 when git tag --contains puts it in v0.59.0. Merged 9f92351.

Still open, deliberately: the 0.61.0 entries are marked unreleased/pending — the fixes are obsrv-e7's and unmerged, and the `resizing` enum is a decision Opeyemi has not made. Draft release notes for 0.61.0 are in obsrv-a6's scratchpad, to be applied when the release is cut.

### Field-level sweep: both surfaces answer the same

`c4` · **C4** · readiness · owner: obsrv-e7

Merged cdd7056, pushed 2026-09-14. ALL SEVEN COMMITS NOW READ BY A SECOND PAIR OF EYES: obsrv-a6 reviewed 02656b8 and 5214d59 before the merge, and 80f3675, 603e605, c8b7f15 and 165429a after it (c48ca63 read in working-tree form). Nothing found that makes the merge wrong.

Work: tests/e2e/surface-parity.spec.ts drives audit/lint/inspect/snap through both surfaces over 11 pages and gates every remaining difference against an EXPLAINED table with a reason each; docs/research/2026-09-14-c4-field-sweep.md argues each finding. Six defects found and fixed, divergences 36 -> 22, plus a seventh found in note text. Suites: unit 1116, e2e 508 passed / 3 failed (the documented Retina trio, green on CI).

Two review findings, both raised as follow-ups rather than blockers:

1. The gate cannot go stale-detect. An EXPLAINED entry that no longer diverges is never flagged, so the table drifts into a list of things that USED to differ, and an entry means either 'still diverges, here is why' or 'nobody removed it' with no way to tell. Same silence-fits-two-facts shape the sweep itself exists to find. Carded: bug-explained-table-stale.

2. 80f3675's comment cites cli/main.ts:933-938 for the three headless sentences; those lines are the load and the inspect ask. The real site is ~945-953. Appears twice in that commit. Carded with the staleness one.

NOT closed by this: the seventh divergence, in note text on app-shell-grows, which a field-level gate structurally cannot catch (see the `hidden` card); and `resizing` is a schema value added today that has never been observed to fire (see C5).

### The parity gate cannot tell a live exemption from a forgotten one

`bug-explained-table-stale` · **C4** · bug · owner: obsrv-a6

Merged a5c1a3c and pushed 2026-09-14 (commits d69b2c1 + cbe4981, rebased onto 1d4e505).

The gate failed when a difference had no reason; nothing failed when a reason had no difference, so a row meant either 'still diverges, here is why' or 'nobody removed it'. The head of EXPLAINED already claimed the table 'cannot go stale without going red' — now true, and self-pruning: closing a divergence forces its exemption out.

VERIFIED four ways, and again after the rebase:   clean table                      -> 12 passed (twice)   planted stale row                -> RED, naming tool, field and reason   planted row for a tool never run -> quiet (the guard holds)   filtered run, nothing compared   -> fails loudly, 'nothing to check'

The fourth exists because the first verification attempt was wrong: with -g the per-page tests never populate `rows`, so a planted stale row came back green. cbe4981 makes that loud.

obsrv-e7 wrote the same fix concurrently and discarded it: its version had no answeredBoth guard, so a tool that errored everywhere would have had every exemption called stale.

CAVEAT ON THE MERGE, recorded because it is the day's own lesson: pushed while CI on the base (1d4e505) was still running. Local green was the only evidence, and local green on this machine is exactly what proved insufficient an hour earlier — see the 'agreement that fits two facts' card. If CI on a5c1a3c is red, check 1d4e505's own run before attributing it here.

NOT observed: `answeredBoth` returning false for a row carrying an error. The branch it feeds IS observed; the predicate has not been seen to fire on a real error.

### Record what the thresholds were calibrated against

`b3` · **B3** · readiness · owner: obsrv-a6

docs/thresholds.md — seven judged numbers, each answering what it derives from / was calibrated against / would move it, sorted into standard-borrowed, calibrated, reasoned-only, and definitional. Linked from README, limitations, audit.md, lint.md. Merged 1e1594a.

### Calibrate thin text: sweep 12 / 14 / 16 device px against real pages

`b3-thinpx` · **B3** · chore · owner: obsrv-a6

Swept 9 sites x 2 presets x 5 thresholds (90 runs). At 14 the rule fires on 1 of 9 sites; findings cluster at 8-11px weight 300 with nothing between 12 and 14, so 12-15 are the same answer. 2x is zero everywhere by arithmetic. The prediction that this would be B4's largest noise source was wrong and docs/thresholds.md now says so. linear.app crosses between 14 and 16 — the plateau is stripe's, not the web's. Merged d32952f.

### `blocked` and `panel` dropped by the scroll-report whitelist — fixed

`bug-blocked-not-forwarded` · **C4** · bug · owner: obsrv-e7

SUPERSEDED BY THE C4 CARD — kept for the history, not for tracking. This card was opened when the finding looked like one bug; it grew into the five-then-seven-commit stack that the 'Field-level sweep' card now carries, and it went stale describing pre-merge state.

The fix itself: obsrv-e7 found and fixed it. Root cause was parseScrollReport in shared/ipcPayloads.ts — a whitelist, so a field added to the type, the preload and the control reply still arrived undefined until named there. It dropped `panel` too, which left the live surface silent on a locked page with no dialog role. Reviewed by obsrv-a6 (commit 02656b8) and the panel half independently reproduced on a separate fixture.

Merged in cdd7056 and pushed 2026-09-14. Live status and open questions are on the C4 card.

### FIXED: the coverage note measures whether the page grew instead of guessing

`bug-hidden-two-meanings` · **C4** · bug · owner: Henry

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

`done-b5` · **B5** · readiness · owner: obsrv-a6

docs/research/2026-09-14-b5-repeatability.md — 0 of 3,375 fields on fixtures, 0 of 49 on berkshirehathaway.com, 0 of 22 across releases against a control finding 7.

### D1: a limitations page

`done-d1` · **D1** · readiness · owner: obsrv-a6

docs/limitations.md, linked from the README above the Quickstart.

### Prune the temp directories captures leave behind

`done-prune` · **A4** · bug · owner: obsrv-a6

src/shared/pruneTemp.ts — 10,045 entries / 400 MB had accumulated.

### audit and lint say when the page moved under them

`done-motion` · **B2** · bug · owner: obsrv-a6

src/shared/pageMotion.ts — stripe.com moved finding boxes 438 CSS px between runs in silence.

### The toolbar's navigate answers within a budget

`done-navigate` · bug · owner: obsrv-a6

Commit 630ebe6. IPC.navigate returned the unbounded navigateBoth; the address field never synced on a page that never finishes loading.

### A mirrored commit is marked, not withheld

`done-mirror` · bug · owner: obsrv-a6

Commit 7d811f8. Withholding url-changed made sync.spec depend on a race; clean main failed 1 run in 6, now 0 in 6.

---

*Regenerate with `npm run board`. Counts above: 14 readiness, 6 bugs, 8 chores, among the open cards.*
