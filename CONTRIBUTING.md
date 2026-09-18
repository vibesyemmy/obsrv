# Contributing to Obsrv

This is not a style guide. It is the list of things that have actually cost
this project time — each one found by someone losing an hour to it, and each
one written down so the next person loses none.

Several sessions, human and agent, work on this repository at once. Most of
what follows exists because of that.

## The board

The work is [`board/`](board), one markdown file per card. **Claim a card by
editing its file**: set `owner:`, `column: doing` and `waiting: ""`, then open
a pull request with **only the card**. There is no separate tracker and
nobody to ask for access.

**The claim merges before the work starts.** A claim that rides on the work
branch is invisible on `main` for as long as the work takes, which is exactly
when someone else might pick the card up. The first claim merged this way went
from open to merged in 74 seconds.

**You may merge your own claim**, once every check is green, if it touches
exactly one card and changes only `column` (to `doing`), `owner` (where it was
empty) and `waiting` (to `""`). Anything more goes to the maintainer: body
text, a second file, or a card someone already owns. Taking an owned card is a
handover, not a claim.

**A Doing card says whether it is moving or waiting, and on whom.** `waiting: ""`
means moving. When the work stops on someone or something, name it first, as
`who: what`: `waiting: "Opeyemi: a time for run 19"`, or
`waiting: "ci: #48's suite, then merge"`. Name who with one of the usual words:
a room name, `Opeyemi`, `ci` for a suite or a merge that will come in minutes,
or `event` for what nobody can force, such as a recurrence. A card in CI and a
card waiting on a recurrence are different waits, and one word hid the first
inside the second. `board:check` refuses a Doing card
without the line, and a value that does not name its subject first. The board
counts what waits on each name, so the person with a batch sees it, and the
chase goes to whoever the card waits on rather than to its owner. Absent is
refused rather than read as moving, because an absent field fits "nothing is
waiting" and "nobody filled it in" equally. Update the line when it changes,
and **delete it when the card leaves Doing**, unless it goes to Review, where
the line is optional and names the reviewer the card waits on. Off Doing and
Review nothing renders it, so the check refuses it there instead of keeping a
record nobody reads. A card that finished and sits in CI waits on `ci`, not on
its owner. **The board shows when each wait was set**, from the commit that last
changed the line, so "back at 13:00" read at 15:00 is visibly two hours old.
Names are counted case-insensitively.

**The generated views are not committed.** `docs/board.md` and
`docs/board.html` are gitignored. Build them when you want to look:

```bash
npm run board          # writes both, locally, for you
```

