import { app, BrowserWindow, type WebContents } from 'electron'
import { appendFileSync } from 'node:fs'

/**
 * PROBE ONLY (`probe/desk-recorder`, `bug-e2e-takes-the-desk`). Never merge.
 *
 * **What two baseline runs could not do.** Runs 3 and 4 counted activations — 1
 * and 0 — and neither could say what caused the one. Run 3 attributed it by
 * arithmetic over cumulative durations and named a spec that run 4 then cleared.
 * A third count would be a third number. The thing that turns a sighting into
 * an attribution is a recording of the app's own calls, timestamped, which is
 * what found the original seven and named both of their causes.
 *
 * So this wraps every call that can bring an app forward on macOS and appends a
 * line per call with a wall clock and the caller's own stack. `showInactive` is
 * recorded too, even though it is the desk-safe one: knowing the harness took
 * the safe path is a different fact from nothing having happened, and a silence
 * that fits both is the thing this card keeps tripping over.
 *
 * It is gated on `OBSRV_DESK_RECORD` holding a path, so an unset environment
 * leaves every wrapper uninstalled.
 */
const dest = process.env['OBSRV_DESK_RECORD'] ?? ''

/** One JSONL line. Sync on purpose: a buffered write can lose the last call before an exit. */
function note(kind: string, detail: string, depth = 3): void {
  const stack = (new Error().stack ?? '')
    .split('\n')
    .slice(depth, depth + 4)
    .map(l => l.trim().replace(/^at /, ''))
    .join(' <- ')
  try {
    appendFileSync(dest, `${JSON.stringify({ t: new Date().toISOString(), pid: process.pid, kind, detail, stack })}\n`)
  } catch {
    // A recorder that throws would change what it is measuring.
  }
}

/** Wraps one method on an object, keeping its return value and `this`. */
function wrap<T extends object>(target: T, name: keyof T & string, label: string): void {
  const original = target[name]
  if (typeof original !== 'function') return
  ;(target as Record<string, unknown>)[name] = function patched(this: unknown, ...args: unknown[]): unknown {
    note(label, args.length > 0 ? JSON.stringify(args).slice(0, 120) : '')
    return (original as (...a: unknown[]) => unknown).apply(this, args)
  }
}

export function installDeskRecorder(): void {
  if (dest === '') return
  note('recorder-installed', process.argv.slice(1).join(' ').slice(0, 200), 3)

  // The window-level calls. `show` and `focus` activate the app on macOS;
  // `moveTop` and `restore` can; `showInactive` is the one that should not, and
  // is recorded so its absence and its use are distinguishable.
  for (const m of ['show', 'showInactive', 'focus', 'moveTop', 'restore', 'setAlwaysOnTop'] as const) {
    wrap(BrowserWindow.prototype as unknown as Record<string, unknown>, m, `win.${m}`)
  }

  // `app.focus({ steal })` is the app-level one, refused on macOS 14+ unless the
  // front app yields — recorded because a refused call still says somebody asked.
  wrap(app as unknown as Record<string, unknown>, 'focus', 'app.focus')

  // `webContents.focus()` focuses the OWNING WINDOW on macOS, which activates
  // the app — that was six of the original seven, via `Overlay.show`. There is
  // no exported prototype to patch, so each instance is patched as it is made.
  app.on('web-contents-created', (_e, contents: WebContents) => {
    wrap(contents as unknown as Record<string, unknown>, 'focus', 'webContents.focus')
  })

  // Ground truth from the app's own side, to sit beside the `lsappinfo` watcher:
  // if these fire with no wrapped call before them, the cause is not a call the
  // app made, which is exactly what run 4 left open.
  app.on('did-become-active', () => note('EVENT did-become-active', '', 2))
  app.on('browser-window-focus', () => note('EVENT browser-window-focus', '', 2))
  app.on('activate', () => note('EVENT activate', '', 2))
}
