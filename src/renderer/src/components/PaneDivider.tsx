import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { SPLIT_MAX, SPLIT_MIN } from '../../../shared/presets'
import type { Settings } from '../../../shared/types'
import { useStore } from '../state/store'

/**
 * Neither pane may be dragged narrower than this. The `0.1`–`0.9` band on
 * `Settings.split` is only a sanity check on the file; this is the clamp that
 * matters, and it can only be enforced here, against the row's live width — a
 * ratio that is roomy on a 2560px monitor crushes a pane to nothing at the
 * 900px window minimum.
 *
 * `styles.css` needs the same number for the `clamp()` that keeps a *stored*
 * ratio the current window cannot honour off the floor, so `App` hands it
 * down as `--pane-min` rather than the two drifting apart.
 */
export const MIN_PANE_PX = 240

/** Arrow keys nudge by this; Shift+arrow by `KEY_STEP_COARSE`. */
const KEY_STEP = 0.02
const KEY_STEP_COARSE = 0.1

/**
 * The draggable seam between the panes (spec
 * `2026-08-28-obsrv-pane-split.md`). Visually the 1px hairline the target
 * pane used to draw as its own left border; the grab area is a pseudo-element
 * straddling it, so the handle is reachable without being drawn.
 *
 * The store's `setSettings` does no IPC, so the drag updates it on every
 * frame and persists exactly once, on release — a settings write per
 * `pointermove` would hammer the disk for a gesture that has one outcome.
 */
export function PaneDivider() {
  const split = useStore(s => s.settings.split)
  const ref = useRef<HTMLDivElement>(null)
  /**
   * The settings a gesture started from — what a rejected write rolls back
   * to — and where in the divider the pointer grabbed it, so the seam tracks
   * the pointer instead of jumping to it. Null when no drag is in flight.
   */
  const drag = useRef<{ before: Settings; grab: number } | null>(null)

  /**
   * The row's live geometry, in the units the drag needs: where the panes
   * start, how much width the two of them actually share (the seam takes its
   * own pixel), and the ratio band that leaves `MIN_PANE_PX` a side.
   *
   * The band is the pixel floor intersected with the file's sanity band, and
   * both edges are pulled to `0.5` if they would cross: a row too narrow for
   * two floors has no honest answer but an even one.
   */
  const geometry = (): { left: number; usable: number; min: number; max: number } => {
    const el = ref.current
    const row = el?.parentElement
    if (!el || !row) return { left: 0, usable: 1, min: 0.5, max: 0.5 }
    const r = row.getBoundingClientRect()
    const usable = Math.max(1, r.width - el.getBoundingClientRect().width)
    const floor = MIN_PANE_PX / usable
    return {
      left: r.left,
      usable,
      min: Math.min(Math.max(SPLIT_MIN, floor), 0.5),
      max: Math.max(Math.min(SPLIT_MAX, 1 - floor), 0.5),
    }
  }

  const clamp = (ratio: number): number => {
    const g = geometry()
    return Math.min(Math.max(ratio, g.min), g.max)
  }

  /** Moves the seam without touching disk; the store setter does no IPC. */
  const preview = (ratio: number): void => {
    const s = useStore.getState()
    const next = clamp(ratio)
    if (next === s.settings.split) return
    s.setSettings({ ...s.settings, split: next })
  }

  /**
   * The one write. Optimistic with rollback, exactly as the agent-control
   * toggle does it: the seam is already where the user let go, and a refusal
   * from main puts it back rather than leaving the two out of step.
   */
  const persist = (before: Settings): void => {
    const now = useStore.getState().settings
    if (now.split === before.split) return
    window.obsrv.setSettings(now).catch(() => useStore.getState().setSettings(before))
  }

  /** A discrete move — a key, a double-click — previews and persists at once. */
  const commit = (ratio: number): void => {
    const before = useStore.getState().settings
    preview(ratio)
    persist(before)
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    // Without this the gesture starts a text selection across both panes.
    e.preventDefault()
    const el = e.currentTarget
    // Capture first: the pointer is about to travel over the native pane,
    // which is an OS-level view and delivers nothing to this document. With
    // the pointer captured every move is ours wherever it lands.
    el.setPointerCapture(e.pointerId)
    drag.current = {
      before: useStore.getState().settings,
      grab: e.clientX - el.getBoundingClientRect().left,
    }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d) return
    const g = geometry()
    preview((e.clientX - d.grab - g.left) / g.usable)
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d) return
    drag.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
    persist(d.before)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = e.shiftKey ? KEY_STEP_COARSE : KEY_STEP
    const delta = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
    if (!delta) return
    // Arrow keys scroll the pane under this otherwise.
    e.preventDefault()
    commit(useStore.getState().settings.split + delta)
  }

  return (
    <div
      ref={ref}
      className="pane-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Pane split"
      tabIndex={0}
      // The file's band, not the row's: this is the range the value is
      // defined over. What the current window can honour is narrower and
      // changes with every resize, which is not a range worth announcing.
      aria-valuenow={Math.round(split * 100)}
      aria-valuemin={Math.round(SPLIT_MIN * 100)}
      aria-valuemax={Math.round(SPLIT_MAX * 100)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      // The only affordance that needs no discovery: a user who drags too far
      // can always get back.
      onDoubleClick={() => commit(0.5)}
      onKeyDown={onKeyDown}
    />
  )
}
