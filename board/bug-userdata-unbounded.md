---
title: "userData grows without bound — 1.3 GB, 94% of it Chromium cache"
column: review
kind: bug
owner: "Kenya"
order: 29
---

ROUTED TO KENYA 2026-09-15, pending Opeyemi's word in Kenya's own session. Left in Next until he says go.

**Chosen because the card's centre is a genuine unknown rather than a known fix waiting to be typed**, which is what Kenya asked for: *whether these caches make repeat measurements of the same page faster or more consistent.* Nobody has measured it, the obvious fix is a cap, and a cap is wrong if the cache is load-bearing.

**THE CACHE CONFOUND I PUT HERE IS REFUTED. Kenya measured it 2026-09-15, and the reason is structural rather than statistical, which is the strongest kind of no.**

What I claimed: B5 was downgraded to *"met on one desk, and a second desk disagrees"* — 0 result fields moved on this laptop, 4 on CI — and I proposed that the two desks differ in cache state as well as in speed, CI being cold and this laptop carrying 1.3 GB of warm cache. A guess with a mechanism, at the weight the margin hypothesis had before it died.

It cannot happen, and nothing about run counts was needed to see it. `bin/obsrv.js:67` creates a throwaway user-data directory per invocation (`mkdtempSync(tmpdir(), 'obsrv-cli-')`), sets `OBSRV_CLI_USER_DATA`, and deletes it on exit; `src/cli/main.ts:1530` honours it. **Every CLI run is a cold profile by construction.** The 1.3 GB this card is about is the GUI app's, and the B5 sweep never touches it. Kenya's measurement agrees: app `Cache` 936,476 KB before and after a CLI audit, mtime unchanged, zero `obsrv-cli-*` directories left behind.

**And a second, independent reason, which Kenya found in his own instrument:** the B5 fixture server sends `cache-control: no-store`. Even given a persistent profile, nothing would have been cached. In Kenya's words — *"I built one of them myself without noticing."*

Both desks were cold. **B5's desk disagreement stays attributed where it is**, to speed, and `ci-second-host` needs no confound note; it never got one.

**What this does NOT settle, and the card's actual centre, which survives intact:** whether these caches make repeat measurements of the same page faster or more consistent. The refutation narrows that question rather than answering it — if the CLI never uses the persistent profile, the load-bearing question is about the *app*, and it cannot be answered by the B5 sweep as it stands. It needs the cache switched on deliberately.

Kenya has built exactly that: `--profile` and `--cacheable`, three arms — cold, persistent-only, persistent+cacheable — five runs each. **With a vacuity check, which is the part worth copying:** if the warm profile directory does not grow, it reports that the experiment did not run, rather than reporting no effect. A persistent-profile arm that silently cached nothing would produce "no difference" and "nothing was measured" as the same output, and that is this project's recurring defect in its purest form.

**The shape of my error, since it is the one the board keeps re-learning.** I reasoned about the cache from `du` output and two desks' hardware, and never asked what profile the measurement actually ran in. The answer was two lines of code away and would have killed the hypothesis before it reached a card. A difference between two environments is not a variable in your experiment until you have checked that your experiment is in those environments.

**The documentation half is separable and cheap:** neither `docs/limitations.md` nor the README's *Privacy and files* section says this directory grows without limit, which a user would want to know before it is 1.3 GB. That can ship whatever the measurement finds.

Measured by Rook 2026-09-14 on this machine's real profile while scoping A4.

    ~/Library/Application Support/Obsrv    1.3 GB total
      Cache                                936 MB
      Code Cache                           338 MB

Nothing prunes either. They are Chromium's own caches for every page Obsrv has ever rendered, and Obsrv renders arbitrary third-party pages by design — so this grows with use in a way an ordinary app's does not, and faster for the people who use the tool most.

**Filed separately from A4 deliberately.** A4 asks what an install leaves behind after an uninstall; this is what normal USE accumulates while the tool is working correctly. Folding it into A4 would let a criterion about residue absorb a defect about growth, and the two have different fixes and different urgency. A4's own residue finding — the 128 MB Electron zip in `~/Library/Caches/electron/` that survives `npm rm -g getobsrv` — stays on A4, because that one genuinely is uninstall residue.