Anyone outside the repo reads [the published board](https://vibesyemmy.github.io/obsrv/),
which `pages.yml` builds from `main` on every push. **Never commit either file.**

### Why they are not committed, because the old rule was in this file for weeks

They used to be, and the rule here was *"when a generated view conflicts on a
rebase, regenerate it, never hand-resolve it"*. It was correct and everybody
knew it, and it still cost a night: every branch touching any card conflicted
with every other branch touching any card, on two files that are derived. One
session conflicted six times inside a single multi-commit rebase; one pull
request was rebased three times; and one of those rebases **pushed conflict
markers to `main`**, because the rule has an exception — cards, which must be
resolved by hand — and the exception is the one that got applied by mistake at
the tired end of a rebase.

**A conflict whose resolution is always "recompute it" is not a conflict. It is
a merge driver nobody wrote, paid for once per branch.** Deleting the stored
copy is the version of that fix with no rule to remember.

What it costs, so it reads as a trade rather than a win: a reader browsing the
repo tree sees no board file and has to follow a link, and `board:check` can no
longer compare anything.

`npm run board:check` runs on **every push to every branch** and now fails only
if a card cannot be read or rendered — a missing frontmatter block, a broken
field. The failure names the card. It is deliberately not a step inside the main
suite: a `pull_request` workflow runs against `refs/pull/N/merge`, which GitHub
cannot compute while a PR conflicts, so a check living there would be absent on
exactly the pull requests most likely to need it.

**`board:check` cannot tell you a card says what you think it says.** It never
could. It renders the cards; it does not read them. A card whose `column`
regressed in a rebase passes it cleanly — that is how two cards reached `main`
sitting in Review on the day this changed. After a multi-commit rebase, read the
frontmatter of every card you touched.

**A conflict in a card still needs a decision.** If two people edited the same
card, read both. Nothing regenerates that.

Merging is the maintainer's. A card in Review is finished and waiting on them,
not on help.

## A session name is not an identity

**A name vanishing from `ListAgents` means the socket is gone, not the agent.** A
resumed session gets a new socket and a new name and keeps its context, so the
same colleague can reappear minutes later as somebody else.

This cost a false obituary. A session went unreachable — a direct message
refused, the name absent from two listings — and the coordinator wrote that it
had ended "before its answer reached me". The answer arrived shortly afterwards
under a new name, from the same agent with the same context. **Both signals were
correct about the socket and wrong about the person.**

- **The stable handle is the room name.** `Rook` and `Kenya` survived three
  session names apiece across two days; `obsrv-a2` lasted an hour. Record the
  room name on cards and in commits, never the session id.
- **If a direct message is refused, assume a resume before assuming an ending.**
  Try the room.
- **To confirm continuity, ask something only the prior context would know.** A
  session claiming to be someone is cheap; recalling the argument it made two
  hours ago is not.
- **Do not quote a listing from memory.** The session that disputed this quoted
  its own name from a listing taken earlier that morning and was wrong about its
  current one. Re-run the call.

And the reverse, which is the failure this rule exists to stop: **do not conclude
work is abandoned because a name stopped answering.** Cards held by an absent
session have twice been released and had to be restored.

## A verdict is not advice, and a relayed one is not a verdict

**A QA gatekeeper reviews the changes that can hurt someone, and the merger cannot merge over a FAIL.**
Opeyemi named the role and confirmed the binding half on 2026-09-18. Before that it was the merger's
own voluntary practice, which is a different thing and was said to be a different thing at the time.

**What is gated:**
- anything that changes product behaviour — `src/`, `bin/`, packaging;
- a board PR that **moves a card to Done**, because acceptance verification by someone other than the
  author is the whole job, and a board-only change is sometimes exactly the thing under verification;
- a test-only PR that **removes anything the suite's sight depends on** — an assertion, a setup step
  an assertion needs, a fixture, an arrange or a wait — **or loosens one, or adds a skip, retry or
  tolerance**. Those change what the suite can see, which is a product-visibility change wearing a
  test path. Pure additions are not gated, so batches of new tests do not queue.

  **"Assertion" alone was too narrow, and #354 is why it was widened** (Idris flagged the gap while
  passing it). That PR deleted a *setup* line, not an `expect`, so on the old wording it fell outside
  the gate — while the actual question, "does this silently drop coverage", was exactly the one that
  needed asking, on a file where the author had already got a claim wrong once that day. The review
  found the line genuinely dead by reading the rest of the test. **The point is that the finding was
  not available until someone looked**, which is the only thing a gate is for. Read the list as
  examples of that question, not as the set of words that trigger it: when you cannot tell, it is
  gated.

**What is not:** docs, board changes that are not a Done move, and new tests that only add.

**How a verdict works:**
- **it names the head SHA it judged**, and a push to that branch voids it. There is no file-type
  carve-out: a board-only push can be the thing under review. What should be cheap is the looking, not
  the rule;
- **a PASS says what it did not check.** A bare PASS fits "checked and fine" and "could not check"
  equally, and anything needing the desk or a grant the reviewer does not have belongs in that list;
- **the merger cannot merge over a FAIL.** Disputes go to Opeyemi. He can waive the gate for a named
  PR — he has — but a waiver is for that PR and does not generalise to the next one.

**A verdict relayed by a third party is not a verdict.** Read the reviewer's own words before acting.
This is not about anyone lying: on 2026-09-17 a faithful relay added a condition its author had not
written, and a peer confirming a failure "independently" confirmed one that had not happened. Both
were in good faith, and both produced a verdict-shaped sentence that was not the verdict. The same
guard catches a mistaken paraphrase and a false claim of authority, which is why it is worth keeping
for the first reason even if you never expect the second.

## Work parked on somebody's word is still somebody's work

**If a card is waiting on a person, hand it over rather than let it be rebuilt.**

That sentence is Rook's, from the day two of its cards were read as abandoned within an hour.
One sat in `doing` with nothing delivered because the card itself said to agree timing with the
person whose desktop the run would drive. The other was a pushed branch with no pull request,
because opening one waits on the same word every merge does. Both were compliance, read as
absence — and the instruction being obeyed had been written by the person who misread it.

