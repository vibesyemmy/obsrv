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

## Next release — *unreleased*

### The measurement enters open shadow roots, and three sentences about not entering them retire

`querySelectorAll`, a tree walk, `parentElement` and `document.elementFromPoint`
all stop at a shadow boundary. So a page built from web components measured as
nothing, and a page with some components measured only its light DOM. They're
entered now (`feat-measure-open-shadow-roots`). **No field is added, removed or
renamed.** The published shape is unchanged, but several values change meaning
on a page that has components.

**What changes:**
- **`audit`** counts the targets and text inside open roots. `summary.targets.count`,
  `summary.text.count` and the findings grow on such a page: `half-in-shadow.html`
  goes from 12 targets to 52.
- **`lint`** reads text, edges and images inside open roots. Contrast and opacity
  are read through the component's own layers, not the page's.
- **`inspect` at a point** names the element drawn there, where it used to name the
  component's host. **`inspect` by selector does not change:** a CSS selector still
  doesn't pierce a root.
- **The walk and the full-page capture** find a scroller inside an open root, so
  `walked.screenfuls` can go from 0 to a count on an app shell built that way.
- **Three sentences retire:**
  - the share note, *"N shadow roots hold X of this page's Y interactive elements…"*;
  - the empty-page note's branch *"nothing to measure in the light DOM… built from
    web components, not empty…"*;
  - on a walk that entered the roots, the walk note's *"the page has N open shadow
    roots, which the walk does not enter"*.
- The walk note's opening now reads *"has no scrollable container in its light DOM or
  its open shadow roots"*.

**The caps count what is inside roots too.** `AUDIT_MAX_TARGETS`, `AUDIT_MAX_TEXT` and lint's
caps are unchanged, so a component-built page reaches them sooner, and `truncated` counts what went.
What a cap drops is no longer in document order either: an element's shadow tree is visited before
its own children.

**What breaks:** figures compared across versions on a component-built page grow,
and code that matched the retired sentences finds nothing.

**An app older than this change, driven by a newer MCP** still sends its walk's
shadow-host count. For that app the walk note keeps its older wording, because its
walk really did not enter the roots.

**The other direction loses one sentence's detail.** A 0.61.0 or older MCP driving
*this* app reads the walk's `blocked` only when it carries a shadow-host count, which
this app no longer sends. **That is the ordinary pairing** — the app is updated by hand
and the npm package by `npx`, so an updated app in front of an older server is the common
way round. The walk's "nothing to scroll" sentence then ends with the list rather than a
measured cause: *"content in an iframe, in a shadow root, or in a container that scrolls
by transform (a virtualised list or editor) was not brought into view before measuring"*,
where a current server would name the iframe coverage it measured. It is true and less
specific; upgrading the server restores the detail. Nothing else is affected, because the
app composes its own audit and lint sentences.

**Still out of reach:** closed shadow roots and iframes.

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

### Live `obsrv_snap` declares `onionSkin` and `loading`, which it has sent since 0.26.0 and 0.28.0

A live snap has answered with the app's onion-skin opacity since 0.26.0, and
with whether the tab was still loading since 0.28.0. `snapOutputShape`, which
is `additionalProperties: false`, never listed either, so **a client that
validates the published schema has rejected every live snap since then**
(`-32602`, additional properties; `bug-live-snap-reply-fails-its-own-schema`).
They are declared now, and the values are what they always were.

**What breaks:** nothing that worked. A validating client couldn't read a live
snap before, and one that doesn't validate sees the same keys as before. A
session that listed the tools before upgrading still holds the old schema and
still rejects them.

**What to do:** restart the session after upgrading.

### Live `obsrv_snap`'s `settled` now means what headless `settled` means: the page went paint-quiet

The same name answered two questions. Headless, `settled` has meant the page
went paint-quiet and every pixel painted. Live, it meant **the app confirmed
the navigation** — the address had landed — so a live capture of a page still
animating came back `settled: true`. A live snap now answers with the capture's
own paint-quiet verdict, which the app measured all along and this path threw
away, and passes `unsettledReason` through when it is `false`. Whether the
navigation was confirmed is a warning now, not this field.

*Added before release:* this entry was missing. The field's own description
said so ("before 0.61.0 the live answer reported that instead"), the register
did not, and a change of meaning under an unchanged name is the kind this
register exists for. Found by the 0.61.0 release sweep.

**What breaks:** a live caller that read `settled` as "the page arrived" can
now get `false` for a page that arrived and kept painting — a carousel, a
video, a spinner. The capture is still returned, and `unsettledReason` says
why.

