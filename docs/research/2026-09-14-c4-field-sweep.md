# C4: the two surfaces, compared field by field

**2026-09-14, obsrv-e7, against `6b59868` (0.60.0).** The criterion asks for
one fixture set driven through both surfaces and compared field by field
rather than note by note, with every difference either removed or listed as
intended. This is that pass. It is the first one: the 2026-09-13 sweep
compared notes, and found four divergences by reading sentences.

The harness is `tests/e2e/surface-parity.spec.ts`. It calls every tool that
offers `mode: 'headless' | 'live'` both ways against the same page, and
compares the two replies three ways: the set of key paths, the type at each
path, and the value at each scalar path that is not inherently per-run. Ten
pages, four tools, eighty calls, 1.9 minutes.

Note *text* is recorded and not compared. Which sentence a surface says is
C5's question. Which **field** carries it is this one's, and that turned out
to be where the defects were.

## The control, which took two tries

Live measures the screen in force and ignores `preset`; headless defaults to
`1080p-24`. So the spec drives the app to `1080p-24` before it starts, and
passes the same preset to every headless call. Without that, a page whose
panel only overflows at one width reads as a surface that went silent.

The first version of that control drove the app with
`{ preset: '1080p-24', orientation: 'landscape' }` and left the headless
calls at their default. It manufactured exactly the divergence it existed to
remove: live answered `pageHeight: 1920` where headless answered `1080`, on
six of ten pages, with both replies saying `preset: "1080p-24"`.

`orientation` is an input naming *which stored form of the screen* — as
listed, or rotated a quarter turn — and `1080p-24` is stored landscape-natural
at 1920×1080, so `orientation: 'landscape'` asks for the rotated form and
gets a 1080×1920 portrait viewport (`applyOrientation`,
`src/shared/calibration.ts:40`). Headless does the identical thing when asked
the identical question; the surfaces agree. The probe that established this
is in the transcript, not in the tree.

Two things survive that error and are worth keeping:

- A flag whose value `landscape` produces a portrait screen on every
  desktop preset is a footgun, and walking into it while specifically hunting
  parity defects is the evidence. It is a naming problem, not a parity one,
  and belongs on its own card.
- `orientation: "landscape"` and `screenShape: "portrait"` sit in one reply
  by design — one names the request, the other is computed from the numbers
  (`src/shared/calibration.ts:37,50`). That is the right split. It is also, exactly, the
  shape of the `url` divergence 0.59.0 closed, and the reason a reader needs
  both fields documented rather than one.

With orientation passed on neither side, `pageHeight` agrees on all ten
pages: 1080, 1080, 2264, 8048, 8840 and so on, headless and live alike.

## The eight tools

Four have two surfaces and were swept: **audit**, **lint**, **inspect**,
**snap**.

Four have one surface, and each has a written decision, so C4's "listed as
intended" is already satisfied for them — but they are single-surface in two
different ways, which is worth the distinction:

| tool | surface | why, and where it says so |
|---|---|---|
| `obsrv_diff` | headless only | *structurally* — there is no `diff` command in `CONTROL_COMMANDS` at all. "The comparison needs both rasters, which the visible app cannot show" (`docs/superpowers/specs/2026-08-22-obsrv-design.md:417`). The window holds one target at one density; live is not unbuilt, it is unbuildable in the window as the window exists. |
| `obsrv_report` | headless only | *structurally* — no control command either. "report is an artefact, not a show. It stays headless" (`docs/superpowers/specs/2026-09-07-live-first-agent-drive-design.md:27`), and the tool's own description says it in user-facing words. |
| `obsrv_drive` | live only | the tool *is* the live surface. |
| `obsrv_presets` | neither | a table; nothing is rendered. |

## What the sweep found

Six defects. Each is a case where the two surfaces answer the same question
differently and nothing says they should.

### 1. A locked page with no dialog role is silent live — **fixed**

`anon-panel-locked.html` — the document's overflow is hidden, the only
scroller is an anonymous panel, and the walk covered five screenfuls of that
panel while the page never moved.

- headless: *"the walk scrolled a panel on the page, not the page itself…"*
- live: **nothing at all**, in `notes` or in `warnings`.

