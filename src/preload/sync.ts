import { ipcRenderer } from 'electron'
import type { IPC } from '../shared/ipc'
import type { ScrollPos } from '../shared/types'

/**
 * Injected into both page webContents — the native pane and the offscreen
 * target — so their scroll offsets track each other. Nothing is exposed to
 * the page: the listener lives in the isolated world and only `ipcRenderer`
 * is touched, so a third-party page cannot reach this channel.
 *
 * Only `window` scrolling is mirrored; nested scroll containers are out of
 * scope for v1.
 *
 * This file must not share a runtime module with `app.ts`: the two preloads
 * are entries of one Rollup build, and anything they both import is split into
 * `out/preload/chunks/`, which a sandboxed preload's `require` cannot load
 * (it resolves only `electron` and a few builtins). The channel names are
 * therefore literals here, pinned to `IPC` by `satisfies` so a rename fails
 * `typecheck` instead of silently cutting the bus.
 *
 * Echo control is a short time window rather than a boolean flag: a
 * programmatic `scrollTo` that lands where the page already is fires no scroll
 * event at all, which would leave a flag stuck and swallow the next real
 * scroll. A window always expires. Inside it, reports are deferred to its end
 * rather than dropped, so a real scroll that happens just after an applied
 * one is delayed, never lost. Behind the window the last applied position is
 * remembered too: a scroll event that arrives late but reports exactly what
 * the other pane sent is still an echo, not news. That memory is dropped as
 * soon as a different position is reported, so scrolling away and back to
 * that spot is reported like any other move.
 */
const SUPPRESS_MS = 120

const SYNC_SCROLL = 'obsrv:sync-scroll' satisfies typeof IPC.syncScroll
const APPLY_SCROLL = 'obsrv:apply-scroll' satisfies typeof IPC.applyScroll

let suppressUntil = 0
let lastApplied: ScrollPos | null = null
let rafId = 0
let deferred: ReturnType<typeof setTimeout> | null = null

function report(): void {
  rafId = 0
  const remaining = suppressUntil - performance.now()
  if (remaining > 0) {
    if (deferred === null) {
      deferred = setTimeout(() => {
        deferred = null
        report()
      }, remaining)
    }
    return
  }
  const x = window.scrollX
  const y = window.scrollY
  if (lastApplied && lastApplied.x === x && lastApplied.y === y) return
  lastApplied = null
  ipcRenderer.send(SYNC_SCROLL, { x, y })
}

window.addEventListener(
  'scroll',
  () => {
    // Coalesce a burst of scroll events into one report per frame.
    if (rafId !== 0) return
    rafId = requestAnimationFrame(report)
  },
  { passive: true },
)

ipcRenderer.on(APPLY_SCROLL, (_e, pos: ScrollPos) => {
  lastApplied = pos
  if (window.scrollX === pos.x && window.scrollY === pos.y) return
  suppressUntil = performance.now() + SUPPRESS_MS
  window.scrollTo(pos.x, pos.y)
})
