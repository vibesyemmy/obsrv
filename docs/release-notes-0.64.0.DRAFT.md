# 0.64.0 — release notes draft, and the gate's state

Drafted by Henry, 2026-10-12, against `main` `9e434cd6` (as of 19:48Z). **Not a release.** Release notes live
in the GitHub Release body (`gh release view v0.63.1` is the shape); this file is the prose plus the facts a
cut needs, so it can be reviewed before anything is tagged. **This file is a draft and should not be
committed to `main` as-is** — it exists to be read, corrected, and then pasted into the release body.

Population: the **26** non-merge commits touching `src/` or `bin/` in `v0.63.1..main`
(`git rev-list --count --no-merges v0.63.1..main -- src bin`). npm `getobsrv` `latest` is **0.63.1**;
`package.json` on `main` is still `0.63.1`.

---

## Proposed title

**Obsrv 0.64.0 — a flow can type, a click aims at a real line, and `rotate` is the only way to turn a screen**

---

## Body draft

Two breaking changes, one new capability, and the close of one of the two class 1 defects 0.63.0 shipped
open.

### A flow can type

`obsrv_flow` steps can enter text. Replace-by-default clears the field first — and the first attempt at
that cleared nothing, because the select-all was a synthetic `Cmd/Ctrl+A` the page never acted on. A step
against an app too old to type now names that as the cause rather than failing on something else, and a
masked step's report says its **screenshot** is not redacted either, which is the half a reader would
otherwise assume.

### A click by selector aims at a line the element actually paints

0.63.1 made a selector click press a point the element really draws. This goes to the cause: the inspector
now reports the element's own **line boxes**, so a link whose text wraps is aimed at one of its lines rather
than at the union of both plus the gap between them. The probe tries the line boxes first and the fixed
points after — never instead — and a click below the fold now lands correctly under a text scale.

### `pageRect` is measured in the same instant as the box

`obsrv_inspect`'s `pageRect` was the element's box plus the app's **record** of the target's scroll, and that
record lagged a scroll the page made within 120 ms of an agent scroll. For that window `pageRect` described
a scroll position the page had already left. The page now reports its scroll in the same call as the box, so
there is no interval in which the two disagree.

### A page's own redirect is reported, even onto the address the bus is mirroring

This closes one of the two class 1 defects 0.63.0 and 0.63.1 shipped open: a page that redirected itself to
the address the pane already showed could go unreported, leaving a reply that looked exactly like a page
that never moved. A start is now answered once, a page's own redirect counts as an arrival even when it
lands where the bus is mirroring, and the commit record says which term stamped a commit as the bus's.

### Breaking: the `orientation` input is gone, and so is the `orientation` reply field

`--orientation` on the CLI, `orientation` on every MCP tool that takes a screen, and `setOrientation` on
control are **removed**. The word inverted its plain meaning on half the preset table — `'landscape'` meant
*the rotated one* and produced a portrait screen on every preset stored landscape. **Use `rotate`** (CLI
`--rotate`, MCP `rotate`). The reply's `orientation` goes too: `rotated` already carries the same fact.
`setOrientation` is still accepted on control this release and is deprecated. Register:
`docs/breaking-changes.md`.

### Breaking: `obsrv_inspect`'s readout gains `lineRects`

The published shape gains five key paths on `obsrv_inspect`. Every output schema is
`additionalProperties: false`, so a client session that listed the tools **before** this change rejects a
reply carrying the new field; re-list after upgrading. Register: `docs/breaking-changes.md`.

### An unknown input key is refused instead of dropped

A tool handed a key it does not know used to **drop it** and answer as if it had not been passed — so a
caller still sending the removed `orientation` got an unrotated screen with no error and no warning. Unknown
top-level input keys are now refused, and the refusal names the flag to use instead, per tool. In the same
surface, `obsrv_snap`'s and `obsrv_audit`'s `preset` descriptions now say what each tool does with a preset
on a live call — snap applies it to the running app, audit ignores it with a note. Both previously read
`Default: 1080p-24.` and **said nothing about mode at all**, so nothing told a caller that the same input is
honoured by one tool and discarded by the other. Two description strings; no behaviour, no published shape.

### The tools refuse an app older than 0.58.0

Rather than driving an app whose replies it cannot interpret, the MCP refuses and says so; two sentences
written for older apps are gone. `obsrv_snap`'s JSON also names the rotation it rendered at, behind the flag
that asked for it.

---

## The three decisions this release rests on

