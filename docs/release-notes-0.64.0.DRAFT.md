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
top-level input keys are now refused, and the refusal names the flag to use instead, per tool.

### The tools refuse an app older than 0.58.0

Rather than driving an app whose replies it cannot interpret, the MCP refuses and says so; two sentences
written for older apps are gone. `obsrv_snap`'s JSON also names the rotation it rendered at, behind the flag
that asked for it.

---

## Known, and shipping open

**To be written against the position at the cut, not now.** As of this draft, `release: blocks` is carried
by three cards; one (`bug-redirect-note-missing-not-late`) is `done` and is the close described above. The
two that would ship open:

- **`bug-vision-47-normal-not-red`** — class 1, retained, **and its park was granted for 0.63.0, not for
  this release.** 0.63.1's notes described it as two sightings, both white. It is now **seven** sightings,
  two of them black `[0,0,0]`, the colours alternating; both of the rotate PRs in this very release are
  excluded as causes by measurement; and whether the two colours reach the capture through the same
  unpainted-frame path is unread. **The notes cannot repeat 0.63.1's paragraph: it is out of date in the
  direction that matters.** Needs Opeyemi's park-again-or-fix before a cut.
- **`bug-measured-page-is-not-the-asked-page`** — class 1, `release: blocks`, shape decided
  ("note + `asked` field"), **not built**. If it is built before the cut this section loses it; if not, the
  notes must describe it in the terms the card uses, and the `asked` field is itself a breaking change
  (`docs/compatibility.md:12`).

---

## The gate, item by item (`docs/release-gate.md`)

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
1. **Open class 1 bugs at the cut.** Target zero. **Today it is two** — the two cards above. Neither can be
   silently dropped: the gate says a downgraded class 1 must name the warning that made it detectable.
2. **The share of the product's own sentences shown firing with a control.** The gate says to take this
   **from the inventory's own table rather than recomputing it**, and gives `89 of 122 on 2026-09-17` as the
   example. **`docs/note-inventory.md` no longer states a figure in that form.** What it does state:
   **58 call sites** (17 on the live surface) at line 17, and at line 125 **57 rows fired** across
   **110 distinct sentences** and 301 replies, of which **55 rows are user-visible**, with 3 ambiguous
   between producers. **None of those is "the share shown firing with a control".** I have deliberately
   not computed one. Either the inventory needs a headline line stating the share and its population, or
   the gate's wording needs to point at the figure the file actually keeps. **This will stall a cut at the
   last minute if it is left to the person tagging.**

---

## The bump, if it is cut

Per Resolver (#4717), the version bump commit is **5 files only**, as `8c8a037` was for 0.63.1:
`package.json`, the lockfile, `.mcp.json`, and the two `.claude-plugin` files. Release notes go in the
GitHub Release body, not into the repository.

**Not done here, on purpose:** no version bumped, no tag, no PR opened. A release is Opeyemi's — protected
`main`, his publish, his OTP.
