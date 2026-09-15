# Ready for the public: what it means, and where we are

Obsrv has been released 60 times to an audience of the people who build it.
Going public is a different claim, and until now the criteria for it have
lived in conversation — which is why "is it ready?" has been a question of
judgement rather than of fact.

This is the list. Each item is a claim about the product, with **the check
that settles it**: a criterion is met when its check has been run and the
result written down with a date, not when it feels true. An unrun check is
recorded as *unknown*, which is a different thing from *failing* and worth
keeping separate — most of this list is unknown rather than broken.

Status here is as of **0.60.0, 2026-09-13**. Nineteen criteria: A1-A4, B1-B5,
C1-C5, D1-D3, E1-E2.

---

## A. A stranger can install it and get an answer

**A1. The app is signed and notarised.** Today every DMG says "Obsrv is
damaged and can't be opened" on first launch and the release notes carry an
`xattr` command. `electron-builder.yml` has `hardenedRuntime: true` and
`notarize: false`; the wiring waits on `chore/signing`. The blocker is a
**Developer ID Application** certificate — the one in `~/Documents/obsrv-signing`
is an Apple Distribution certificate for Voicify Limited, which is the wrong
type for direct distribution.
*Check:* download the DMG on a Mac that has never run Obsrv, open it, and
reach the window without a terminal. **Status: not met.**

**A2. A user on an old version finds out.** The updater checks GitHub once a
day and offers the release page; it never installs. Two releases shipped
today. Someone on 0.57.0 has no way to know.
*Check:* on a machine running version *n-2*, see the app say so and reach the
new version without leaving it. **Status: not met.**

**A3. First run is survivable on each surface, on a cold machine.** The one
never driven: `npm i -g getobsrv && obsrv snap example.com` on a machine with
no npx cache downloads ~110 MB of Electron at first use. The MCP path failed
silently at this until 0.52.0; the CLI path has not been tested cold.
*Check:* a fresh account, no caches, all three surfaces, timed, with the
output read as a stranger would read it. **Status: unknown.**

**A4. Removing it leaves nothing behind.** The temp half is closed: nothing
pruned the capture directories, and this machine held **10,045 `obsrv-*`
entries** in `os.tmpdir()` (400 MB) before they were cleared by hand; the MCP
server now prunes its own prefix, older than a day, at startup
(`src/shared/pruneTemp.ts`, 2026-09-14). The check has now been run on all three
surfaces — CLI, MCP and the desktop app — install, use, uninstall, in a
disposable home
([`docs/research/2026-09-14-a4-install-remains.md`](research/2026-09-14-a4-install-remains.md)).
*Check:* install, use, uninstall, then list what remains.
**Status: NOT met 2026-09-14 — measured, and removing it leaves everything
behind.**
Deleting `Obsrv.app` removes one thing: the app. After one page load the
profile held 86 entries and 6 MB, and deleting the bundle changed none of them —
`settings.json`, `tabs.json`, the Chromium profile (Cookies, Local Storage,
Session Storage, the caches), `obsrv.log`, and **`history.json`, the addresses
visited in the app**. The README says history.json holds them; nothing says it
outlives the app, and there is no uninstall command or documented removal. With
agent control on, `control.json` (port, token, pid, mode 0600) is removed on a
clean quit and **survives a SIGKILL** — harmless to discovery, which treats a
dead pid as no app, but it then survives the uninstall too.
The temp directories are genuinely clean: after a real render and an MCP
handshake, no `obsrv-cli-*` or `obsrv-mcp-*` entry remained. What `npm rm -g
getobsrv` leaves is **128 MB**: `~/Library/Caches/electron/<sha>/electron-v43.7.0-darwin-arm64.zip`,
downloaded by `@electron/get` on first run, outside `node_modules`, removed by
nothing and mentioned in no document. `~/.claude/skills/obsrv-screens` also
survives — correct, since it is a separate explicit install, but `install-skill`
has no removal and nothing says so.
Two corrections this produced. **This criterion named `~/.obsrv`, which does not
exist and which nothing writes** — the app's state is in
`~/Library/Application Support/Obsrv` and `~/Library/Logs/Obsrv`; a check
looking in `~/.obsrv` would have reported "nothing remains" whatever the truth.
And **`HOME` does not isolate Electron on macOS**: `os.homedir()` follows it
while `userData`, `appData`, `logs` and `cache` stay in the real user's
directory, so a HOME-only sandbox writes into the profile it is supposed to
protect while every Node-level check says otherwise. `CFFIXED_USER_HOME` moves
them; `--user-data-dir` moves `userData` but **not `logs`**, which is why the dev
lane and the installed app share one `obsrv.log`.

