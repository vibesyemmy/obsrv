---
title: "The first window never mentions the monitor diagonal, which the README calls the one number that makes Obsrv work"
column: doing
owner: "Rook"
waiting: "Opeyemi: ask, hint, or stay quiet on first launch"
kind: chore
criterion: A3
order: 64
---

FOUND BY HENRY 2026-09-17, in `a3`'s cold-machine run. **A product question, for Opeyemi.**

The README's Quickstart: *"Open it and set your monitor's diagonal in Settings — that one number is what
makes the target pane render at true physical size."* **The v0.60.0 app's first window on a fresh
machine says nothing about it** (run `35167885454`, screenshot in that run's `a3-app` artifact). What it
shows is an empty state, "Point Obsrv at a page to see it the way a 1x screen does.", a URL field with
an Open button, and the toolbar. The footer reads
`TARGET 1920×1080 landscape · fit ×0.42 · not pixel-exact · Reference (off) · 8-bit`. There's no prompt,
badge or hint that the render isn't yet at true size, and the only way to Settings is the gear icon.

A stranger who opens the app without reading the README gets a render at an assumed size and nothing
telling them so. Whether first launch should ask, hint, or stay quiet is a product decision.

**Seen in passing, and not a finding yet:** two URL inputs are visible at once, the address bar and the
empty state's field.

## Pulled by Wren 2026-09-17, claimed by Rook — and the memo is below, not a second PR

Pulled from Backlog in a sweep rather than picked by me. Claim and memo are in one change because the
memo **is** the work on a card whose deliverable is a decision; a claim PR followed minutes later by a
memo PR would be churn at this hour. **No code is changed.**

## For Opeyemi: first launch and the monitor diagonal

**The decision is yours. Everything below is evidence and one labelled recommendation.**

### What makes this worth a decision rather than a default

`DEFAULT_SETTINGS.hostDiagonalInches` is **27** (`shared/presets.ts:16`). Magnification is
`hostPPI / targetPPI`, and `hostPPI = hypot(width, height) / diagonalInches`, so assuming 27 on a
smaller screen understates the host's density and the target pane renders **smaller than life** by
exactly the ratio of the true diagonal to 27:

| the screen someone actually has | what the target pane renders at |
| --- | --- |
| 13.3" laptop | **49%** of true physical size |
| 14" laptop | 52% |
| 16" laptop | 59% |
| 24" monitor | 89% |
| **27" monitor** | **100%** — correct |
| 32" monitor | 119% |

**The default is exactly right for one screen and roughly half wrong for the most common one.** A
tool whose purpose is "see it the way a 1x screen does" is, on a laptop, showing a page at half the
physical size it claims — and saying nothing. That is the case for acting at all; it is not an
argument for any particular one of the three options.

**What the first window shows today** (v0.60.0, cold machine, run `35167885454`, `a3-app` artifact):
an empty state reading *"Point Obsrv at a page to see it the way a 1x screen does."*, a URL field, and
a footer reading `TARGET 1920×1080 landscape · fit ×0.42 · not pixel-exact · Reference (off) · 8-bit`.
Nothing names the diagonal, nothing says the render is at an assumed size, and Settings is reachable
only by the gear icon.

---

### Option 1 — **Ask** on first launch

**What the user sees**, once, before anything else:

> **What size is this screen?**
> Obsrv renders pages at true physical size, and it needs your monitor's diagonal to do it.
> `[ 27 ] inches`   — measure corner to corner, or check the model number
> [ Use 27" ]  [ Save ]

**Code:** a first-run flag in settings, a modal in the renderer, and a path that cannot be dismissed
into an unset state. **Tests:** a spec for first launch showing it, a second launch not showing it,
and the value reaching `settings.json`. `tabs.spec`-style relaunch coverage already exists to copy.

**What could go wrong:** a modal before the user has seen the product is the most expensive thing you
can put in front of a stranger, and the honest answer for many is "I don't know" — at which point they
guess, and a *wrong* number is worse than the default, because it is worn with confidence. It also
cannot be right for a laptop plugged into an external monitor, where the answer changes with the desk.

---

### Option 2 — **Hint** in the first window

**What the user sees** — the footer's existing `not pixel-exact` chip gains a sibling, or the empty
state gains one line:

> Rendering as if this screen were 27″. [Set your screen size] for true physical size.

**Code:** one line in the empty state or one chip in the footer, reading a settings value that already
exists; a link that opens Settings on the display panel. **Tests:** the line is present when the
diagonal is untouched and absent once set — which needs a "has the user set this" bit, since 27 is
both the default and a legitimate answer. That bit is the only real design work in this option.

**What could go wrong:** it can be ignored, which is also its virtue. And it needs the untouched/set
distinction to avoid nagging someone who genuinely has a 27" monitor — without that, it either lies
("you haven't set this" when they have) or disappears for people who need it most.

---

### Option 3 — **Stay quiet**

**What the user sees:** what they see today.

**Code and tests:** none. **What could go wrong:** the case above — half-size renders on laptops, with
the footer stating figures that are internally consistent and externally wrong. This is the option
that keeps the README's *"that one number is what makes Obsrv work"* true only for people who read the
README, which by construction excludes everyone the first window is for.

---

### Recommendation — **option 2**, and this is a recommendation, not a finding

The hint is the only one of the three that tells a stranger the thing they cannot otherwise discover,
without spending the first moment of the product on a question many of them cannot answer. Option 1's
cost lands on every user including the ones who would have been fine; option 3's cost lands entirely
on the people least equipped to notice it.

**Two things I would want settled before anyone builds it**, because they are decisions and not
details:

1. **The untouched/set bit.** Without it the hint cannot be both honest and quiet. It is a new
   persisted field, so it is a contract question, not a UI one.
2. **What it says when a laptop is on an external monitor.** The true answer changes with the desk and
   nothing detects it. The hint may be right to stay silent about that, but it should be a choice.

**Not established:** whether anyone has actually been misled by this. It is inferred from the default,
the arithmetic, and one cold-machine screenshot — no user has reported it, and nobody has counted how
many people run Obsrv on a laptop versus a 27" monitor.