**Relayed, not typed where this draft is written.** Opeyemi answered in Resolver's session **between 22:46:32Z and 22:48:29Z**
(room `#4785`; Resolver's "about 22:50Z" was corrected by @Wren at `#4787` against the message's own stamp), verbatim: *"Go with your recommendations on 1, 2 and 3"*, against Resolver's numbered list.
Nobody else can read that session, so this section is Resolver's account — the same standing the
measured-page shape carried on its card, and it should be read the same way. **Resolver runs the cut, since
the authorisation was typed there.**

1. **`bug-vision-47-normal-not-red`: parked again, for 0.64.0** — a fresh park, not an inherited one, with
   an updated notes paragraph rather than 0.63.1's.
2. **The gate's second number: at least `47 of 125` with a recorded control** is the gate's figure, with
   `113 of 125` seen to fire beside it — written into `docs/note-inventory.md` **first**, with its
   population, then quoted from there. (The figure put to Opeyemi was 40; @Dogu's recount before it
   landed made it **at least 47**, and the merged file is what the notes quote.)
3. **0.64.0 ships with two open class 1**, both under "Known, not fixed".

**Decided and dropped:** the `asked` field. Opeyemi answered in the same session shortly after the three
above (relayed, room `#4788`), verbatim: *"Drop the asked field and delete the probe branch"*. So 0.64.0
ships without it **by decision, not by omission**. Its card was **deleted** rather than filed in a column
(`#625` removes `board/feat-asked-field-beside-url.md`, −34): @Wren's `#4794` showed `done` renders as
*"Merged."* per `scripts/build-board.js:121`, and backlog would invite someone to build it, so neither
column tells the truth about a dropped feature. **The record of the drop therefore lives on the
measured-page card and in the room, not on a card of its own** — worth knowing for anyone who later greps
the board for it and finds nothing. **That matters for how the notes read:** the reply names the page it measured and
there is **no machine-readable `asked` field coming**, so a caller who wants to compare must keep the
address it asked for on its own side.

## Known, not fixed

Two, and both are class 1 — *a wrong answer the caller cannot detect* — carrying the warning that makes
each one detectable, as `docs/release-gate.md:146-147` requires.

### A vision simulation's "Normal" render can come back wrong — white, or black

**Draft paragraph for the release body. This replaces 0.63.1's and must not be copied from it.**

> Returning a vision simulation to **Normal** can produce a frame that is not the page. 0.63.0 and 0.63.1
> described this as a **washed-out, white** render; since then it has also come back **black**. Of seven
> sightings, two were a black frame and the rest read white. **Nothing says so — not the picture and not
> the reply.**
>
> **If you look at these captures by eye, 0.63.1's advice is no longer enough.** It said a person can at
> least see that the image is bleached. A **black** frame does not look bleached: it looks like a dark page,
> or a page that had not painted yet, and it can be accepted as either. Judge a `Normal` capture against
> what the page actually looks like, not against "is it washed out".
>
> **If you drive Obsrv from an agent, treat a `Normal` vision capture as unverified until someone has
> looked at it.** An automated caller reading only the structured output has no signal either way, which is
> why this is class 1 rather than a cosmetic note.
>
> The timing cause behind the first two sightings was removed in `#458`, so it is no longer available as an
> explanation. Whether the white and the black frames arrive through the same unpainted-frame path is not
> yet known; nobody has read the capture path for it.

**Why the paragraph changed, for whoever reviews it:** the park is a **fresh** decision for 0.64.0, and the
evidence moved under it. Two of the seven firings are `[0,0,0]`; the colours alternate rather than
progressing, so neither belongs to a closed past; and **both rotate changes shipping in this release
(`#592`, `#599`) are excluded as causes by measurement**, not by argument. `blocks` and class 1 are
retained as a decision and explicitly not a downgrade — the card has refused three downgrades and the
record should not gain a fourth by implication.
### A measurement can still be of the page Obsrv's sync carried the target to — and now says which

**Draft paragraph for the release body.**

> A live `inspect`, `audit` or `lint` measures the page the target is showing. Under Obsrv's own sync bus,
> that can be the page the **other pane** reached rather than the one you asked for: the bus mirrors the
> other pane's commit into the target, sometimes before the page you asked for has run its own script.
> **0.64.0 does not stop that happening. What it adds is a sentence saying it did** — the reply names the
> page the figures are actually of, so a caller can tell.
>
> If you see that sentence, the numbers in the reply are real measurements of a real page; they are simply
> not of the address you typed. Ask again, or read the named page as the subject.

