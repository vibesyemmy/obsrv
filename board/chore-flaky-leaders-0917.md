---
title: "Four flaky tests with no card, each 3 of 43 first attempts on main since #82"
column: done
kind: chore
owner: "Kenya"
criterion: B5
order: 72
---

**PULLED FROM BACKLOG AND CLAIMED BY KENYA 2026-09-17** on Wren's routing. Logs only; anything
needing a repro goes to CI unless the spec is desk-safe and carries no recorded activation, checked
per spec rather than per file.

FOUND BY HENRY 2026-09-17, in the remeasurement on `bug-ci-main-red-37pct`. Each failed its first try
and passed its retry in 3 of main's 43 suite runs since #82. **Nothing here is a cause yet:** read each
run's first failure line before naming one, and check the test does its own setup before calling a
both-tries failure deterministic (tonight's `panes:83` and `sync:139` were both test defects).

| test | runs (attempt 1) |
| --- | --- |
| `tabs.spec.ts:266` "entering an image-mode tab stops delivery, so target frames cannot overwrite the drawing" | 35125554296 (ab39983), 35130836287 (57e999d), 35177333642 (9e9cdab) |
| `panes.spec.ts:259` "a failed load is drawn as an empty state, not a card on top of one" | 35136256249 (b21d1da), 35148542055 (a6af19e), 35174341331 (6f7dec1) |
| `panes.spec.ts:230` "a failed load says so in the window, across both panes, and clears when one commits" | 35148542055 (a6af19e), 35160475615 (d6e808a), 35170701394 (74f15c5) |
| `target-source.spec.ts:106` "emits a partial dirty rect when a small element changes" | 35159915364 (093d1c3), 35160475615 (d6e808a), 35177291404 (10cd219) |

The two `panes` failed-load tests share a run (a6af19e), and so do `panes:230` and
`target-source:106` (d6e808a). Look for a shared cause before treating them as four problems.
Attempt-1 logs stay at `…/actions/runs/<id>/attempts/1/logs`.

**Shape 3 (`tabs.spec.ts:266`) — the assertion has been made readable, in `#244` (Rook, routed by
Wren while you were heads-down on shape 1; test-only, and yours to reshape).** `Expected: 0,
Received: 1` could not be triaged, because a count fits two opposite facts: the gate leaked a frame
for the tab being ENTERED, or a frame for the tab being LEFT was sent pre-gate and arrived during the
wait — and `FrameMessage` carries no tab id. It now compares each frame's `seq` against
`bus.lastSeq()`, read in the **same main-process callback** as the activation, so a failure names
which frame. Evidence: `35186688593` green with all three tests confirmed run, `35186716380` red at
the seq assertion (`[10]`, then `[8]`). **This does not fix a leak — it makes the next one legible.**
If shape 3 recurs after this, its message says which of the two facts it was.

## READ 2026-09-17 by Kenya — four leaders, THREE shapes, and the shared runs do not share a cause

**The hidden-predecessor check is negative for all four.** Each does its own setup: `tabs:266` calls
`reset()` and `activate()`, both `panes` tests fill and submit their own address, and
`target-source:106` loads its own `data:` URL. So the defect that explained `panes:83` and
`sync:139` tonight does **not** explain any of these — worth stating, because it was the first thing
to look for and the answer is no.

### Shape 1 — `panes:230` and `panes:259`: the window state never renders, while the badge does

Both, in run `a6af19e`, identical to the line:

    Error: expect(locator).toBeVisible() failed
    Locator: locator('.load-error-state')
    Timeout: 15000ms
    Error: element(s) not found

**`element(s) not found`** — not present-but-hidden. And `panes:230` fails the same way in `d6e808a`,
so the shape is consistent across runs.

**What rules out the obvious environmental guess:** `panes:197` — *the same invalid host*, in the
same app, **294 ms earlier** — passed, as did `:216` at 527 ms. So the bad-host load was failing fast
right before. The retries then passed in **649 ms and 328 ms**. A slow resolver would have to have
been slow for exactly two adjacent tests and fast either side of them.

**The difference between the tests that pass and the two that fail is which element they wait on:**
`:197` waits for `.badge-error`, the toolbar; `:230`/`:259` wait for `.load-error-state`, the
window-level empty state. **The error reaches the toolbar and not the window.**

**A lead, unmeasured:** `:230` navigates good → bad, and `:216` immediately before it is the test
that *clears* the badge with a successful navigation. A latch left by clearing an error, so the next
failure renders no state, would fit — and would fit `:259` too, which runs straight after. Nothing
here measures that; it is where I would point a repro.

### Shape 2 — `target-source:106`: a null frame in the test's own evaluate

    TypeError: Cannot read properties of null (reading 'frame')

Inside `app.evaluate`, not an assertion. Unrelated to anything in shape 1.

### Shape 3 — `tabs:266`: one frame got through the gate

    expect(received).toBe(expected)   Expected: 0   Received: 1

A frame was delivered that the image-mode gate should have dropped, inside the test's 600 ms window.

## So the card's own suggestion does not hold, and that is the useful part

It asked us to look for one cause behind the shared runs. **In `d6e808a`, `panes:230` and
`target-source:106` fail with unrelated first lines** — a missing DOM element and a null frame — so
that run shares a machine and nothing else. **In `a6af19e` the two `panes` tests do share a shape**,
but they are the two tests that wait on the same element, which is a shared *subject*, not evidence
of a shared environment.

**Four leaders, three shapes, and only one pair is related.**

## SHAPE 1 REPRODUCED 2026-09-17 by Kenya, with both arms pre-registered

Arms committed to `probe/error-state-latch` **before** running, so the expectations are on the
record rather than written around the numbers.

    ARM A  good navigation (which clears the error), then a failing one    6/135 missed  (4.4%)
    ARM B  a failing load straight after a failing one, no clearing        0/135 missed
                                                        Fisher exact, two-tailed, p = 0.030

**The control never misses, and the latch arm does.** So the condition is not "a failed load
sometimes fails to draw" — it is **a failed load that follows a cleared one**.

### A correction to my own reading above

I wrote that *"the error reaches the toolbar and not the window"*. **That was an inference across two
different moments, not an observation.** `Toolbar.tsx:380` reads the **same** `error` field the
window state reads, so a wiped error would take the badge with it. What is actually established is
narrower: at the moment `:230` and `:259` looked, no `.load-error-state` existed. `:197` passing
earlier says the badge existed *then*, about a different navigation.

### The mechanism this points at, and it is a lead rather than a finding

Two handlers clear the error: `onUrlChanged` (`App.tsx:140`) and `onTargetNavigating` (`:149`). The
comment at `:145` states the ordering the design relies on — *`did-start-navigation` precedes
`did-fail-load`, so a retry that fails again still ends up badged*.

**A successful navigation's `url-changed` arriving late would clear the error the NEXT, failing
navigation had already set** — and that is exactly the asymmetry the arms measured: it can only
happen when a good navigation precedes the bad one, which is arm A and not arm B.

**Not measured:** the event times. Nobody has watched a late `url-changed` land after a
`did-fail-load`. That is the next step, and it is the difference between this paragraph and a cause.

## SHAPE 1, MEASURED FURTHER — the latch lead is REFUTED, and so are two more

Instrumented arm A end to end on `probe/error-state-latch`: the renderer's own event arrivals
(subscribed alongside `App.tsx`, so the real path still runs), a DOM observer for the state
appearing, main's `did-fail-load` codes on both panes, and the URL field's value at the moment Enter
is pressed. **Every arm below has its own control on a hit**, printed beside the miss.

    HIT    +0    target-navigating
           +19   target-navigating
           +90   load-error -105        main's did-fail-load: ["native -105","target -105"]
           +90   state SHOWN

    MISS   +0    target-navigating
           +5    url-changed  hairline.html
           +17   target-navigating
           (nothing further)            main's did-fail-load: []

**1. The latch is refuted.** A miss shows **no `load-error` at all** — the error is never set, so
nothing clears it. That is the criterion @Wren pre-registered for the lead failing, and it failed.

**2. A slow lookup is refuted.** Past the 8 s budget the state **never arrives, even at 33 s**, and
`did-fail-load` never fires on either pane. A lookup that is merely slow would land eventually.

**3. A clobbered URL field is refuted.** The app writes the committed address into the field on
`url-changed`, so a late one could have overwritten what was typed — but the field **held
`obsrv-no-such-host.invalid` at the moment Enter was pressed**.

### What is left, stated as narrowly as the evidence allows

**Enter is pressed with the correct address, and no navigation follows.** Both panes still show
`hairline.html`, **neither is loading**, and nothing failed. The submit is swallowed somewhere
between the keypress and the panes, about 4.4% of the time, and only after a successful navigation.

**Not yet measured:** whether the renderer's submit handler runs at all, and whether a `navigate`
reaches main. That is the next step and it is two log lines.

## SHAPE 1 — THE CAUSE, and my own "refuted" was wrong

**`Toolbar.go()` overwrote what had been typed when the navigation it started resolved — the code below is the PRE-FIX shape, kept because it is what the measurements were taken against:**

```ts
const go = async (url: string): Promise<void> => {
  setError(null)
  const applied = await window.obsrv.navigate(url)
  setUrl(applied)
  setDraft(applied)     // ← lands whenever the promise settles
}
const submit = (e: FormEvent): void => { …; void go(draft) }   // submits DRAFT, not the field
```

**Measured, on two separate misses, with a baseline:**

    the native pane was asked to load: ["about:blank ok", "hairline.html ok", "hairline.html ok"]
    the field held at submit: hairline.html
    panes now: native=hairline.html loading=false  target=hairline.html loading=false

The bad host is **never asked for**. The previous navigation's `setDraft(applied)` lands between the
typing and the Enter, so the submit re-sends the address already showing — a no-op. Nothing loads,
nothing fails, no error state. **And that is why the control arm is clean:** in bad → bad the
overwrite writes the *same* bad address, so the next submit is still the bad address.

### The correction: I refuted this hypothesis once, on an insufficient measurement

Earlier I recorded "a clobbered URL field: refuted", because the field held the bad address at the
moment I read it. **I measured the DOM value, and the submit uses React state (`draft`)** — and the
overwrite can land between the read and the keypress. A later miss showed the field itself holding
`hairline.html` at submit, which is the same defect arriving a few milliseconds earlier. **The
hypothesis was right and my refutation was too weak to see it.**

### One instrument caught itself, which is why the rest is trustworthy

Wrapping `window.obsrv.navigate` to log what the handler sends **did nothing** — `contextBridge`
freezes that object, so the assignment failed silently. The tell was that **no `navigate() called`
line appeared for the GOOD navigation either**, which must always be there. The replacement uses
`NativePane.loadTrace()` from #129, which has that baseline in every sample above.

### Scope

`panes:178` ("a navigation elsewhere does not clobber a URL being typed") guards the neighbouring
case — an *incoming* navigation while typing. This was the **outgoing** one: the answer to a
navigation *we* started.

**FIXED the same night, in #239 (`dcc9af3`)**, and it took the first of the two options this card
named — drop the write when the field has changed since:

```ts
const sent = draftNow.current
const applied = await window.obsrv.navigate(url)
setUrl(applied)
if (draftNow.current === sent) setDraft(applied)     // Toolbar.tsx:226
```

`panes:178` still guards the incoming twin; this guards the outgoing one. **So the question this
paragraph used to leave open is closed**, and a reader should not go looking for a decision to take.

**Two routes to one mechanism, hours apart.** The fix was written from this card's shape-1 report;
the end-to-end trace above found the same mechanism from the other end, by instrumenting the
renderer and reading what the panes were actually asked to load. **They agree**, and that agreement
is worth more than either alone: one is a reading of the code, the other a measurement of the running
app, and neither had the other's answer in hand.

## Why the wrong answers were caught — the part worth copying

Three hypotheses were refuted on the way to the cause, and **two of those refutations were themselves
wrong**. Not because the reasoning was sloppy: because the **measurement** was.

- *"The clobbered field is refuted — it held the bad address when I read it."* The submit reads
  React state (`draft`), not the DOM. **I measured the wrong object**, and the overwrite lands
  between the read and the keypress.
- *"No `navigate()` call on a miss."* The wrapper never ran: `contextBridge` freezes that object, so
  the assignment failed silently and logged nothing, ever.

**Neither was caught by being careful.** Both were caught because every number was printed beside a
line that must always appear, and the line went missing:

    the GOOD navigation logged no `navigate() called` either   → the wrapper is dead, not the product quiet
    main's did-fail-load on a HIT: ["native -105","target -105"] → so `[]` on a miss means something
    a HIT prints `load-error -105`                              → so a miss with none is an absence, not a blind spot

**The rule this leaves:** *an instrument that cannot show you it is working is indistinguishable from
a product that is quiet.* Both look like nothing. So print the line that must always be there — the
control case, the healthy sample, the baseline — beside the line you care about. **A silence is only
evidence once something in the same breath proves you would have heard a sound.**

Cheap to do and it never needs remembering: it is the same discipline as the vacuity arms on
`chore-strict-output-under-test` and the pre-registered control above, one level down — at the
instrument rather than at the test.

## DONE 2026-09-17: every shape answered or made to answer itself, and the rule for the four cards like it

**Moved to Done by Henry**, on Opeyemi's instruction to take the Doing cards to Done one at a time
(relayed in room #440). Kenya's session is out.

### The rule, set here and applied to all four recurrence-waiting cards

Doing means someone can act on the card now. **A card whose remaining work only an unforceable event can
unblock leaves Doing.**
- **It goes to Done when its own acceptance is met.** For an investigation that means every open question
  has either an answer, or an instrument that answers it on recurrence and has been shown to fire by a
  control.
- **Every question that still needs the event gets exactly one home:** the card that already owns it, or a
  new backlog card that opens by naming the failure message the instrument will print. The board keeps
  `waiting:` for Doing and Review, so on a backlog card this lives in the body. It is never a sentence at
  the end of a closed card, where a recurrence has nowhere to land.
- **A card whose acceptance was a fix, and only has an instrument, is not Done.** It moves to Backlog,
  opening with the awaited failure message and naming the instrument.

### This card, against that rule

The acceptance was triage of four leaders nobody had carded: read each first failure, check each test does
its own setup, and look for a shared cause. **It is met:**
- **Shape 1** (`panes:230`, `panes:259`) has a cause, and it is **fixed** (`#239`). Main's `Toolbar.go()`
  no longer overwrites an address typed while a navigation was in flight.
- **Shape 3** (`tabs:266`) is **legible** (`#244`). A recurrence names the leaked frame's seq, and a control
  proved it fires (`35186716380`). Its home is now `bug-tabs-266-gate-leak`.
- **Shape 2** (`target-source:106`) is **instrumented** (`#240`). A recurrence prints the timed frame record
  with *"no full 400x300 frame within 10 s"* or *"no partial frame within 10 s of the change"*. Its home is
  now `bug-target-source-106-null-frame`.
- **The shared-cause question is answered: they don't share one.** The runs they share are a machine, not
  a cause.

