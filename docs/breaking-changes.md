# Breaking changes

Every change that can make working code stop working, in one place, newest
first. A release's notes say it too — this is where it stays findable
afterwards, because a GitHub release page is not somewhere anyone goes looking
six months later.

**What counts as breaking here:** a field that disappears or is renamed, a
value that moves to a different key, a new value in an enum a caller may have
cached, or a field whose *meaning* changes while its name stays the same. The
last two are the ones that do not announce themselves — nothing fails to
compile, and the first sign is an answer that reads wrong.

**Obsrv is pre-1.0.** These will keep happening; the promise is that they are
named, not that they stop.

[**`compatibility.md`**](compatibility.md) is the rule this register is kept
by: what may change in a minor, what may not, and how a break is announced. It
also carries the constraint that decides most of them — on the MCP surface,
**adding** a field is breaking, because every output schema is
`additionalProperties: false`.

---

## 0.61.0 — *unreleased*

> Three at once, all found by the surface-parity sweep (C4) rather than by a
> user. Each corrects a case where the two surfaces answered differently, so
> the break is the fix: code written against one surface's spelling was
> already wrong on the other.

> ### Restart your MCP session after upgrading to 0.61.0
>
> Not optional for this release, and the reason is worth reading once because
> it applies to every future one. MCP tool output schemas are
> `additionalProperties: false`. A client that listed the tools **before** the
> upgrade is holding the old shape, and this release both adds fields and adds
> an enum value — so that client can reject a reply that is entirely correct.
>
> **What it looks like when it bites:** a validation error on a capture or a
> measurement that worked yesterday, naming a field or a value rather than a
> page. It reads as a bug in Obsrv. It is a stale schema, and a new session
> fixes it.
>
> In Claude Code: start a new conversation, or reconnect the MCP server.

### `snap` live: `presetId` and `profileId` are gone — use `preset` and `profile`

A live `obsrv_snap` answered under `presetId` / `profileId`; a headless one
answered the same facts under `preset` / `profile`. Every other tool in the
set already used `preset` / `profile`, so `snap` was the outlier, and with
`mode: auto` a caller could not know in advance which spelling it would get.

**What breaks:** reading `presetId` or `profileId` from a live snap now gives
`undefined`.

**What to do:** read `preset` and `profile`. They are populated on both
surfaces. If you support both old and new, `reply.preset ?? reply.presetId`
covers the transition.

### The live walk's sentences move from `notes` to `warnings`

Sentences about the **page** — the walk covered a panel rather than the page,
the walk reached only the first screenful, the page grew as it was walked —
were being returned under `notes` on the live surface while the same tools put
landing, status and shadow-share sentences under `warnings`.

The rule now, which is worth knowing because it decides where anything new
will go: **`warnings` is about the page, `notes` is about the call.** A launch,
a cut navigation or an ignored `preset` is about the call and stays in `notes`.

**What breaks:** a live caller reading walk sentences out of `notes` finds them
gone. Nothing is lost; it moved.

**What to do:** read `warnings` for anything about the page. If you scan both
and concatenate, no change is needed.

### `unsettledReason` can now be `"resizing"`

The live surface can be mid-resize when the capture budget runs out — the pane
was still changing size, so the page had not finished reflowing to the screen
it is being measured on. That is a real state and it is only reachable live;
it used to be reported as `timeout`, which said the wrong thing.

**What breaks, and it is the least obvious of the three:** a client session
that listed the tools **before** upgrading is holding the old enum, and can
reject a live capture that answers `"resizing"` — see the restart note at the
top of this release.

**Why it ships anyway**, since a new enum value is the kind of change a project
can always defer: the alternative is to keep reporting this state as
`timeout`, which is what it did until now and is a false answer — the budget
did not run out on a page that would not settle, the pane had not finished
resizing. Folding it back in would reintroduce exactly the one-name-two-answers
problem the rest of this release exists to remove. Decided 2026-09-14 rather
than arrived at — and **observed the same day**: a capture taken while the
target pane was cycled through eight distinct viewports answered `"resizing"`,
three runs of three, pinned by `tests/e2e/live-drive.spec.ts`.

