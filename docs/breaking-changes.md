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

### `obsrv_inspect`'s readout gains `colorPainted` — declared at last, and it was already being sent

`InspectReadout` has carried `colorPainted` since `f8d734f` — the colour the
screen actually shows, after the text's own alpha and the element's effective
opacity, composited onto the background. It is the colour the contrast figures
describe. **The MCP output schema never listed it**, and `readoutShape` is
`additionalProperties: false` in the JSON Schema the server publishes.

**What breaks:** a client session that listed the tools **before** this
release rejects an `obsrv_inspect` reply outright — `-32602`, *structured
content does not match the tool's output schema* — rather than reading an
extra key it does not know. See the restart note at the top of this release.

**What was already broken, which is why this is a fix and not only a break.**
Adding the field to the schema is the breaking half; the field has been on the
wire since `f8d734f` and **every validating client has been rejecting those
replies ever since**. `tests/e2e/mcp.spec.ts:137` failed its first attempt in
nine of nine observed runs and passed on retry each time, so the suite called
it flaky and nobody read the error. An agent in the field got a protocol error
instead of a measurement.

**Why the server never noticed.** It does validate its own reply — SDK 1.30.0
runs `safeParseAsync` against the zod output shape — but `readoutShape` is a
plain `z.object`, and zod's default **strips** unknown keys rather than
failing, so the server's check passed while the JSON Schema it published to
clients said `additionalProperties: false`. Two validators, one schema,
opposite answers. The rejection is always the client's.

**What to do:** restart the session after upgrading. Nothing else changes —
the field was already in the replies your client was refusing.

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

### `warnings[]` entries from `snap`, `diff` and `report` no longer begin with `warning: ` — breaking but sanctioned

Every warning `snap` put in its list, and every warning `report` and `diff`
carried forward from a render, began with the literal `warning: ` — the label
a stderr line earns and a list entry does not. The list now holds the fact
bare — `full page is 10374 CSS px tall; clamped to 4096` — and only the
stderr line carries `warning: `. `audit`, `lint` and `inspect` already did
this; they are unchanged.

**Not every entry began that way, and that is the sharper fact.** The
messages a capture raises while a page is still painting — *page kept
painting steadily…*, the blank-page warning — never carried the label, so one
`snap` could hold both forms in the same array. The list never had one shape.
This is the first release in which it does.

**Breaking, and sanctioned.** [`compatibility.md`](compatibility.md) says
what may change in a minor: *change the wording of any warning or note. The
sentences are the product and they get better; they are not a parsing target.
Match on structured fields, never on prose.* A caller grepping `warning: ` out
of `warnings[]` was told not to. If your code did, it was already wrong on the
entries that never had the label; now it is wrong on all of them, which is at
least consistent. Read the array; every entry is a warning.

**Two sentences that were not in the list are now in it.** When a full-page
capture hides chrome stuck to the viewport for the bands after the first — the
sticky header shown once rather than repeated — the sentence saying so, and
naming the elements and their heights, went to stderr only. It now joins
`warnings[]`, so a `report`'s HTML and every MCP reply can say that the image
its findings are pinned to was edited (`bug-report-edit-invisible`). That is
an addition to the *contents* of a declared array, which is not a schema
change.

**Also corrected, wording only:** the sentence `diff` gives when the renders
never went paint-quiet used to say *the band deltas below are noise*, reaching
only downward while `inkCoverage.delta` and `rows.ratio` stood above it
unqualified. It now names those two fields. And the report's HTML no longer
paints an unsettled ink delta red (`bug-diff-disowns-its-numbers`).

### `obsrv_drive` gains `visionType`, `visionSeverity` and `deviceScaleFactor`

`drive` answers with the app's whole status. During this release, status gained
these three: the colour-vision simulation and the screen's density. The `drive`
schema never listed them, and it is `additionalProperties: false`, so **every
client that validates rejected every `drive` reply built from this tree**, not
only a client holding an old schema (`bug-drive-reply-fails-its-own-schema`).
They are declared now. No released version sent them: 0.60.0's status has none
of the three.

**What breaks:** a client session that listed the tools before upgrading holds
the old `drive` schema and rejects the three new keys.

**What to do:** restart the session after upgrading, as the note at the top of
this release says.

### Also in 0.61.0, not breaking

`blocked` and `panel` now survive the trip from the page to the live walk, so
the live surface names what held a page instead of listing three things it
might have been; live `inspect` gains the landing and status sentences that
`audit` and `lint` already had; and both surfaces answer `deviceScaleFactor`. Those are additions to fields already
declared, and the restart note above covers them too.

Right after a launch, the first control command now waits until the restored
tab's screen size is applied, at most 5 s, instead of answering at once. The
reply before that could name the restored preset beside the default 1920x1080
surface (`bug-drive-status-race-at-launch`). Timing only: no field changes.

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