**Why this is "not fixed" rather than "fixed", for whoever reviews it.** `#621` (merged `51eb7116`) adds
the note; **it does not change which page gets measured.** Its own deterministic test asserts exactly that
— asked `tall.html`, measured `hairline.html`, and the reply names it. `docs/release-gate.md:86-90` is
explicit: *"A wrong answer that cannot be fixed in time can be **made detectable**: the reply says the
figure may be wrong, and says why. Then it is no longer silent, and it belongs in 'Known, not fixed' with
everything else."* So this is the escape hatch used properly — **the warning is in the reply, where a
caller is**, not only in these notes — and `:146-147` requires the notes to name it, which the paragraph
above does. The `asked` field — a machine-readable copy of the address asked for, beside `url` — was considered and
**dropped** (relayed, `#4788`), so it is not coming in a later release either unless that is revisited; it
would have been a breaking change (`docs/compatibility.md:12`). **A caller that wants to compare should
hold the address it asked for itself** and read the sentence above.

**I had this wrong twice** (room `#4743`, and the first version of this section): I called the note "the
half that retires the class", and wrote that building it would remove this item from the notes. It does
neither. @Idris corrected it at `#4747` against the gate's own text, and @Wren extended it to the board at
`#4750`.

---

## The gate, item by item (`docs/release-gate.md`)

**A distinction this draft got wrong first time, and it governs the section above.** `docs/release-gate.md:86-90`
separates **fixed** from **made detectable**, and the escape hatch from class 1 is instrumentation: the reply
says the figure may be wrong and why, and the defect then belongs in *"Known, not fixed"*. `:146-147` adds
that a downgraded class 1 **must name the warning**. So `#621` moves measured-page from *silent* to
*detectable*, and the count of open class 1 at the cut does **not** drop because of it — what drops is the
silence. The same test applies to anything else that lands before the cut.

**Satisfied:**
- **Every changed public field or sentence is in the register.** `docs/breaking-changes.md:27` carries the
  orientation removal (input, reply field and control command); `:156` carries `obsrv_inspect`'s
  `lineRects` and names what breaks. Both breaking changes in this range are registered.

**Not satisfiable before a candidate exists:**
- **Every release-note sentence describing new behaviour has a run behind it.** The 0.61.0 standard is a
  cold-machine verify on CI plus a per-file sha diff binding the verdict to the tarball that was actually
  published. **That needs a published candidate**, so it is the last step, not a precondition of this
  draft. Every `###` section above is written from commits, not from a cold run, and should be treated as
  unverified prose until that run exists.

**The two numbers published with each release:**
1. **Open class 1 bugs at the cut.** Target zero. **Two at this cut, and that is the decided position** (decision 3, relayed): measured-page, made detectable, and vision-47, parked again. `#621` did not reduce it — a class made detectable stays counted and is named with its warning (`:146-147`). Neither can be
   silently dropped: the gate says a downgraded class 1 must name the warning that made it detectable.
2. **The share of the product's own sentences shown firing with a control.** **Quote `docs/note-inventory.md`
   verbatim**, which is now possible because the figure is in the file: *"at least 47 of the 125 producers
   counted have a control this file records, and 113 of the 125 have been seen to fire"* (its Headline,
   dated 2026-10-12, landed in `#627` as `d6d51f88`).

   **Publish the "at least".** It is a **floor**, not a count: @Dogu's paragraph says the PR descriptions of
   the other 66 observed sentences were not searched, so the true number is ≥ 47. Dropping the hedge would
   turn a floor into a measurement — the same move 0.63's `89 of 122` made when it mixed populations, which
   is why that figure is not a precedent.

   **The order this needed, now satisfied.** The gate asks for that share **and** says to take it *"from the
   inventory's own table rather than recomputing it: that file states its population and what moved it,
   which is the half most counts leave out."* Both clauses hold only if the figure is written down first,
   which `#627` did. **The figure put to Opeyemi was 40; the merged figure is at least 47** — so quoting the
   decision rather than the file would already have published a stale number.

---

## The bump, if it is cut

Per Resolver (#4717), the version bump commit is **5 files only**, as `8c8a037` was for 0.63.1:
`package.json`, the lockfile, `.mcp.json`, and the two `.claude-plugin` files. Release notes go in the
GitHub Release body, not into the repository.

**Not done here, on purpose:** no version bumped, no tag, no PR opened. A release is Opeyemi's — protected
`main`, his publish, his OTP.
