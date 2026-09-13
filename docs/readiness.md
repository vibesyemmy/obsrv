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

**A4. Removing it leaves nothing behind.** Nothing prunes the temp files:
this machine holds **9,828 `obsrv-*` entries** in `os.tmpdir()` from months of
runs, and the app's own state lives in `~/.obsrv` and its Electron profile.
*Check:* install, use, uninstall, then list what remains. **Status: not met.**

---

## B. The answers can be trusted

**B1. A live run that turns up nothing user-visible.** Runs 13, 14 and 15
each found real defects, and 2026-09-13 alone produced four that had reached
users. Each is smaller than the last, which is the right direction and not
the same as arriving.
*Check:* a full live run over a fresh set of sites and the dev-server shapes,
producing no finding that changes what a user is told. **Status: not met —
never achieved.**

**B2. The known gaps are closed or written down as limits.** Open today: a
page locked by a wall versus a page whose dialog steals the walk are
different shapes and only one has a sentence; the dialog note has never fired
on a live site across four runs; whether the measurement should enter open
shadow roots at all is undecided, and the evidence that decision needs was
only being collected for pages that measure as *empty*.
*Check:* each item either fixed, or present in the limitations page (D1) in a
sentence a user could act on. **Status: not met.**

**B3. The thresholds can be argued with.** 7 mm for tap targets, 2 mm for
text, 14 device px for thin text, 15% or 25 elements for the shadow share.
The output calls them provisional, which is honest and leaves a reader unable
to disagree on any ground but taste.
*Check:* one short section per threshold — what it derives from, what it was
calibrated against, and what would move it. **Status: not met.**

**B4. The noise ratio is measured, not assumed.** zalando.de answered 143
targets with **103 under 7 mm**. If most of those are not things anyone would
change, a first run teaches the reader to skim, and every true finding after
that is cheaper to ignore.
*Check:* three real sites, every finding classified *would act* / *would not*,
the ratio published. **Status: unknown — never measured.** Depends on B5: a
ratio measured against a moving quantity says nothing.

**B5. The same page measured twice answers the same.** Nothing on this list
matters more and nobody has ever checked it. A user's first real use is a
before-and-after — change the CSS, run it again, read the difference — and if
the count moves on its own (a lazy image that loaded this time, a walk that
reached one screenful further, a contrast verdict on a gradient) then part of
what they read is noise wearing the shape of a result. obsrv-9b raised this
and ranked it third of three; I would rank it first, because B4 and every
before-and-after a user ever runs are measuring against it.
*Check:* three real sites, five runs each, nothing changed between runs; the
variation in finding counts published. Then the same three across two
released versions, since drift between releases is the same defect on a
longer clock. **Status: unknown — never measured.**

---

## C. The agent contract is stable

Half the users are agents, and they read schemas rather than prose.

**C1. A written compatibility policy.** Every MCP output schema is
`additionalProperties: false`, so a session that listed the tools before an
upgrade rejects a result carrying a new key. That constraint decided three
designs this week — it is load-bearing and nowhere stated.
*Check:* a page saying what may change in a minor, what may not, and how a
breaking change is announced before 1.0. **Status: not met.**

**C2. Breaking changes are named as such.** `url` changed meaning for live
callers in 0.60.0 — reasonable pre-1.0, and legible only because the release
notes led with it. That was a choice each time rather than a rule.
*Check:* the policy from C1 applied to the last five releases retroactively;
anything that broke a caller appears in its notes under a heading that says
so. **Status: partly met, by habit rather than rule.**

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
published as such. **Status: unknown.**

---

## D. The limits are legible

**D1. A limitations page.** Scattered across release notes and code comments
today: macOS Chromium is the rasterisation truth and Windows ClearType will
differ; `diff` is 1x-only; the measurement does not enter open shadow roots;
captures cap at 4096 device px; content inside an `<iframe>` is not reached;
there is no Windows or Linux build.
*Check:* one page, linked from the README, that a user hits before the
limitation does. **Status: not met.**

**D2. What an agent can do to the machine.** With agent control on, an MCP
client drives the window: navigates anywhere, clicks, scrolls, captures. The
control file is loopback with a token and a single-instance lock, and there
is a consent bar — a defensible model that no public user can currently read.
*Check:* one page describing the surface, the consent, and how to turn it
off. **Status: not met.**

**D3. What leaves the machine, and what is written where.** Nothing is
uploaded; PNGs, report HTML and logs are written locally, some to
`os.tmpdir()` (see A4).
*Check:* a paragraph in the README stating both. **Status: not met.**

---

## E. A stranger can report a bug

**E1. Somewhere to report it, that asks for what we need.** `.github/` holds
a workflow and nothing else: no issue template, no CONTRIBUTING, no
SECURITY.md. A report without the JSON answer and the version is
unactionable, and a template is the cheapest way to always get both.
*Check:* file an issue as an outsider; the form asks for version, surface,
URL and the JSON. **Status: not met.**

**E2. Diagnostics are reachable.** The log file's location and the running
version, documented where someone looking for them will be.
*Check:* find both from the README alone. **Status: unknown.**

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

Nothing on this list is hard, and two items are load-bearing for others:
**B5**, because a measurement that moves on its own makes B4 and every
before-and-after meaningless, and **C4**, because an agent cannot see which
surface answered it. **A1 is the only one that depends on someone
outside the project** — Apple issuing a Developer ID Application certificate
— which is why it should start first. B1 is the only one that cannot be
scheduled: it is met when a run finds nothing, and the way to get there is to
keep running them.

The rest is a week of writing and one careful cold-machine install.