**The cost of getting this wrong is not a stalled card. It is two sessions doing the same work**,
one of them from scratch, and neither knowing the other started. A card released and re-taken
silently tells the next reader nothing about why either happened, so when a release is reversed,
say so on the card.

The corollary for whoever is coordinating: **a session that goes quiet after being told to wait
is doing what it was told.** Ask it before concluding anything, because the question costs one
message and the wrong answer costs a day of duplicated work.

## Work in your own worktree

**Never edit the shared checkout if anyone else might be in it.**

```bash
git worktree add /tmp/obsrv-<yourname> -b <your-branch>
```

On 2026-09-14 three sessions were in one checkout at once, one of them
mid-edit. Another saw its branch change underneath it — someone else had
merged and checked out `main` in that tree. A `git checkout -- .` from one
session has dropped another's uncommitted work before.

**The git stash stack is shared across all worktrees.** A bare `git stash pop`
in yours can take someone else's work. Make a WIP commit instead, or
`git stash push -u -m` with a unique tag and apply it by sha.

## Build before you test

```bash
npm run build
```

**`npx playwright test` runs the built `out/`, not `src/`.** So do the MCP
tools. Changing source and running the suite tests the *previous* build, and
the failure that produces looks exactly like a real one.

This caught two different sessions in one evening. One built an instrument,
ran the suite, and saw the very test it was investigating fail — a real bug,
falsely reproduced, on the first attempt, with a plausible message. The other
merged a branch adding a method, ran the suite, got `move is not a function`,
and nearly reported the merge broken. The build was a day older than the
source.

If a failure surprises you, check the build before you check the code.

## Verify by watching it fail

This is the one rule that matters most here.

**A check nobody has watched refuse is a claim, not a check.** Before trusting
a guard, an assertion or a new test, break the thing it guards on purpose and
watch it go red. Then put it back.

Real instances from a single week:

- A staleness check passed on a deliberately planted stale row — because the
  run was filtered and the check had no rows to compare. A pass fits *checked
  and fine* and *had nothing to check*.
- A spec asserting the right tab returns after a restart passed against a
  deliberately broken save, because the tab under test was at position 0,
  where the stored index is accidentally correct whatever the code does.
- A test asserted `unsettledReason: 'resizing'`, a label decided by a race.
  It passed on a fast laptop and failed 8 of 10 runs on a slow CI runner.
  Assert the *state*; record the label.
- A guard written to stop CI runs being cancelled cancelled three of them.
  `cancel-in-progress: false` protects a run that is *in progress*, not one
  still *pending*.

A corollary for numbers: a query returning zero is not evidence of absence
until you have watched the same query return non-zero on something you know is
there. `grep` is line-based and this repo's prose is hard-wrapped, so a
multi-word phrase check on a doc is a coin flip.

### A check that looked at nothing passes

Sharper than the corollary above, because it is not about zero — it is about a
check whose *subject* is missing. It does not fail. It passes.

Four of these landed in two days, from three different sessions:

- A before/after comparison of a log file reported `0 -> 0 lines, sha "" -> ""`.
  The filename was wrong — `main.log`, when it is `obsrv.log` — so the clean
  result meant *the file I am watching does not exist*. It was produced on the
  card about log lines that cannot name their writer.
- `gh run list --commit <short-sha>` returned no rows while four runs existed,
  so a hundred-second watch concluded the workflows had never triggered.
- `grep -c` exited 1 on a count of zero and killed an `&&` chain, and the exit
  code read afterwards belonged to `grep`.
- A zsh glob that matched nothing killed a 160-run loop, which then reported
  "0 failures" having never executed.

One sentence covers all four: **a check that cannot distinguish "nothing
happened" from "I looked at nothing" is not a check.** One had a filename, one
had a SHA, one had an exit code, one had a glob.

The practice that catches it is cheap and is the same one as watching a guard
refuse. Before quoting a clean result, make the check report something
non-empty about the thing it is watching — a line count, a SHA, a row — and
read that number. The non-empty reading is the evidence. The clean one is only
meaningful once you have seen the check has something to look at.

### When you report what passed, name what you did not run

The most respectable form of this defect is a green number.

