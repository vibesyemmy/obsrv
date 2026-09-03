# Throttling

```
obsrv snap|diff|audit|report <url> --throttle budget-phone
obsrv_snap / obsrv_diff / obsrv_audit / obsrv_report { throttle: 'budget-phone' }
obsrv_presets → throttles
```

A page that paints in a second on a laptop over fibre can take seven on a
budget phone over 3G, and nothing in a screenshot says which. `--throttle`
renders the page under Chrome DevTools' network and CPU presets and puts
one number in the JSON: `settledMs`, the time from the start of navigation
to the page going paint-quiet. Cheap screens come with cheap CPUs and bad
networks; this is how the page *feels* on them.

## Presets

| id | Network | CPU | DevTools name |
| --- | --- | --- | --- |
| `none` | as the host | as the host | — |
| `fast-4g` | 4 Mbps down, 3 Mbps up, 20 ms | — | Fast 4G |
| `slow-4g` | 1.6 Mbps down, 750 Kbps up, 150 ms | — | Slow 4G |
| `3g` | 400 Kbps each way, 400 ms | — | 3G |
| `cpu-4x` | — | 4× slower | mid-tier mobile |
| `cpu-6x` | — | 6× slower | low-end mobile |
| `mid-phone` | Slow 4G | 4× | — |
| `budget-phone` | 3G | 6× | — |

The figures are DevTools' nominal ones, so a developer who has used
"Slow 4G" there gets the same thing here. The two phone composites are
the ones worth reaching for: `budget-phone` beside the `android-65`
screen is the worst realistic case a page will meet.

## What it measures

`settledMs` runs from the navigation to the moment the page has stopped
painting (the same paint-quiet detection every capture uses, quiet window
included), with `--wait` taken back out since that is time the caller
added. Null when the page never settled within `--timeout`, and `settled`
is false then too. It is a wall-clock number on the machine running
Obsrv: compare it against a `--throttle none` run of the same page on
the same machine, not against a number from somewhere else.

`snap` and `report` (per screen) carry it. `audit` measures layout, not
paint, so it carries the `throttle` only. `diff` applies the throttle to
both renders and says nothing about it in its JSON.

## The flag decides the keys

Without `--throttle` the JSON is exactly what it was: the flagless snap
object is a published contract. With it — `--throttle none` included —
`throttle` and `settledMs` appear. That is what makes a baseline
something you ask for by name rather than something every run pays for.

## How it is applied

Through Chromium's debugger on the target, exactly as DevTools does it:
`Network.emulateNetworkConditions` for the network and
`Emulation.setCPUThrottlingRate` for the CPU, attached before the load so
the page fetches and runs under the conditions from its first byte. A
window a density change swaps in gets them again. If Chromium refuses —
another debugger already on the target, say — the render still happens
and a warning says the throttle was not applied.

Headless only for now: the CLI and the tools. Live drive would take the
same call on the app's target and is a small follow-up if agents ask for
it.