**The meaning follows the server, not the app.** The app's captures have
returned their paint-quiet verdict since 0.34.0 (`4756ba9`), so a 0.61.0
server driving any app from 0.34.0 on, 0.60.0 included, answers the new
meaning. **Only with an app older than 0.34.0** is there no verdict to pass
through; then `settled` keeps the old meaning, and a warning says so: *this app
is older than the capture's settle verdict, so `settled` reports whether the
navigation was confirmed rather than whether the page went paint-quiet; update
the app for the paint-quiet answer.*

**What to do:** read `settled` as paint-quiet on both surfaces. For whether
the navigation was confirmed, read the warnings.

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

### `rotate` arrives; `orientation` is deprecated and keeps its meaning

`orientation` names the preset's **stored** form, so `'landscape'` means "the rotated one" — and on
every monitor and laptop preset, which are stored landscape-natural, it produces a **portrait**
screen. `1080p-24` with `orientation: 'landscape'` is 1080x1920. The word inverts its plain meaning
on half the preset table, and it has already cost a measurement: a session hunting surface-parity
defects on 2026-09-14 measured two different viewports without noticing and nearly filed it as a
parity bug.

**What is new:** `rotate: boolean` on every tool that takes `orientation` — `obsrv_snap`,
`obsrv_audit`, `obsrv_lint`, `obsrv_report`, `obsrv_inspect` and `obsrv_drive` — and `--rotate` on
the CLI. It says the thing itself: `rotate: true` turns the screen a quarter turn, whatever the
preset is stored as.

**What breaks:** two additions to the output. The first is a new key, and a new key on the MCP
surface is breaking because the schemas are `additionalProperties: false` — a session that listed
the tools before upgrading holds the old shape and can reject a correct reply. Restart the session
after upgrading (see the note at the top of this release).

- `rotated: boolean` on `obsrv_snap` and `obsrv_drive` — **the MCP surface only**. The CLI's snap
  JSON is unchanged by this release and still reports rotation as it always has, through the applied
  `cssWidth`/`cssHeight`. The MCP server derives `rotated` itself: live, from the app's own
  orientation flag; headless, from the resolved request the render was built from. It is not read out
  of the CLI's JSON, so the two surfaces answer it identically and neither depends on the other.
  (Adding the field to the CLI JSON is a separate, still-unscheduled change: that contract is pinned
  by an e2e spec, and moving it is its own decision rather than a side effect of this one.)
- a sentence in `warnings` **only where the word contradicted the screen it produced**. A phone asked
  for `landscape` gets a landscape screen and no sentence; a monitor asked for `landscape` gets a
  portrait one and is told so. This one **is** on the CLI too — it is a warning, not a new key.

**What does NOT break, and this is deliberate:** `orientation` keeps exactly the meaning it has
always had. Redefining it to mean "wider than tall" was the other candidate and was rejected — it
would have silently changed what every existing caller receives, with no error and a plausible
answer, which is the failure this release series exists to remove. A disagreeing pair
(`orientation: 'landscape'` with `rotate: false`) is **refused**, not resolved, for the same reason.

**What to do:** use `rotate`. `orientation` still works; removing it is a later release and not yet
scheduled.

### Nothing broke here — `docs/public-shape.json` appears, recording the shape as it already is

**Not a breaking change, and it is in the register on purpose.** This release
adds a snapshot of the published MCP output shape — every tool's key paths and
every enum's values — plus a unit test that fails when the two diverge and a CI
job that fails when the snapshot moves without this file being touched
(`board/c2.md`, criterion C2).

The snapshot was taken from the shape this release already has, so it records
**no** change of its own. It is written down because the check's first act was to
refuse the change that introduced it — the file moved and this register did not —
and the honest answer to that was an entry saying so, rather than an exemption
for newly added files. An exemption would also have excused someone deleting the
snapshot and adding it back, which is the case the check exists for.

**What it means for you: nothing.** No field, value or meaning changed. The next
entry after this one is the first the check will have been standing for.

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

### `obsrv_inspect`'s readout gains `colorPainted`

`InspectReadout` carries `colorPainted` from this release (`f8d734f`) — the
colour the screen actually shows, after the text's own alpha and the element's
effective opacity, composited onto the background. It is the colour the
contrast figures describe. It is declared in `readoutShape`, which is
`additionalProperties: false` in the JSON Schema the server publishes, and it
is **optional**: a live readout comes from the app, and an app older than the
field does not send it.

**What breaks:** a client session that listed the tools **before** this
release rejects an `obsrv_inspect` reply outright — `-32602`, *structured
content does not match the tool's output schema* — rather than reading an
extra key it does not know. See the restart note at the top of this release.