---

## B. The answers can be trusted

**B1. A live run that turns up nothing user-visible.** Runs 13, 14 and 15
each found real defects, and 2026-09-13 alone produced four that had reached
users. Each is smaller than the last, which is the right direction and not
the same as arriving.
*Check:* a full live run over a fresh set of sites and the dev-server shapes,
producing no finding that changes what a user is told. **Status: not met —
never achieved.**

**B2. The known gaps are closed or written down as limits.** Closed
2026-09-14: `audit` and `lint` measured a moving page without saying so. Both
now measure the page twice, 250 ms apart, and say what actually moved — keyed
off their own boxes rather than off a paint verdict, because a video and an
opacity fade paint steadily without moving anything and their figures are
perfectly repeatable. **Its own limit belongs in D1**: the probe sees motion
during its window, so a carousel that steps every few seconds passes it, and
the note's absence is not a promise that the page is still. Open today: a page
locked by a wall versus a page whose
dialog steals the walk are different shapes and only one has a sentence —
though on fixtures both fired, identically on all five runs, the dialog's in
its own words ("the walk scrolled a dialog, not the page itself"), so what is
unproven is live firing rather than the sentence's existence; the dialog note
has never fired on a live site across four runs; whether the measurement
should enter open shadow roots at all is undecided, and the evidence that
decision needs was only being collected for pages that measure as *empty*.
*Check:* each item either fixed, or present in the limitations page (D1) in a
sentence a user could act on. **Status: not met.**

