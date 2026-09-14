---
title: "Calibrate thin text: sweep 12 / 14 / 16 device px against real pages"
column: done
kind: chore
criterion: B3
owner: "obsrv-a6"
order: 26
---

Swept 9 sites x 2 presets x 5 thresholds (90 runs). At 14 the rule fires on 1 of 9 sites; findings cluster at 8-11px weight 300 with nothing between 12 and 14, so 12-15 are the same answer. 2x is zero everywhere by arithmetic. The prediction that this would be B4's largest noise source was wrong and docs/thresholds.md now says so. linear.app crosses between 14 and 16 — the plateau is stripe's, not the web's. Merged d32952f.
