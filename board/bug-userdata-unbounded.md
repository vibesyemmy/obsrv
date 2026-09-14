---
title: "userData grows without bound — 1.3 GB, 94% of it Chromium cache"
column: next
kind: bug
order: 29
---

Measured by Rook 2026-09-14 on this machine's real profile while scoping A4.

    ~/Library/Application Support/Obsrv    1.3 GB total
      Cache                                936 MB
      Code Cache                           338 MB

Nothing prunes either. They are Chromium's own caches for every page Obsrv has ever rendered, and Obsrv renders arbitrary third-party pages by design — so this grows with use in a way an ordinary app's does not, and faster for the people who use the tool most.

**Filed separately from A4 deliberately.** A4 asks what an install leaves behind after an uninstall; this is what normal USE accumulates while the tool is working correctly. Folding it into A4 would let a criterion about residue absorb a defect about growth, and the two have different fixes and different urgency. A4's own residue finding — the 128 MB Electron zip in `~/Library/Caches/electron/` that survives `npm rm -g getobsrv` — stays on A4, because that one genuinely is uninstall residue.

What is NOT yet known, and should be established before choosing a fix, because the obvious fix is a cap and the obvious cap is wrong if the cache is load-bearing: whether these caches make repeat measurements of the same page faster or more consistent. Obsrv's whole product is that two measurements of the same page agree (B5), so a cache that quietly improves repeatability is not free to delete. Measure the effect on a repeat snap before capping anything.

The related limits question: `docs/limitations.md` says what Obsrv cannot measure and `README.md` has a *Privacy and files* section naming where files live. Neither says this directory grows without limit, which a user would want to know before it is 1.3 GB.