**B3. The thresholds can be argued with.** 7 mm for tap targets, 2 mm for
text, 14 device px for thin text, 15% or 25 elements for the shadow share.
The output calls them provisional, which is honest and leaves a reader unable
to disagree on any ground but taste.
*Check:* one short section per threshold — what it derives from, what it was
calibrated against, and what would move it. **Status: met 2026-09-14 —
[`docs/thresholds.md`](thresholds.md), linked from the README, the limitations
page, `audit.md` and `lint.md`.** Each of the seven judged numbers answers the
three questions, and the page opens by sorting them into the kinds that can be
argued with at all: borrowed from a published standard (the WCAG ratios —
argue upstream), calibrated against real output (the shadow share's
1.9/3.8/7.7/15.4/23/50/77% sweep, the motion probe's 0-4 s table), reasoned
but never calibrated, or definitional (a sub-pixel edge is arithmetic).

**Writing it found the answer to its own question, and then the answer was
measured.** The page named **thin text at 14 device px** as the weakest number
in the tool — a mechanism, no table — and predicted it would be B4's largest
source of noise. It was swept the same day across nine public sites, and the
prediction was wrong: at 14 the rule fires on **one site in nine**, and what
it flags clusters at 8-11 px weight 300 with nothing between 12 and 14, so
moving the line from 12 to 14 changes two findings. 14 sits on a plateau
rather than a cliff, which is a defence of it that did not exist that morning.
The number that still rests on unpublished evidence is the tap-target 7 mm,
and the page now says so instead.

**B4. The noise ratio is measured, not assumed.** zalando.de answered 143
targets with **103 under 7 mm**. If most of those are not things anyone would
change, a first run teaches the reader to skim, and every true finding after
that is cheaper to ignore.
*Check:* three real sites, every finding classified *would act* / *would
not*, the ratio published — **classified by someone who did not write the
rules**, because the same result read two ways is the defect this list keeps
producing: a ratio scored by the rules' author fits "the rules are good" and
"the scorer wrote the rules" equally well, and the number cannot separate
them. Two classifiers, their disagreement rate published beside the ratio,
and neither of them the person who chose the thresholds. **Status: measured 2026-09-15, and
NO RATIO IS PUBLISHED** — the two classifiers disagreed on 57% of findings
(52% under the fairest collapse, Cohen's κ = −0.07, no better than chance).
The protocol fixed in advance that anything above ~25% publishes no number,
because a disagreed-upon ratio quoted alone reads as measurement and is not.

What the disagreement says is worth more than the ratio would have been:
agreement was **total where the page is badly broken and near zero where it is
marginal** — 31 of 31 on a page with no viewport tag, 2 of 39 on a heavy
commercial page. The noise ratio is a property of the page and of who is
asked, not of the tool.

The question that would carry a number, and B4 should probably become it:
**how many distinct changes a report implies against how many rows it prints.**
On these three pages, 79 sampled findings collapsed to about 6 changes. That
has one answer per page rather than one per rater, and it measures what the
criterion was actually worried about — that a first run teaches the reader to
skim. Depends on B5: a ratio measured against a moving quantity says nothing.

**B5. The same page measured twice answers the same.** Nothing on this list
matters more and nobody has ever checked it. A user's first real use is a
before-and-after — change the CSS, run it again, read the difference — and if
the count moves on its own (a lazy image that loaded this time, a walk that
reached one screenful further, a contrast verdict on a gradient) then part of
what they read is noise wearing the shape of a result. obsrv-9b raised this
and ranked it third of three; I would rank it first, because B4 and every
before-and-after a user ever runs are measuring against it.
*Check:* **two numbers, published separately, because one of them cannot be
read without the other** (obsrv-9b's sharpening — a single figure over live
sites cannot tell *the tool moved* from *the page moved*, and live sites
rotate ads, split traffic and lazy-load on timing).

1. **Against locally served fixtures**, five runs, bytes provably identical
   between them: any variation is ours — a walk that reached a screenful
   further, a settle that fired earlier, a contrast verdict that landed
   differently. This is the number that says whether the tool is
   deterministic, and it is the cheaper of the two. A non-zero result here
   makes the second number uninterpretable, so run it first.
2. **Against three real sites**, five runs: ours plus theirs, not
   decomposable. This is what a user meets on a before-and-after, and it is
   what B4's ratio has to survive.

Then the fixtures again across two released versions, since drift between
releases is the same defect on a longer clock — the walk count changing in
0.60.0 was deliberate, and a number alone would not have said so.
**Status: MET ON ONE DESK, and a second desk disagrees — 2026-09-14
(`docs/research/2026-09-14-b5-repeatability.md`).** Downgraded from *met* the
same evening it was claimed. The fixture zero below is real and was taken on
one machine; Kenya ran the same sweep on CI, five runs each side, like for
like:

    this laptop   Apple M4 Pro, 14 cores, 1x ultrawide    result fields moved: 0    182 s
    CI            Apple M1 (Virtual), 3 cores             result fields moved: 4    225 s

Errors zero on both sides, the comparator saw every planted difference on both
sides, 1,061 leaves per run and per-case leaf counts identical across desks —
so the two sides measured the same thing and got different answers. Both
diverging cases are `grows-as-walked.html`: `pageHeight`,
`summary.text.count` and `warnings[0]` on audit, `warnings[0]` on lint. **A
page that extends as it is scrolled does not answer the same twice on a slow
three-core VM, and does on a fast laptop.**

What the values moved *between* is not yet known — the first sweep recorded
key names only, and the harness now records distinct values per moved leaf.
Not characterised here rather than guessed at.

So the criterion is not met as written. "The same page measured twice answers
the same" is true of this desk and false of a slower one, which means every
before-and-after measured against the zero inherits the machine it was taken
on. The original claim was mine and single-host, and single-host was exactly
the objection `ci-second-host` was raised to test. It tested it, and the answer
came back against the claim.

Fixtures, on this laptop: **0 of 3,375 fields moved**, 33 cases × 5 runs, quiet and with the machine saturated, the
comparator proved able to see planted differences first. Real sites:
**0 of 49 on berkshirehathaway.com** — a real site over the real internet with
nothing different — while bbc.com and stripe.com moved in geometry only, the
counts a user acts on (`findings`, `targets.under`) holding on every run.
Across releases: **0 of 22 cases** differ between 0.59.0 and 0.60.0, and 0
between 0.60.0 and `main`, against a control — 0.58.0 to 0.59.0 — that finds 7
and traces every one to a named commit. That zero was predicted before it was
measured: 0.60.0's only functional change was the application menu, and the
CLI has no View menu.

It found one defect, which was C4's as much as B5's and is **closed the same
day**: `audit` and `lint` measured a moving page without saying so — stripe.com
answered `settled: false, unsettledReason: animating` to `snap` and
`warnings: []` to the other two, over finding boxes moving up to 438 CSS px
between runs, on coordinates `report` pins to a screenshot. Both now measure
twice and say what moved (B2, and `src/shared/pageMotion.ts`).

---

## C. The agent contract is stable

Half the users are agents, and they read schemas rather than prose.

**C1. A written compatibility policy.** Every MCP output schema is
`additionalProperties: false`, so a session that listed the tools before an
upgrade rejects a result carrying a new key. That constraint decided three
designs this week — it is load-bearing and nowhere stated.
*Check:* a page saying what may change in a minor, what may not, and how a
breaking change is announced before 1.0. **Status: met 2026-09-15 —
[`docs/compatibility.md`](compatibility.md).** It leads with the constraint
rather than burying it: on the MCP surface **adding** a field is breaking,
which inverts the rule most projects run on and is the thing that decided three
designs this week. It names the four contracts and says they are not equally
strict — MCP replies, the CLI's stdout key set (asserted exactly by the suite),
the control server, and exit codes, with stderr prose explicitly not a
contract. It says what a minor may change, that a patch may change none of it,
what will not change without being named, and what "named" means: an entry
giving what breaks, what to do, and **why it ships anyway** — a break with no
stated benefit being one nobody weighed.

**C2. Breaking changes are named as such.** `url` changed meaning for live
callers in **0.59.0** — reasonable pre-1.0, and legible only because the
release notes led with it. That was a choice each time rather than a rule.
(This entry said 0.60.0 until 2026-09-14. `git tag --contains` on the commit
says 0.59.0, and the v0.59.0 release body carries the heading. A register is
worth having partly because the memory of which release broke what is the
first thing to go.)
*Check:* the policy from C1 applied to the last five releases retroactively;
anything that broke a caller appears in its notes under a heading that says
so. **Status: partly met — the register now exists
([`docs/breaking-changes.md`](breaking-changes.md), linked from the README),
holding 0.59.0's change and 0.61.0's three. The retroactive pass over the last
five releases has not been done, and C1's policy does not exist yet, so the
check is not satisfied.**

**C3. The skill describes the tools that exist.** `skills/obsrv-screens/SKILL.md`
is what an agent reads instead of the README, and it has drifted before.
*Check:* drive every documented example against the current release; each
answers. **Status: unknown for 0.60.0.**

**C4. The two surfaces answer the same question the same way, or the
difference is written down.** The most productive defect class of the last
fortnight, and it had no criterion here until obsrv-9b said so. `url` meant
the request headless and the landing live. `hidden` meant `overflowHidden()`
headless and `scroller === 'root' && overflowHidden()` live — one name, two
definitions, and the live side structurally unable to express a case being
added. Three notes existed only headless for a full release. An agent calling
`mode: auto` does not choose which surface answers, so a divergence is
invisible to it by construction.
*Check:* one fixture set driven through both surfaces, compared **field by
field** rather than note by note, with every difference either removed or
listed as intended. **Status: unknown — the 2026-09-13 sweep did this for
notes and found four divergences; no field-level pass has ever run.**

**C5. Every note the tool can emit has been seen to fire, on a real page.** A
note that has never fired is indistinguishable from a note that *cannot*
fire, and this project has shipped at least one of each: `walkDialogNote` was
pinned on a fixture while citing a live site the same day's report had
withdrawn, and the shadow share reported only on pages measuring as empty for
three releases while claiming to gather evidence about pages that were not.
*Check:* an inventory of the emitting functions, each with the date and page
where its output was last observed, and the ones never seen in the wild
published as such. **Status: partly met, 2026-09-14** — the inventory is
`docs/note-inventory.md`. It collects all 58 emitting call sites and checks the
17 on the live surface by hand: three have been observed, fourteen have not and
are published as such. The 41 headless and MCP call sites are not yet checked.
`unsettledReason: 'resizing'` — legal in the schema, asserted legal by
`tests/e2e/mcp.spec.ts:472`, never once produced — was observed on 2026-09-14
and is now pinned by `tests/e2e/live-drive.spec.ts`.

---

## D. The limits are legible

**D1. A limitations page.** Scattered across release notes and code comments
today: macOS Chromium is the rasterisation truth and Windows ClearType will
differ; `diff` is 1x-only; the measurement does not enter open shadow roots;
captures cap at 4096 device px; content inside an `<iframe>` is not reached;
there is no Windows or Linux build.
*Check:* one page, linked from the README, that a user hits before the
limitation does. **Status: met 2026-09-14 —
[`docs/limitations.md`](limitations.md), linked from the README above the
Quickstart.** It carries the six above plus the motion probe's window, the
walk's coverage, the MCP's concurrency, the thresholds' provisional standing,
and the two gaps we have not closed (the dialog note never firing live, and
B4's unmeasured noise ratio). D2 and D3 are named on it as owed and not
written.

**D2. What an agent can do to the machine.** With agent control on, an MCP
client drives the window: navigates anywhere, clicks, scrolls, captures. The
control file is loopback with a token and a single-instance lock, and there
is a consent bar — a defensible model that no public user can currently read.
*Check:* one page describing the surface, the consent, and how to turn it
off. **Status: met 2026-09-14 — [`docs/agent-control.md`](agent-control.md),
linked from the README and from the limitations page.** Every command the
control server accepts, the four gates in front of it (loopback bind, Origin
refused, JSON content type required, constant-time token), the consent bar and
the fact that "Allow for this session" writes nothing to disk, and the
`0600` discovery file — including the boundary it does *not* cross: anything
running as you can read that token while control is on.

**D3. What leaves the machine, and what is written where.** Nothing is
uploaded; PNGs, report HTML and logs are written locally, some to
`os.tmpdir()` (see A4).
*Check:* a paragraph in the README stating both. **Status: met 2026-09-14 —
the README's *Privacy and files* section.** One outbound request of the app's
own (the daily version check), every file it writes named with its directory,
and the log stated for what it does *not* record: it carries GPU and window
events, not the addresses visited.

---

## E. A stranger can report a bug

**E1. Somewhere to report it, that asks for what we need.** **Met 2026-09-14
— [`.github/ISSUE_TEMPLATE/bug_report.yml`](../.github/ISSUE_TEMPLATE/bug_report.yml).**
A GitHub issue form that requires the JSON and asks for the address, the exact
command, which of the three surfaces answered, the version, and the host
display — the last because some of what Obsrv draws depends on it, as the
`fit-cap` and `onion-skin` failures showed. It warns that the JSON carries the
URLs and page text before you paste it, and `config.yml` points at the
limitations page first. Previously: `.github/` held
a workflow and nothing else: no issue template, no CONTRIBUTING, no
SECURITY.md. A report without the JSON answer and the version is
unactionable, and a template is the cheapest way to always get both.
*Check:* file an issue as an outsider; the form asks for version, surface,
URL and the JSON. **Status: not met.**

**E2. Diagnostics are reachable.** The log file's location and the running
version, documented where someone looking for them will be.
*Check:* find both from the README alone. **Status: met 2026-09-14.**
The log's location and the version are both in the README's *Privacy and
files* section and in the issue template. `obsrv --version` (also `-v`) is
answered by the plain-Node launcher before it looks for the build or the
Electron binary, so it works on the machine where either of those is what
broke — measured in a checkout with no `out/` and no Electron downloaded
(`tests/unit/cliLauncher.test.ts` holds that as a fixture). The built entry
answers the same flag for anyone running it under Electron directly. Before
this the flag was the one thing the issue template had to say did not exist.

---

## Explicitly not blocking

- **Windows and Linux.** The value is macOS Chromium's raster; the
  requirement is to *say* macOS-only (D1), not to build them.
- **Repo housekeeping.** 18 stale `.tgz` files in the root (untracked), and
  the temp directories from A4.
- **Internal tooling.** The guard that would refuse to start a test suite
  while another is running — refuse, name what it found, and be wired to stop
  the thing. Ours, not the user's.

---

## Where that leaves us

Nothing on this list is hard, and two items were load-bearing for others:
**B5**, because a measurement that moves on its own makes B4 and every
before-and-after meaningless, and **C4**, because an agent cannot see which
surface answered it. **B5 is now met** — the tool does not move on its own,
which is what B4 and every before-and-after are measured against, and the one
defect it found was a C4 failure too and is fixed. **A1 is the only one that
depends on someone
outside the project** — Apple issuing a Developer ID Application certificate
— which is why it should start first. B1 is the only one that cannot be
scheduled: it is met when a run finds nothing, and the way to get there is to
keep running them.

The rest is a week of writing and one careful cold-machine install.
