# Release gate

What stops a cut, and what ships with disclosure.

[`compatibility.md`](compatibility.md) says what may change in a release and how
you are told. [`limitations.md`](limitations.md) says what Obsrv cannot do. This
page is about **when to ship**, which is the question neither of them answers.

**Status: proposed 2026-09-17 by Wren, not yet approved.** The blocking list
below is Opeyemi's judgement to make, not engineering's; everything else follows
from it. Until they approve it, this page describes what we have been doing
implicitly rather than a rule anyone is held to.

## Why "the backlog is empty" cannot be the gate

Two different things arrive on the board and look identical there.

**Discovery debt is finite.** Most cards filed this week came from the team
auditing its own output rather than from the product misbehaving in front of
anyone. [`note-inventory.md`](note-inventory.md) bounds that work: 122 producers
in the tree as of 2026-09-17, 89 shown firing with a control and 14 unfired.
When the sweep ends, that source of cards ends with it.

**Incoming defects are not finite,** and never will be.

**And a third of the backlog cannot be acted on at all.** Seven of the 21
Backlog cards on 2026-09-17 open with `**Waiting on a recurrence:**` — they are
waiting for a failure to happen again, and nobody can move them by working
harder. Counting them as debt distorts every judgement made from the number.

A gate built on backlog size therefore measures three unrelated things at once,
and gets larger the more carefully the team looks at its own work. That is a
gate that punishes the auditing this project runs on.

## What blocks a cut

Four classes. Each has happened here, and each is named with the case that
earned it its place.

**1. A wrong answer the caller cannot detect.** A number, colour, coordinate or
sentence that is false about the thing it names, with nothing in the reply
saying so.

- Contrast read against the page instead of the component: 1.24:1 reported
  where 11.86:1 was painted (`#293`, measured before it shipped).
- A walk blaming a page for 15 s of silence it was never given, after a budget
  that had already run out (`#309`).
- A raster saying the page was still painting, about pixels that never painted
  at all (`#302`).

**2. A regression against the last release,** on a path that shipped working.

**3. Install, upgrade, first run, or version skew failing hard** — an error
rather than a degraded answer.

- `readout.colorPainted` shipped as required would have failed every live
  `obsrv_inspect` against a 0.60.0 app, with a schema error naming a field
  (`#205`, caught in the release sweep).
- The npm package's own app named itself "Electron", so anyone with only the
  package had never had live drive at all (`#201`, `#202`).

**4. Data loss, or writing outside Obsrv's own directories.** The same "Electron"
bug wrote a profile, logs and history into directories other unnamed Electron
apps share.

## The escape hatch from class 1 is instrumentation, not prose

A wrong answer that cannot be fixed in time can be **made detectable**: the
reply says the figure may be wrong, and says why. Then it is no longer silent,
and it belongs in "Known, not fixed" with everything else.

A release note alone does not count. Nobody reads the release notes at the
moment a wrong number arrives in a tool reply, and an agent reads nothing but
the reply. This is the rule the policy fails by if it fails: a class 1
downgraded with a paragraph nobody will see at the point of use.

## What does not block a cut

Ever, and none of it counts as release debt:

- sentences the product can produce but nothing has been seen to produce;
- cards waiting on a recurrence;
- flakes, unless they hide a class 1;
- performance, cosmetics, missing coverage;
- anything already disclosed and still accurately disclosed.

## Two evidence gates

These are about the honesty of the release rather than its defects, and this
product's claims are the product.

**Every release-note sentence describing new behaviour has a run behind it.**
0.61.0's practice is the standard: a cold-machine verify on CI
(`probe/rc-cold-verify`, run `35175793982`) plus a per-file sha diff binding the
verdict to the tarball that was actually published.

**Every changed public field or sentence is in the register.**
[`breaking-changes.md`](breaking-changes.md), by the rule in
[`compatibility.md`](compatibility.md). CI already enforces the snapshot half.

## Cadence, and what happens during a freeze

**Cut on a fixed day, mid-week,** so a bad release has working days behind it.

**During a freeze, a finding reopens the cut only if it is class 1 to 4.**
Everything else is the next version. 0.61.0 shipped with six known issues that
were already fixed on `main`, and that was the right trade: the fixes went out
days later in a release that had been tested, rather than hours later in one
that had not.

## The two numbers published with each release

1. **Open class 1 bugs at the cut.** Target zero. A class 1 that is downgraded
   must name the warning that made it detectable.
2. **The share of the product's own sentences shown firing with a control** —
   89 of 122 on 2026-09-17. This is the number that says whether the audit is
   converging. Take it from the inventory's own table rather than recomputing
   it: that file states its population and what moved it, which is the half
   most counts leave out.

Backlog size is not one of them, and should not be quoted in a release
discussion.

## How a card carries its class

A `release:` field in the card's frontmatter, set when the card moves columns:

| value | meaning |
| --- | --- |
| `blocks` | class 1 to 4. Named in the cut's checklist. |
| `disclose` | ships, and appears in "Known, not fixed" with what a reader can do about it. |
| `later` | ships, and is not worth a line in the notes. |

The Lead sets it; the PM flags anything that reads like a class 1 and is not
marked as one; Opeyemi arbitrates disagreements. A card with no `release:` value
has not been classified, which is itself worth catching before a cut.

## What this costs

It ships known bugs on purpose. That is only defensible while the disclosure is
complete, which means the "Known, not fixed" list has to be written by someone
who went looking for what belongs on it — not assembled from whatever happened
to be mentioned in the room. 0.61.0's list included a regression against 0.60.0
that nobody would have missed if it had been left out, and that is the standard
this page assumes.
