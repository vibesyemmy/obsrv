import { ipcRenderer } from 'electron'
import type { IPC } from '../shared/ipc'
import type { ScrollPos } from '../shared/types'

/**
 * Injected into both page webContents — the native pane and the offscreen
 * target — so their scroll offsets track each other. Nothing is exposed to
 * the page: the listener lives in the isolated world and only `ipcRenderer`
 * is touched, so a third-party page cannot reach this channel.
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
 * scroll. A window always expires.
 */
const SUPPRESS_MS = 120

const SYNC_SCROLL = 'obsrv:sync-scroll' satisfies typeof IPC.syncScroll
const APPLY_SCROLL = 'obsrv:apply-scroll' satisfies typeof IPC.applyScroll

let suppressUntil = 0
let rafId = 0

function report(): void {
  rafId = 0
  if (performance.now() < suppressUntil) return
  ipcRenderer.send(SYNC_SCROLL, { x: window.scrollX, y: window.scrollY })
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
  if (window.scrollX === pos.x && window.scrollY === pos.y) return
  suppressUntil = performance.now() + SUPPRESS_MS
  window.scrollTo(pos.x, pos.y)
})