The same page with `role="dialog"` added (`dialog-locked.html`) speaks on both
surfaces. This is the defect 0.60.0 fixed headless — the note keyed on the
measurement rather than the role — reaching only one surface. `panel` *is* computed in `src/preload/sync.ts`, *is* carried on
`ScrollReport`, and *is* forwarded by `controlServer.ts` — and never arrived,
because of the cause under defect 3. Fixed with it. Live now says the panel
sentence word for word with headless.

### 2. The same sentence arrives in a different array — **fixed**

On `dialog-locked` and `wall`, headless puts the walk's sentence in
`warnings` and live puts the identical string in `notes`. After the fixes
above it is three pages rather than two: giving `panel-locked` its live
sentence moved it from a silence into this. That is the right direction —
saying the thing in the wrong field beats not saying it — but it is worth
being plain that one of the six was converted rather than closed.

This is the field-level defect the criterion was written for, and it is
invisible to anyone reading sentences: the text matches word for word. A
caller that reads `warnings` sees a locked page headless and a clean page
live. A caller that reads `notes` sees the reverse. `mode: auto` chooses the
surface, so which array holds the warning is not something the caller can
predict.

Fixed by moving the live walk's sentences to `warnings`, which is where the
headless surface has always put them and — the part that settles it — where
the live path already put every *other* caveat: the app's own audit reply
returns the landing, status and shadow-share notes under `warnings`
(`ipc.ts`), and the coverage sentence was already going there too. Only the
walk's own sentences were in `notes`. The call's notes — a launch, a cut
navigation — stay in `notes`, because those are about the call rather than
about the figures.

### 3. The live walk names no wall, and uses the withdrawn coverage sentence — **fixed**

On `wall-over-a-tall-page.html`, where the measurement holds a 100% iframe:

- headless: *"an `<iframe>` covers 100% of the viewport and the page beneath
  it did not move — a consent wall, a paywall or an onboarding layer holds
  it"*, then *"the page measures 8048 CSS px (8 screenfuls); the walk reached
  the first 1080 px of it"*.
- live: the old three-item guess list — *"content in an iframe, in a shadow
  root, or in a container that scrolls by transform"* — then the sentence
  0.58.0 removed headless: *"a modal or a locked scroll held the page, or it
  grew after the walk"*.

**Root cause, and it was not the one first reported.** The control server's
reply list is not where the field was lost: it never got there. Every scroll
report crosses into main through `parseScrollReport`
(`src/shared/ipcPayloads.ts:729`), which is a **whitelist** — it rebuilds the
object from `id, x, y, scroller, warnings, atEnd, hidden?, dialog?` and drops
everything else. A field added to `ScrollReport`, measured by the preload and
forwarded by the control server still arrives as `undefined` until it is
named there, and downstream that is indistinguishable from a page where the
measurement came back false.

It dropped **`panel` as well as `blocked`**, which is why defect 1 has the
same cause and the same fix. The stale comment above the return — `hidden`
described as optional on one line, `hidden` and `dialog` on the next — is the
fingerprint of how: the list gets extended, the comment gets appended, the
next field is forgotten.

The fix is five files: the whitelist keeps `panel` and a validated `blocked`;
`ScrollReport` gains `blocked`; the preload sends it under the same condition
and with the same two measurements as `walkStep`; the control server forwards
it; and `WalkOutcome.blocked` carries it from the live walk into
`walkCoverageNote` at both live call sites, which is what stops the second
sentence hedging about a cause the first has just named. Verified by
printing: both sentences on `wall-over-a-tall-page` are now identical across
the two surfaces.

### 4. `obsrv_inspect` live says nothing about a redirect or a status — **fixed**

Both notes fire headless. Neither fires live, on either page:

- `…/redirect` → *"the load of …/redirect ended at …/landed"* headless, silent live.
- `…/missing` (404) → *"the server answered 404 Not Found for …"* headless, silent live.

`obsrv_audit` and `obsrv_lint` emit both notes on both surfaces, word for
word — the 0.60.0 work landed for them. Inspect was not carried across.

Fixed by giving the live inspect the same three sentences in the same order
the headless one uses, and by putting them where headless puts them: the
control `inspect` reply gained a `notes` array beside the readout, because
the readout's own notes are about the figures and these are about which page
the figures came from. They arrive even when nothing was found at the point
asked about — "nothing at (400, 300)" on a login page nobody asked for is the
case where the sentence matters most.

### 5. `snap` disagrees about whether the page settled — **fixed**

