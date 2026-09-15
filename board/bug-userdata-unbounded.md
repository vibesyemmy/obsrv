---
title: "userData grows without bound — 1.3 GB, 94% of it Chromium cache"
column: next
kind: bug
owner: "Kenya"
order: 29
---

ROUTED TO KENYA 2026-09-15, pending Opeyemi's word in Kenya's own session. Left in Next until he says go.

**Chosen because the card's centre is a genuine unknown rather than a known fix waiting to be typed**, which is what Kenya asked for: *whether these caches make repeat measurements of the same page faster or more consistent.* Nobody has measured it, the obvious fix is a cap, and a cap is wrong if the cache is load-bearing.

**AND A CONNECTION NOBODY HAS DRAWN, offered as a hypothesis and not a finding.** B5 was downgraded the same night to *"met on one desk, and a second desk disagrees"* — 0 result fields moved on this laptop, 4 on CI, both diverging cases on `grows-as-walked.html`. That was read as a speed difference: 14 cores against a three-core VM.

**But the two desks also differ in cache state, and nobody controlled for it.** CI starts from a fresh runner every run — cold Chromium cache, every asset fetched. This laptop carries 1.3 GB of warm cache, 936 MB of it `Cache`. So the B5 comparison was warm-against-cold as much as fast-against-slow, and `grows-as-walked.html` is precisely the fixture where load timing decides what the walk sees.

If the cache affects repeatability, it could account for part of that disagreement without CPU speed entering into it. **That is a guess with a mechanism, at the weight the margin hypothesis had before it died** — and the instrument to settle it already exists: `scripts/b5-fixture-sweep.js`, Kenya's own, which is a tool rather than a model and carries no assumption about the answer.

**What would settle it**, and the null is a real result either way:

- The fixture sweep run twice on one desk — once with the profile's cache warm, once with it cleared — and the moved-field counts compared. Same machine, same speed, one variable.
- If the counts differ, the cache is load-bearing for B5 and a cap needs a number chosen against that rather than against disk space. It would also mean B5's desk comparison has a confound in it that should go on `ci-second-host`.
- If they do not differ, the cache is free to bound and the 1.3 GB is a straightforward growth defect — and B5's desk disagreement stays attributed where it is.

Either way it is a measurement someone can finish, and it decides a fix rather than performing one.

**The documentation half is separable and cheap:** neither `docs/limitations.md` nor the README's *Privacy and files* section says this directory grows without limit, which a user would want to know before it is 1.3 GB. That can ship whatever the measurement finds.

Measured by Rook 2026-09-14 on this machine's real profile while scoping A4.

    ~/Library/Application Support/Obsrv    1.3 GB total
      Cache                                936 MB
      Code Cache                           338 MB

Nothing prunes either. They are Chromium's own caches for every page Obsrv has ever rendered, and Obsrv renders arbitrary third-party pages by design — so this grows with use in a way an ordinary app's does not, and faster for the people who use the tool most.

**Filed separately from A4 deliberately.** A4 asks what an install leaves behind after an uninstall; this is what normal USE accumulates while the tool is working correctly. Folding it into A4 would let a criterion about residue absorb a defect about growth, and the two have different fixes and different urgency. A4's own residue finding — the 128 MB Electron zip in `~/Library/Caches/electron/` that survives `npm rm -g getobsrv` — stays on A4, because that one genuinely is uninstall residue.

What is NOT yet known, and should be established before choosing a fix, because the obvious fix is a cap and the obvious cap is wrong if the cache is load-bearing: whether these caches make repeat measurements of the same page faster or more consistent. Obsrv's whole product is that two measurements of the same page agree (B5), so a cache that quietly improves repeatability is not free to delete. Measure the effect on a repeat snap before capping anything.

The related limits question: `docs/limitations.md` says what Obsrv cannot measure and `README.md` has a *Privacy and files* section naming where files live. Neither says this directory grows without limit, which a user would want to know before it is 1.3 GB.
