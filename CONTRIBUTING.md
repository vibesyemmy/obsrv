# Contributing to Obsrv

This is not a style guide. It is the list of things that have actually cost
this project time — each one found by someone losing an hour to it, and each
one written down so the next person loses none.

Several sessions, human and agent, work on this repository at once. Most of
what follows exists because of that.

## The board

The work is [`board/`](board), one markdown file per card. **Claim a card by
editing its file**: set `owner:` and `column: doing`, then

and open a pull request with **only the card**. There is no separate tracker and
nobody to ask for access.

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
[`docs/dev-lane`](docs) and `npm run lane -- --status`.

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

Commit messages here are long on purpose. They carry what a card cannot: a
card can be edited by anyone, a commit travels with the change. If you find
something while fixing something else, put it in the message.
