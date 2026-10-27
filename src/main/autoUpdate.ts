import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

/**
 * The download half of auto-update, layered onto `updateCheck.ts`'s existing
 * GitHub-releases poll rather than replacing it (see the update spec §10).
 * `checkForUpdate` still decides `available`/`current`/`error` and still
 * drives the daily throttle, the manual "Check now" button and the e2e suite
 * — none of that needed to change. This file only starts a real download
 * once that check already said `available`, using `electron-updater`'s own
 * `latest-mac.yml` feed (baked into the app bundle by electron-builder,
 * generated from the mac `zip` target added alongside the DMG).
 *
 * `autoDownload` stays off: electron-updater's own boot-time checks are not
 * what decides `available` here, so leaving it on would race a download
 * against our own check deciding there is nothing to download yet.
 */
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = false

export interface AutoUpdateHooks {
  onProgress: (percent: number) => void
  onDownloaded: () => void
  /** Logged, not surfaced: a background download failing leaves the last
   * check's state (`available`, with its manual Download link) standing,
   * same as any other case in updateCheck's error table. */
  onError: (message: string) => void
}

/**
 * A no-op everywhere but a packaged build: unpackaged, there is no
 * `app-update.yml` for electron-updater to read, and it throws rather than
 * reporting `error` the way `checkForUpdate` does — the same reason
 * `window.ts` and `overlay.ts` already guard on `app.isPackaged`.
 */
export function wireAutoUpdate(hooks: AutoUpdateHooks): void {
  if (!app.isPackaged) return
  autoUpdater.on('download-progress', p => hooks.onProgress(p.percent))
  autoUpdater.on('update-downloaded', () => hooks.onDownloaded())
  autoUpdater.on('error', e => hooks.onError(e instanceof Error ? e.message : String(e)))
}

/** Fire-and-forget, same as `checkForUpdate`'s own boot-time call: progress and failure arrive as events. */
export function startDownload(): void {
  if (app.isPackaged) void autoUpdater.downloadUpdate().catch(() => undefined)
}

/** No-op unpackaged, so an e2e click on a synthetic `downloaded` state cannot quit the test runner. */
export function quitAndInstall(): void {
  if (app.isPackaged) autoUpdater.quitAndInstall()
}
