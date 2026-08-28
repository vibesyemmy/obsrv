# Obsrv — a draggable split between the panes

**Date:** 2026-08-28
**Status:** Approved 2026-08-28
**Extends:** `2026-08-23-obsrv-ui-style.md` (neutrality, the pane frame) and
`2026-08-27-obsrv-toolbar-design.md` (the solo-target view).

## The problem

The two panes are pinned at 50/50 by `.pane { flex: 1 1 50% }`. That is the wrong
fixed ratio for most of the work the app is for:

- A phone preset renders small. Half a 1600px window is mostly empty surround while
  the native pane — which the user is not studying — takes the other half.
- A 1920-wide desktop preset at 1:1 overflows half a window badly, so the user pans
  around a keyhole while half the screen shows a reference they only glance at.

Solo target (`Both | Target`) is the existing escape hatch, but it is all-or-nothing:
it removes the reference entirely. The middle ground — "keep both, give the target
70%" — has no expression.

## Design

A draggable divider on the seam between the panes.

### State

`split: number` on `Settings`, the native pane's share of the row, default `0.5`.

**A ratio, not a pixel width.** A stored width would be wrong the moment the window
changed size; a ratio survives resize, and survives moving the window to a different
monitor.

**Persisted**, unlike `viewMode` and `panes`. Those are per-look: what you want to see
of *this page, right now*. A split is about the monitor you own and the way you like
to work, which is the same class of thing as `hostDiagonalInches` — so it lives in
`Settings` beside it and is restored at launch.

### Clamping, in two places for two reasons

`loadSettings` clamps to a loose sanity band (`0.1`–`0.9`), defaulting to `0.5` when
the key is absent or not a finite number, exactly as the other fields do. This guards
against a hand-edited or corrupt file, nothing more.

The drag clamps against the **live pane width** to a `MIN_PANE_PX` of 240 a side. This
is the clamp that matters: a ratio that is comfortable on a 2560px monitor can crush a
pane to nothing at the 900px window minimum, so the pixel floor has to be enforced
where the pixels are known. A persisted ratio outside what the current window can honour
is applied as close as the floor allows, and is not written back — resize the window
and the original preference returns.

### The divider

`role="separator"`, `aria-orientation="vertical"`, `tabindex=0`, with
`aria-valuenow` / `aria-valuemin` / `aria-valuemax` carrying the percentage.

- **Visually a 1px hairline**, unchanged from today's `.target-pane` left border — the
  style spec forbids decorating anything touching a pane.
- **A 6px hit target** straddling it, so it grabs like a real handle without looking
  like one. `cursor: col-resize`.
- **Hover and focus** brighten the hairline to `--text-1`, the same neutral weight the
  pane frame already uses for keyboard focus. No hue.
- **Arrow keys** nudge by 2% a press, Shift+arrow by 10%, so the split is reachable
  without a pointer.
- **Double-click resets to 50/50.** The reset is the only affordance that needs no
  discovery: a user who drags too far can always get back.
- **Absent in solo target.** With `panes === 'target'` there is nothing to divide, and
  a separator with one side would be a lie.

### The drag, and the risk it carries

The native pane is an OS-level `WebContentsView`, not DOM. A pointer that travels over
it delivers no events to the renderer — the same constraint that forced the overflow
menu to open rightward and made a `mousedown` dismissal insufficient.

A resize drag should not hit this, because of where the pointer sits: the divider is
the seam, and main keeps the native view's right edge on the seam, so the pointer
tracks the boundary rather than crossing into the view. `NativeSlot`'s existing
ResizeObserver reports the new bounds on every frame of the drag, so main follows
without new plumbing.

But "should not" is not "does not", and one dropped frame puts the cursor over the
view. **An e2e test drags the divider leftward across a meaningful distance and asserts
the split actually followed the pointer to the end**, rather than stalling partway. If
it stalls, the fallback is to hide the native view for the duration of the drag via the
existing `setNativeVisible` and restore it on release — the pane shows surround while
dragging, which is ugly but correct. The test decides; no guessing.

### What follows for free

`targetBounds` and `canvasBounds` are already ResizeObserver-driven, so the
agent-control capture crop tracks the new geometry with no change. The centring rule
added in `ac7a304` means a render that fits stays centred in whatever width its pane
now has.

## Out of scope

Horizontal splitting (stacked panes), remembering a different split per preset, and
exposing `split` on the agent-control surface. An agent that wants more room for the
target already has `panes: 'target'`, which is a better answer than a ratio.

## Test plan

- The divider drags, and the panes' widths change to match.
- The drag survives crossing over the native pane (the risk above).
- Neither pane can be dragged below 240px.
- Double-click restores 50/50.
- Arrow keys move the split.
- The ratio persists: set it, relaunch, it is still there.
- A corrupt or out-of-band `split` in the settings file loads as `0.5`.
- No divider is rendered in solo target.