**No released version was already broken here.** `f8d734f` is in no tag, so
the window in which the key was sent and not declared was on `main` only.
There, `tests/e2e/mcp.spec.ts:137` failed its first attempt in nine of nine
observed runs and passed on retry each time, so the suite called it flaky and
nobody read the error.

**Why it is optional**, and why that was a fix too: it was first declared
required. The plugin moves the MCP server to a new version while `Obsrv.app`
is updated by hand, so a 0.61.0 server driving a 0.60.0 app would have answered
`-32602` on every live inspect that found an element, since the app's readout
has no `colorPainted` (#205, found by the release sweep).

*Corrected before release:* this entry first said the field had been on the
wire since `f8d734f` and that every validating client had been rejecting those
replies — true of `main`, not of any version anyone installed.

**Why the server never noticed.** It does validate its own reply — SDK 1.30.0
runs `safeParseAsync` against the zod output shape — but `readoutShape` is a
plain `z.object`, and zod's default **strips** unknown keys rather than
failing, so the server's check passed while the JSON Schema it published to
clients said `additionalProperties: false`. Two validators, one schema,
opposite answers. The rejection is always the client's.

**What to do:** restart the session after upgrading. Read `colorPainted` as
possibly absent: it is missing whenever the app answering is older than
0.61.0, and then `color` is the best you have.

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

### `obsrv_drive` declares `visionType` and `visionSeverity`, which it has sent since 0.17.0, and gains `deviceScaleFactor`

`drive` answers with the app's whole status, spread into its reply. Status has
carried the colour-vision simulation, `visionType` and `visionSeverity`, since
0.17.0 (`257e2db`); the screen's density, `deviceScaleFactor`, is new in this
release. The `drive` schema listed none of the three, and it is
`additionalProperties: false`, so **a client that validates the published
schema has rejected every `drive` reply since 0.17.0** — not only a client
holding an old schema (`bug-drive-reply-fails-its-own-schema`). It is the same
shape as `onionSkin` and `loading` on `snap`, above. All three are declared now;
`deviceScaleFactor` is optional, absent from an app older than the field.

*Corrected before release:* this entry first said no released version sent any
of the three, and that 0.60.0's status had none of them. 0.60.0's
`parseControlStatus` returns both vision keys, filling them in when an app
omits them, and `drive` spreads that status into every reply. Found by the
0.61.0 release sweep.

**What breaks:** a client session that listed the tools before upgrading holds
the old `drive` schema and rejects the three keys — two of which it was already
rejecting.

**What to do:** restart the session after upgrading, as the note at the top of
this release says.

### After a refused throttle, headless `throttle` says `"none"`, not the throttle asked for

`snap`, `inspect`, `audit`, `lint` and `report` given `--throttle` answered with
that throttle's id even when Chromium refused it, so `throttle: "slow-4g"` sat
beside a warning saying slow-4g was not applied, over a page that loaded
unthrottled. Every tool schema already described the field as "the conditions
applied", "the conditions the page loaded under". On `main` the app came to
answer that way first — `"none"`, with `applied: false` (#81, `8fff360`) — so
for a while the field meant one thing on one surface and another on the other
(`bug-throttle-field-means-two-things`). **No released app answered that way:**
0.60.0 logged a refused throttle and confirmed the one asked for, so its status
named a throttle that never applied. In 0.61.0 both surfaces answer with the
conditions in force.

*Corrected before release:* this entry first said the app already answered with
the conditions in force. That was true of `main`, not of any release; found by
the fact-check of the 0.61.0 notes.

Now the CLI does what the app does: a refused throttle puts back the conditions
the target had, and `throttle` names them. That's `"none"` on a fresh render. A
report states the throttle every screen had in force. In the one case where
screens disagree, it states the throttle asked for, each refused screen's
warnings say so, and the HTML says how many screens it held on. Presence doesn't change: the key still appears exactly when
`--throttle` was given.

**What breaks:** code that read `throttle` as "the flag I passed" sees `"none"`
after a refusal. Nothing changes when the throttle applies, and a refusal never
happened silently: the warning or note was already there.

**What to do:** read `throttle` as the conditions the page loaded under. To tell
a refusal apart, compare it with what you asked for, or look for the "not
applied" sentence in `warnings` (`notes` for `inspect`).

**Why it ships:** a field whose value disagrees with the warning beside it, with
its own schema, and with the same field on the other surface is wrong whichever
of the three you believe. `settledMs` beside it was always measured under the
conditions in force, so it now reads true too.

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