What is NOT yet known, and should be established before choosing a fix, because the obvious fix is a cap and the obvious cap is wrong if the cache is load-bearing: whether these caches make repeat measurements of the same page faster or more consistent. Obsrv's whole product is that two measurements of the same page agree (B5), so a cache that quietly improves repeatability is not free to delete. Measure the effect on a repeat snap before capping anything.

The related limits question: `docs/limitations.md` says what Obsrv cannot measure and `README.md` has a *Privacy and files* section naming where files live. Neither says this directory grows without limit, which a user would want to know before it is 1.3 GB.

---

**DELIVERED 2026-09-15 by Kenya, into Review. Branch `fix/userdata-cache-bound`. NOT merged, NOT pushed — waits on Opeyemi's word given to Kenya directly.**

**THE CONFOUND IS DEAD, AND STRUCTURALLY RATHER THAN STATISTICALLY.** `bin/obsrv.js` creates a throwaway user-data dir per invocation and deletes it afterwards, and `src/cli/main.ts:1537` deletes it again in-process for direct invocations. So EVERY headless CLI run is cold by construction, on any desk. Measured rather than read off the source:

    app Cache before a CLI audit   936,476 KB   mtime 1787493638
    app Cache after                936,476 KB   mtime 1787493638
    obsrv-cli-* dirs left behind   0

The B5 fixture sweep never touched the 1.3 GB — that is the APP's profile. Both desks were cold, so `ci-second-host`'s desk attribution is NOT confounded this way and needs no correction.

A second, independent reason it could not have been the variable, and this one was mine: the sweep's fixture server sends `cache-control: no-store`. A cache cannot warm on responses it is forbidden to keep. Two blocks on the same hypothesis, one of them built by the person testing it.

**IS THE CACHE LOAD-BEARING? NO — measured, five cold/warm pairs.** Clearing `Cache`, `Code Cache` and the WebGPU cache and relaunching between rounds, then one cold measurement and two warm ones per round, on berkshirehathaway.com (B5's own static site, so movement is the cache rather than the page):

    load    cold 51, 53, 51, 180, 52 ms      warm 37, 38, 38, 37, 38 ms
    audit   cold ~265 ms                     warm ~265 ms
    result fields moved, warm or cold        0, every round

A warm cache buys ~14 ms of load and changes nothing that is measured. **So the cap is chosen against disk space, not against repeatability** — which is the order the card asked for and the reason it could not be decided from the armchair.

**THE FIX:** `--disk-cache-size` at 256 MiB (`src/main/index.ts`). `Code Cache` is Chromium's own and has no such switch, so the directory still grows — bounded where it was worst (915 MB of 1.3 GB), not everywhere. Said plainly in both docs rather than implied.

**THE CAP WAS VERIFIED BINDING, AND THE FIRST VERIFICATION WAS A COINCIDENCE I NEARLY KEPT.** Same page, five loads each:

    cap 1 MiB     -> cache 1032 KB     read as "pinned at the ceiling". IT WAS NOT.
    cap 256 MiB   -> cache  948 KB     the page only ever produces ~950 KB
    cap 128 KiB   -> cache  140 KB     the switch binds, 7x smaller on identical work

The 1 MiB arm was never constrained by its own cap; two unbound numbers landed either side of it and I read the one above as proof. A test whose control is not bound by the thing under test can only produce a coincidence, and this one pointed the way I wanted. The 128 KiB arm is the real evidence, and it exists because I ran a control.

**DOCUMENTED** in both places the card named: README *Privacy and files* and `docs/limitations.md`, each with the measurement and with what it does not cover — a heavy page with many assets, where the saving is presumably larger and where nobody has measured whether repeatability depends on the cache. Real sites move on their own, which is what makes that harder than it sounds.

**VERIFIED:** typecheck clean across all three configs; unit 1171 passed in 67 files; the app builds and runs with the switch in the built output.