`main` was red for fifty minutes and twelve consecutive CI runs because a branch
changed the format of a log line and was merged on *"1181/1181 unit, typecheck
clean"*. Both figures were true. Neither had anything to say about the change,
because the only thing that exercises the log's format end to end is the e2e
suite — which nobody ran, including the person who changed the format and the
person who merged it.

**A reader cannot tell a suite that was green from one that was never started.**
So the report has to say. "Unit and typecheck green; e2e not run" is a different
sentence from "unit and typecheck green", and only one of them is honest about
what is still unknown.

The rule that follows, and it is thirty seconds: **run the suite that covers what
you touched before you report a number.** A file named after the thing you
changed — `log.spec.ts` for a change to the log — is not a subtle hint.

### A log can tell the truth in a form that reads as a different truth

The traps above are commands misreporting their own status. This one is not: the
artefact is honest and the *reading* fails, which makes it harder to catch and
means the fix is different.

In `gh run view --log-failed`:

- **A spec is mentioned without being asserted about.** `browser-identity.spec.ts`
  appeared five times in two different failure logs with zero failures in either.
  Grepping the log for spec names once produced the same wrong file for seven
  consecutive runs.
- **A ✘ marks a flaky first attempt exactly as it marks a real failure.** CI runs
  `--retries=1`, so a test that fails then passes prints both. Two tests read as
  failures that way in one investigation.

Neither is fixed by reading more carefully. **Count ✓ against ✘ per test**, and
treat "never printed a ✓" as the definition of failed:

```bash
for t in log.spec.ts:39 mcp.spec.ts:137; do
  echo "$t ✘=$(grep -c "✘.*$t" run.log) ✓=$(grep -c "✓.*$t" run.log)"
done
```

Then read Playwright's own tally — `3 failed, 2 flaky, 521 passed` — and check
your count against it before believing either.

### Write down what would make the run meaningless, before running it

The practice above catches a check with no subject after the fact. This one
catches it in advance, and it is the only thing on this page that has been seen
to work on a measurement nobody would otherwise have doubted.

**Before an experiment, state the result that would mean *this did not measure
what I think it measured* — and make the run report that instead of a number.**

It was written down before a cache experiment and then earned itself twice in
one run:

- Both warm arms came back at 4 KB and 12 KB of profile, because the CLI
  deletes its profile after every invocation. The arms were vacuous. Without
  the pre-registered check, two clean zeros would have read as *the cache does
  not matter* and a cap would have shipped on nothing.
- A first pass used a 1 MiB cap and produced 1032 KB, read as pinned at the
  ceiling. The 256 MiB control produced 948 KB from the same work — so neither
  arm was bound by its cap and the "result" was noise, in the direction the
  author wanted. At 128 KiB it is 140 KB against 948, which is the real
  evidence.

The second one generalises past caches: **a test whose control is not bound by
the thing under test can only produce a coincidence.** Before believing that a
limit, a threshold or a flag did something, check that the control was free to
differ — and by how much.

Both failures were found by the person who built the experiment, which is the
only reason they were found at all. Neither would have shown up as a failing
test.

## Three commands that lie about themselves

Each of these cost this project time, and all three have the same shape: the
command does its job, prints a well-formed answer, and misreports something
somewhere nobody is looking.

**`grep -c` exits 1 when the count is zero.**

```bash
echo hello | grep -c nomatch   # prints 0, exits 1
```

So `grep -c ... && next-thing` silently does not run `next-thing`, and any
exit code you read afterwards belongs to `grep`. This produced a reported
`check=1` that was grep's status rather than the check's, noticed only because
the number was implausible. A zsh glob that matches nothing does the same to an
`&&` chain — one killed a 160-run loop that then reported "0 failures" having
never executed.

Do not chain on a counting command. Capture the count, then test it.

**`gh` reports `mergeable: UNKNOWN` for a MERGED pull request.**

It is not a value that is still settling — it is the value a merged PR has
permanently. A wait keyed on mergeability therefore hangs forever *on success*,
which is the worst direction for a wait to fail. One session spent an hour
polling two pull requests that had merged before the poll was ten minutes old.

Terminate on `state` or `mergedAt`, never on `mergeable`. And note the
consequence for measurement: how often a PR was conflicting cannot be
reconstructed after it merges, so it has to be recorded as it happens.

**`gh run list --commit` returns nothing for an abbreviated SHA.**

