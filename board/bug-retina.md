---
title: "fit-cap and onion-skin fail rather than skip when the desk scales the capture"
column: done
kind: bug
owner: "Kenya"
order: 24
---

MERGED 2026-09-14 on Opeyemi's word, as 98d3f82 on main, pushed. Verified by Henry before pushing rather than taken on the branch's own report: npm run typecheck clean across all three configs (tsconfig.node / web / mcp — the single-config shortcut is what let a red commit reach main earlier this week), and fit-cap + onion-skin 7 passed, 16.9 s, matching Kenya's 16.3 s.

WHAT IS AND IS NOT PROVEN AFTER THE MERGE. Henry first wrote that his run exercised only `skip false` and that Kenya's forced-scale run was the evidence for the other direction. Kenya corrected that as too generous and it is; the corrected version, checked against docs/e2e-flakes.md rather than argued:

(a) PROVEN, physically, 2026-09-12: the three assertions FAIL on a real 2x main display. The flakes doc records it — external monitors disconnected, the Mac on its built-in Liquid Retina XDR alone (3024x1964, 2x), three runs in a row red, while the same commit's CI on macos-14 passed the whole suite.
(b) PROVEN, synthetically, today: with --force-device-scale-factor=2 the probe returns 2 and the predicate skips; plain launch returns 1 and it does not.
(c) NOT PROVEN, and it is the join between them: nobody has run captureScale() — written today — on a machine whose DISPLAY is 2x. The 09-12 observation predates the probe.

And (b) is weaker than it looks: --force-device-scale-factor forces the APP's scale, while the documented cause is the HOST DISPLAY's scale (e2e-flakes.md: capturePage answers at the host display's scale whatever the target's own density). Those are different knobs that happen to produce the same ratio, so (b) shows the arithmetic and the predicate agree — not that the probe reads a real 2x desk correctly.

HENRY'S AND KENYA'S GREEN RUNS ARE THE SAME EVIDENCE, NOT TWO. Both are 1x desks exercising `skip false`. Two sessions agreeing looked like corroboration and was one measurement taken twice — which is this project's agreement-fits-two-facts defect, arriving in the verification of the card that is about exactly this.

ONE RUN ON THE BUILT-IN DISPLAY ALONE closes (c), and the same run says whether onion-skin's 50% test belongs in the skip.

DELIVERED 2026-09-14 by Kenya, into Review. Branch `fix/retina-desk-skip` (as of 9fe0fda + 59b6097, cut from 2c7c0a9). THE BRANCH IS THE ADDRESS; the shas are a timestamp — Kenya rebases on request when main moves, and the content survives while the shas do not. NOT merged, NOT pushed. Opeyemi picked this card directly. MERGE THIS ONE FIRST — it makes every other local run cheaper to read; it shares no file with the C5 branch, so the two merge in either order and the sequencing is a choice rather than a constraint.

Touches docs/e2e-flakes.md, tests/e2e/fit-cap.spec.ts, tests/e2e/helpers/captureScale.ts, tests/e2e/onion-skin.spec.ts. fit-cap + onion-skin: 7 passed, 16.3 s. Typecheck clean.

A FLAKE FOUND, REMOVED, AND DELIBERATELY NOT FILED AS EXPLAINED (59b6097). After the rebase a three-spec run came back 51 passed, 1 flaky: fit-cap read a pane at 218 where the window's own size says 368 — a layout measured against a window still at its launch size, setContentSize(1900,1100) not yet landed. Kenya GUESSED contention from its own dev app, which docs/e2e-flakes.md documents as a known cause, then TESTED the guess rather than filing it: three runs with the dev app stopped, three with it running, all six passed. The documented cause is NOT this one, and an entry in the flakes doc saying otherwise would have been worse than no entry. Repeating the same three-spec shape gave 52 passed, no flake — one occurrence in two runs of that shape, none in six isolated. So 59b6097 polls the window's content size in beforeAll before anything reads a pane: it REMOVES the race and does not DIAGNOSE the failure, and the commit message says that in those words rather than claiming a fix.

STILL NOT VERIFIED, and it is the same shape as the resizing value on the C5 card: nobody has watched the skip fire on a real 2x desk. --force-device-scale-factor=2 is the same arithmetic, not the same machine. One run on the built-in display alone settles it — and that same run says whether onion-skin's 50% test belongs in the skip.

THE CARD'S PREMISE WAS WRONG AND THE CORRECTION MATTERS MORE THAN THE FIX. The three are PASSING on this machine. Kenya ran them before touching anything: fit-cap.spec.ts + onion-skin.spec.ts, 7 passed, 17.0 s, no skips. system_profiler says the main display is a 3440x1440 ultrawide at 1x — the external monitor is plugged back in. Henry verified independently: `UI Looks like: 3440 x 1440`, Main Display: Yes.

So `every local full run currently reports three failures` was true on 2026-09-12 and is NOT true today. The trio tracks WHAT IS PLUGGED IN, not which machine. Henry had been telling Opeyemi `they fail on this laptop and pass on CI`, which is the wrong axis and makes a green local run look like evidence the problem is gone. It is not.

THE FIX: both specs probe the desk once in beforeAll; the three assertions that read a scaled capture skip with the scale named in the reason. tests/e2e/helpers/captureScale.ts, modelled on helpers/deskState.ts. Never skips on CI.

The probe MEASURES rather than infers — capture the real window, divide by the size that window reports. Deliberately not a host list and not a `scaleFactor > 1` guess about displays, because what breaks the assertions is the CAPTURE, and that is directly observable.

VERIFIED BOTH DIRECTIONS, since a skip that never fires and a skip that always fires are identical in a green run:
• --force-device-scale-factor=2 → probe reports 2 → skip = true
• plain launch → probe reports 1 → skip = false
• fit-cap + onion-skin on this desk: 7 passed, no skips, 16.4 s
• typecheck clean

TWO THINGS LEFT UNDONE ON PURPOSE, both written into docs/e2e-flakes.md rather than a commit message:
1. onion-skin.spec.ts's 50% test also reads a captured pixel and was NOT skipped — it was not among the three observed red on 2026-09-12, and it should join them on an observation rather than on the symmetry.
2. A SKIP IS NOT A FIX. On a 2x desk those assertions still cannot run, so what they cover is unproven there. Making them desk-independent means comparing captures to each other or reading the frame bus.