| page | headless | live |
|---|---|---|
| empty, moves, status-404 | `settled: false` + an `unsettledReason` | `settled: true`, no reason |
| redirect | `settled: true` | `settled: false` |

The cause is worse than a threshold and better than it looks: **the two
surfaces were answering different questions under one name.** Headless
`settled` means the page went paint-quiet. Live `settled` meant *the app
confirmed the navigation* — so a live capture of a page still painting came
back `settled: true` because the address had landed, and one that had
finished painting after a slow redirect came back false.

The measurement was already there. `captureVisible` and `captureTarget` both
await the real quiesce and return it (`settleFields`, `ipc.ts`), and
`liveCapture` in the MCP server already parsed `settled` and
`unsettledReason` off the reply — and then `liveSnap` overwrote the field
with its navigation flag and dropped the reason. Fixed by reporting the
capture's own verdict, renaming the navigation flag to `confirmed` (it keeps
the warning it always emitted), and adding `resizing` to the
`unsettledReason` enum, which is a reason only the live surface can have and
had nowhere to go. The field's description said the old thing and now says
the new one.

### 6. `snap` gives the same facts different names on each surface — **fixed, and one of them breaks callers**

| the fact | headless | live |
|---|---|---|
| the screen | `preset` | `presetId` |
| the panel profile | `profile` | `profileId` |
| the address | *(absent)* | `url` |
| raster density | `deviceScaleFactor` | *(absent)* |

A caller reading `presetId` gets `undefined` headless; a caller reading
`preset` gets `undefined` live. And a headless snap reply does not say what
it captured at all, which is the one field 0.59.0 spent a release
unifying everywhere else.

`obsrv_inspect` has a smaller version of the same: `deviceScaleFactor`
headless-only, `textScale` and `throttle` live-only.

Fixed by giving each fact one name. Live snap now answers under `preset` and
`profile` — the spelling every other tool already used, headless snap
included; snap live was the only surface in the product saying `presetId`.
Headless snap gained `url`, the page it captured, which it had never
reported at all. Both surfaces now carry `deviceScaleFactor`: the app knew
its density and was not asked, so `status` carries it now, and live inspect
gained it too.

**`presetId` and `profileId` are gone from the live snap reply, and that
breaks any caller reading them.** It is the right shape — one fact, one name
— but it is a breaking change and belongs in the release notes as one, which
is exactly what C2 asks for and what there is still no written policy (C1)
to govern.

`textScale` and `throttle` stay asymmetric on purpose: the CLI's rule is that
a key appears when the flag was given, and the app has no flags, only a state
it reports. Two honest reporting rules, now written down in the gate.

## Listed as intended

Everything else the sweep turned up, with the reason it is not a defect.

| field | which surface | why |
|---|---|---|
| `tabId`, `tabIndex` | live only, all four tools, every page | headless has no tabs. A live reply names the tab it measured; there is nothing for headless to name. |
| `mode`, `why` | both, always differ | they report the surface. Excluded from the comparison by construction — which is why they are the check that each call reached the surface it asked for. |
| `pngPath`, `*.ms` | both, always differ | per-run. |
| `snap`: `orientation`, `screenShape`, `viewMode`, `panes`, `loading`, `onionSkin`, `navigated`, `width`, `height` | live only | state of the visible app, which a headless render does not have. A window capture reports the window. |

## Where it stands

All six are closed, each verified by printing the two answers rather than by
reading the diff.

Distinct divergences over the ten pages: **36 before, 22 after**, and all 22
are in the table above — tabs a headless run does not have, window state a
headless render has no window for, and two reporting rules that differ
because a flag and a state are different things.

One of the fixes is a breaking change (`presetId` / `profileId`, §6) and one
changes which array a caller finds an existing sentence in (§2). Both are
behaviour a caller can be relying on today.

## What a gate would assert

It asserts now. The page tests report and the last test compares what they
found against an `EXPLAINED` table carrying a reason per entry; anything not
in it fails, naming the tool, the field and the two answers. The table is the
"written down" half of the criterion in the one form that cannot go stale
without going red.

It was checked the way anything that passes should be: by removing one entry
and confirming the run goes red naming that field. A gate nobody has seen
fail is indistinguishable from a gate that cannot.

Cost: 1.9 minutes of e2e. It would have caught four of the six on the day
they were introduced.
