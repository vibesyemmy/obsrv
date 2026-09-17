import { test, type ElectronApplication } from '@playwright/test'
import { launchApp, rendererWindow } from './launch'

/**
 * PROBE, not a gate — `bug-canvas-blank-without-notice`.
 *
 * The question: does the renderer get animation frames on a CI runner, where
 * the window is shown but never activated? The canvas is drawn on an animation
 * frame, and Chromium fires none while a window is hidden or fully occluded —
 * which would explain a canvas that stays blank for ten seconds while main has
 * its frames and says nothing.
 *
 * **The vacuity arm comes first and is the point.** A count taken on a hidden
 * window MUST be about zero. Until it is, a healthy count from the shown window
 * proves nothing: it could be a probe that cannot see throttling at all.
 */

let app: ElectronApplication

const ticksOver = async (a: ElectronApplication, ms: number): Promise<number> => {
  const page = await rendererWindow(a)
  return page.evaluate(
    d =>
      new Promise<number>(resolve => {
        let n = 0
        const stop = Date.now() + d
        const step = (): void => {
          n++
          if (Date.now() < stop) requestAnimationFrame(step)
          else resolve(n)
        }
        requestAnimationFrame(step)
        // A window that never fires one would never resolve, so the count is
        // reported from a timer too — 0 is an answer, not a hang.
        setTimeout(() => resolve(n), d + 250)
      }),
    ms,
  )
}

test.beforeAll(async () => {
  app = await launchApp()
  await rendererWindow(app)
})
test.afterAll(async () => {
  await app.close()
})

test('PROBE: does the renderer get animation frames as the harness leaves the window', async () => {
  const shown = await ticksOver(app, 500)

  // THE VACUITY ARM. Hidden, the count must collapse; if it does not, this
  // probe cannot see throttling and the number above means nothing.
  await app.evaluate(() => (globalThis as { __obsrv?: { win: { hide: () => void } } }).__obsrv!.win.hide())
  await new Promise(r => setTimeout(r, 300))
  const hidden = await ticksOver(app, 500)

  await app.evaluate(() => (globalThis as { __obsrv?: { win: { showInactive: () => void } } }).__obsrv!.win.showInactive())
  await new Promise(r => setTimeout(r, 300))
  const again = await ticksOver(app, 500)

  console.log(
    `[raf-probe] ticks in 500 ms — as the harness leaves it: ${shown}; hidden: ${hidden}; shown again: ${again}\n` +
      `[raf-probe] the vacuity arm is 'hidden': it must be near zero, or the other two numbers are not evidence.`,
  )
})