The eight matters, and is the reason this paragraph is longer than the decision
needs. `settleTarget` ends on two *equal* consecutive 80 ms viewport reads
inside a 4 s budget, so flipping between **two** presets gives each pair of
reads a coin-flip chance of agreeing and comes back `animating` almost at once
— measured, 30,000 flips deep. That result looks like proof the value is
unreachable and is proof of nothing. Anyone re-testing this, or deciding later
that a value nothing produces should come out of the enum, wants the
eight-viewport cycle rather than the obvious flip.

**What to do:** restart the session after upgrading.

### The CLI's own JSON gains `url` — a third contract, not just the MCP replies

`obsrv snap` prints JSON to stdout, and that key set is a contract: the suite
asserts it exactly (`Object.keys(json).sort()` against a literal list), which
is how this change was caught rather than shipped. Until now the headless snap
reply had no field saying which page the PNG was of.

**What breaks:** anything that asserts the exact key set, as the project's own
test did. A consumer reading named fields is unaffected — the change is
additive.

**What to do:** nothing, unless you compare key sets. If you do, add `url`.

**Why it is listed here** even though it is additive: the key set being pinned
in a test is the evidence that it is treated as a contract, and a register that
only covered the MCP surfaces would have said 0.61.0 left the CLI alone. It
did not.

### Also in 0.61.0, not breaking

`blocked` and `panel` now survive the trip from the page to the live walk, so
the live surface names what held a page instead of listing three things it
might have been; live `inspect` gains the landing and status sentences that
`audit` and `lint` already had; and both surfaces answer `deviceScaleFactor`. Those are additions to fields already
declared, and the restart note above covers them too.

---

## 0.56.0 – 0.58.0, and 0.60.0 — checked, and nothing found to name

Applied retroactively 2026-09-15 under [`compatibility.md`](compatibility.md);
working in [`docs/research/2026-09-15-c2-retroactive.md`](research/2026-09-15-c2-retroactive.md),
with the decision rules written down before any diff was read.

**This entry exists because "checked and clean" and "never checked" are
different facts and an absent entry does not distinguish them.** Four of these
five releases were silent here until today, and the silence said nothing about
which they were.

What was verified per release, not argued: the CLI's stdout key set (asserted
exactly by the suite, unchanged at nine keys), the top level of every MCP
output shape (unchanged), the control server's command list (unchanged, thirty),
and the CLI's exit codes (unchanged). What shipped in those releases was
sentences, a page's HTTP status reaching the answer, and one threshold gaining a
companion count in 0.58.0 — all of which the policy permits in a minor without
an entry.

**Two limits of that check, stated because they bound what this entry claims.**
Whether a field was added *deeper* than the top level of a schema is
**unchecked**: the instrument written for it produced the same answer at every
release including one with a known change, so it was discarded rather than
believed. And a command's *behaviour* changing while its name and reply shape
stay put is not visible to any of these checks — the same blindness that makes
a meaning change "the worst of them" in the policy.

**And the policy is younger than the releases it was applied to.** None of
`compatibility.md`, `breaking-changes.md` or `thresholds.md` is present in the
tree at *any* of the five tags — the releases are 2026-09-12 and -13, the
documents 2026-09-14 and -15. So the rule about a
documented threshold moving with `thresholds.md` could not be broken by 0.58.0,
and the requirement to announce in the release notes cannot be met backwards at
all. Retroactive application produces a record, not an announcement. The
research page says what that implies for the policy text.

---

## 0.59.0 — `url` means the address you asked for

`url` meant two different things depending on which surface answered: the
address requested, or the address the page ended on after a redirect. It now
means **the address the call asked for**, on both surfaces, for the measuring
tools.

**What breaks:** a live caller reading `url` expecting the landing address now
gets the address it asked for.

**What to do:** the landing is named in the note text — *"the load of …/private
ended at …/login"* — and `obsrv_drive`'s status reports the current page as a
field. `obsrv_snap` is the deliberate exception and still means the page
captured, because a capture is of the landing by definition.

---

## How to find out you are affected

There is no deprecation window and no runtime warning for a renamed field —
pre-1.0, the rename is the change. The cheap check after upgrading:

```bash
obsrv audit https://example.com --preset laptop-768 > after.json
```

and diff the keys against a reply you kept from before. The
[thresholds](thresholds.md) and [limitations](limitations.md) pages cover what
the numbers mean; this page covers only what moved.
