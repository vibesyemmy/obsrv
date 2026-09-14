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

---

## 0.61.0 — *unreleased, pending review*

> Three at once, all found by the surface-parity sweep (C4) rather than by a
> user. Each corrects a case where the two surfaces answered differently, so
> the break is the fix: code written against one surface's spelling was
> already wrong on the other.

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

**What breaks, and it is the least obvious of the three:** MCP tool output
schemas are `additionalProperties: false`, and a client session that listed the
tools **before** upgrading is holding the old enum. When a live capture then
answers `"resizing"`, that session can reject a reply that is perfectly
correct — and the failure looks like a capture bug rather than a stale schema.

**What to do:** **restart the session** (in Claude Code, start a new
conversation or reconnect the MCP server) after upgrading. This applies to any
release that adds an enum value or a field, not only this one.

### Also in 0.61.0, not breaking

`blocked` and `panel` now survive the trip from the page to the live walk, so
the live surface names what held a page instead of listing three things it
might have been; live `inspect` gains the landing and status sentences that
`audit` and `lint` already had; headless `snap` answers `url`; and both
surfaces answer `deviceScaleFactor`. Those are additions to fields already
declared — but see the session-restart note above, which applies to them too.

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