```bash
gh run list --commit fbc273c                 # 0 rows, exit 0 — while four runs exist
gh run list --commit $(git rev-parse HEAD)   # 4 rows
```

No error, no warning, exit 0. It is not a prefix match, and the empty result is
indistinguishable from *this commit has no runs* — which is the exact question
people use it to ask. One session watched a push for a hundred seconds this way
and was about to report that the workflows had never triggered. All four had,
and the first was green before the watch started.

Pass `git rev-parse HEAD`, never the short form you read out of `git log`.

Inside a workflow this is safe by construction — `github.sha` and `$GITHUB_SHA`
are full-length — which is why `ci.yml`'s release gate and `suite-answer.yml`
are unaffected. It bites in a terminal, where the short SHA is the one already
in front of you.

## Testing

```bash
npm run typecheck     # three tsconfigs — this is what CI runs
npm test              # unit
npm run test:e2e      # builds, then drives the real Electron app
```

Only one suite may run at a time per worktree; a second is refused, and the
refusal says whether it found a live suite or a lock left by one that died.
`OBSRV_SUITE_NO_LOCK=1` exists for the nested case only.

**The suite leaves your desk alone.** Under the harness the app shows its window
without activating it, so a run started while you work in another app leaves
that app in front (`bug-e2e-takes-the-desk`). The tests whose job needs a front
app, `focusWindow` and `overlay-focus.spec` (which launches with
`OBSRV_TEST_TAKES_THE_DESK=1`), run on CI and locally only with
`OBSRV_E2E_FRONT=1`. A new test must not call `win.show()`, `win.focus()` or
`app.focus()` on the app under test; use `win.showInactive()`, or gate it the
same way and say so in its name.

**An ordinary local `npm run test:e2e` already leaves your desk alone.** The
specs that boot Electron through the CLI (`cli*.spec.ts`) and
`throttle-refused.spec.ts` belong on CI, and a local run excludes them unless
you ask for them with `npm run test:e2e:cli` (`OBSRV_E2E_CLI=1`). CI runs
everything, as before. Until 2026-09-17 that rule was
written down nowhere and everyone applied it with a pattern of their own; one
sweep used `/cli-/`, which is the pattern anyone would write, and about fourteen
`cli.spec.ts` tests ran on the machine someone was working at. **Sixteen files
in that family are `cli-*` and exactly one is `cli.spec.ts`**, so the glob that
is right is `cli*` and the difference is one character. The exclusion lives in
`playwright.config.ts` and is the **default**, not a flag you remember: it began
as an opt-out and became an opt-in once Opeyemi authorised the change, because
an opt-out only protects the people who would have written the pattern right
anyway. `testIgnore` matches file paths — `--grep` matches test titles, which is what makes a hand-written
pattern a guess about what it is matching. `deskSafeCoversTheCliFamily.test.ts`
reads `tests/e2e/` and fails if a spec starting with `cli` is not covered, so a
new one cannot fall outside the rule quietly.

**The server checks its own replies under test.** Every MCP tool compares the
keys it emits against the keys its own output schema declares, nested ones
included, and fails the call on a key that is not declared — naming the tool
and the full path. It runs under `OBSRV_TEST=1`, and under
`OBSRV_STRICT_OUTPUT=1` for the specs that drive a live app, which cannot set
`OBSRV_TEST` because that refuses to launch one. Users never see it: strict in
production would turn a slipped key into an error for every client, including
the many that do not validate and work today.

It exists because the client-side check cannot be relied on — the SDK validates
only when it has cached the schema through `listTools()`, and a failing test
replaces the Playwright worker, leaving every test after it unvalidated. Three
undeclared keys shipped that way in one week. If you add a field to a reply,
add it to the tool's output shape in the same commit or the suite will tell you.
`OBSRV_TEST_UNDECLARED_KEY=<tool>` injects one deliberately, which is how the
suite proves the check is running rather than merely green.

**A test that matches a product sentence must get the matcher from the code
that produces it, never a copy of the words.** Rewording a warning is a minor
(`docs/compatibility.md`), and a copied matcher fails by matching *nothing* — the
filter comes back empty, the assertion passes, and the test is vacuous without
saying so. Two shapes are in the tree, and which fits depends on the sentence:
export a predicate built from the same constants the producer uses
(`isFrameIdentityWarning` in `src/main/frameCheck.ts`), or derive the invariant
part in the spec by calling the producer with sample inputs and keeping what
they share (`pageMovedNote`'s opening in the live specs). Prefer the second when
the sentence is mostly interpolated or when the producer would otherwise gain an
export only tests use. There is deliberately no shared helper: the producers
differ in shape, and a generic matcher would have to guess which half is fixed —
a guess that would be invisible at the call site and would fail the same silent
way the copied prose did.

**A check's own coverage needs a reader who didn't write it.** That check shipped
twice with a hole its author could not see: fenced on `OBSRV_TEST` alone it was
switched off across the entire live surface, where two of the three keys it was
written for had lived (16 poisoned `obsrv_drive` tests passed); and its e2e arms
poison one tool by name, so a tool dropping out of the published list was
silently unchecked and every arm stayed green. Both were found by someone else
reading it. When you add a check, say plainly which runs it does **not** cover
and ask for a cold read of that, not of the code.

**An instrument that cannot show you it is working is indistinguishable from a
product that is quiet.** Both look like nothing. Print the line that must always
be there — the healthy sample, the control case — beside the line you care
about, so an absence can be read as an absence. **A number you cannot account
for is a number to check, and a plausible number needs its baseline more than an
implausible one does:** an implausible one prompts the check by itself.
`chore-flaky-leaders-0917` has three worked examples, two of them measurements
that lied until their baseline went missing — a DOM read where the code used
React state, and a logging wrapper `contextBridge` had silently frozen.

`-g` filtering is not safe everywhere. Some spec files establish shared state
in their first test, and a filtered run skips it — you will get a message
saying so rather than a crash, but the run is not the same conditions as a
full-file one.

## Isolating a run from your own machine

**Setting `HOME` does not sandbox an Electron app on macOS.** `os.homedir()`
follows it; every `app.getPath()` ignores it and resolves into your real
profile. So a run that believes it is sandboxed writes to your real data *and*
produces a clean-looking result — the failure and the success are identical
from outside.

```
--user-data-dir=<p>     moves userData, sessionData, crashDumps
CFFIXED_USER_HOME=<p>   moves home, userData, appData, logs, cache
```

Neither moves `app.getPath('temp')`. Before trusting any sandbox, prove the
app *wrote* inside it — "I set the variable" is a claim about the harness, not
about the app.

For testing a branch through the dev lane without a release, see
[*The dev lane* in the README](README.md#the-dev-lane) and `npm run lane -- --status`.

## Writing it down

Obsrv's output is sentences, and the sentences are the product. Two things
follow:

**A sentence must name its own subject** and key off a fact it measured, not
off a neighbouring sentence. Two notes in one reply have contradicted each
other — *"the page never moved"* directly above *"the page grew as it was
walked"* — because the second inferred what the first had measured.

**Name the two facts a silence would be produced by.** If they are opposite
facts, the silence is a defect rather than a quiet success. A tool that says
nothing when all is well and nothing when it cannot see is not reassuring.

**Have someone who did not write it read it cold.** Whoever wrote a sentence
reads what they meant. Print every shape the output can take, read the joins
between them, and have a peer read them before calling a sentence done.

**The README on `main` is not what a stranger runs.** GitHub shows `main`'s
README; npm serves the last release. So a README sentence describing behaviour
that is only on `main` is wrong for whoever reads it first, and stays wrong
until the next publish — four days, the time it took to notice
(`chore-readme-documents-unreleased`: the README said `--version` needed
neither a build nor Electron while npm's `latest` answered *"unknown command:
--version"* after a 120 MB download). When a change makes a README sentence
true, the sentence lands with the release, not with the change — or it says
which version it starts in. **The same holds for anything else a reader meets
before the code:** the skill, the tool descriptions an agent lists, and the
help text a package prints.

Commit messages here are long on purpose. They carry what a card cannot: a
card can be edited by anyone, a commit travels with the change. If you find
something while fixing something else, put it in the message.

**Cite the tree, or quote the claim.** Memory notes are not documents: no
checkout contains them, so a card citing one points every reader at nothing.
Because the sessions working here could all see this one, it also read as
common knowledge: `docs/read-the-output-not-the-code` was cited on eight cards
before anyone followed the address. A path in a card should be one
`git cat-file -e origin/main:<path>` finds. A branch is an address only until
it is merged and deleted; after that, the merge commit is.
