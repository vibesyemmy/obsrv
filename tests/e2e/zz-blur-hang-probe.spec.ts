import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, openSettings, rendererWindow } from './launch'

/**
 * THROWAWAY — `bug-controls-blur-timeout`, on `probe/blur-hang`. Never merged.
 *
 * The card's standing ask is **a deterministic trigger**, not more samples: the
 * failure has been seen once in ~591 CI runs, so a green loop of any affordable
 * length says almost nothing (the power table on the card). What is known is
 * narrow and useful:
 *
 * - `locator.blur()` is `evaluateInUtility(… injected.blurNode(node))`, so the
 *   30 s timeout is **an evaluate that never returned**, not a missing element.
 * - the call log shows the locator resolving once and then silence, which
 *   points at the evaluate rather than at the retry loop.
 * - `sendSync` appears nowhere in `src/`, so a synchronous IPC in blur→commit
 *   is already excluded.
 *
 * **The candidate this probe tests** comes from the app rather than from
 * Playwright: the blur commits `hostDiagonalInches`, which changes
 * magnification and resizes the target's offscreen surface, and this repo
 * documents the OSR renderer segfaulting (`targetSource.ts:223`, "exit 11") and
 * handles `render-process-gone` for it (`:474`). A dead OSR renderer or a GPU
 * process death is also the known shape behind "blank target + No frames".
 *
 * So: **does a target-renderer death at commit time make a blur on the SHELL
 * renderer hang?** The two are different processes, and the honest prior is
 * that it should not. Arm 1 exists so a null result means something.
 */
let app: ElectronApplication
let page: Page

const storedSettings = () => page.evaluate(() => (window as { obsrv?: { getSettings(): unknown } }).obsrv?.getSettings())

test.describe.configure({ mode: 'serial', timeout: 180_000 })

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
})

test.afterAll(async () => {
  await app?.close()
})

/** Blurs the field and says how long it took, or that it timed out. */
const timedBlur = async (label: string, prefilled = false): Promise<void> => {
  const field = page.locator('.host-diagonal')
  // A blocked renderer would hang the fill as readily as the blur, and then
  // the arm would be about the wrong call. Arm 3 fills before it blocks.
  if (!prefilled) await field.fill('32')
  const t0 = Date.now()
  let verdict = 'returned'
  try {
    await field.blur({ timeout: 15_000 })
  } catch (e) {
    // The whole message, not its first line: the card's evidence about the CI
    // failure IS the call log ("locator resolved to <input …/>", then silence),
    // so a signature match has to be compared line for line.
    const msg = e instanceof Error ? e.message : String(e)
    verdict = `THREW:\n${msg.split('\n').slice(0, 10).map(l => `        ${l}`).join('\n')}\n     `
  }
  console.log(`  BLUR ${label.padEnd(22)} ${verdict}  in ${Date.now() - t0}ms`)
}

test('ARM 1 (control): a blur returns when nothing is wrong', async () => {
  await openSettings(page, 'display')
  await timedBlur('baseline')
  // Without this the other arms are unreadable: a probe that has never shown a
  // blur succeeding cannot report one failing.
  expect(await storedSettings()).toMatchObject({ hostDiagonalInches: 32 })
})

test('ARM 2: the target OSR renderer dies immediately before the blur', async () => {
  await openSettings(page, 'display')
  await page.fill('.host-diagonal', '27')
  await page.press('.host-diagonal', 'Enter')

  // Crash it, then WAIT FOR IT TO BE DEAD before blurring. The first version
  // of this arm blurred 4 ms after asking, which is almost certainly before
  // the process had gone — a condition that was never applied, which is the
  // vacuity this whole card family is about.
  const killed = await app.evaluate(async () => {
    const h = (globalThis as { __obsrv?: { target?: { webContents: Electron.WebContents } } }).__obsrv
    if (h?.target === undefined) return 'no target'
    const wc = h.target.webContents
    const gone = new Promise<string>(resolve => {
      wc.once('render-process-gone', (_e, d) => resolve(`gone: ${d.reason}`))
      setTimeout(() => resolve('NO render-process-gone within 10s'), 10_000)
    })
    wc.forcefullyCrashRenderer()
    return await gone
  })
  console.log(`  ARM 2  target renderer: ${killed}`)
  await timedBlur('after OSR crash')
})

test('ARM 3: the shell renderer is busy for longer than the blur budget', async () => {
  await openSettings(page, 'display')
  // The other shape an evaluate that never returns can have: the renderer's
  // main thread is occupied, so the utility world never gets to run. This is
  // not a claim that the app does this — it is the positive control for the
  // SIGNATURE, so arm 2's result can be compared against a hang that is known
  // to be one.
  //
  // Started WITHOUT awaiting, so the renderer is already inside the loop when
  // the blur is sent. The first version scheduled the block on a 100 ms timer
  // and the blur beat it by 96 ms, so the arm "passed" having tested nothing.
  await page.fill('.host-diagonal', '32')
  const blocking = page
    .evaluate(() => {
      const until = Date.now() + 20_000
      while (Date.now() < until) {
        /* deliberately blocking the renderer's main thread */
      }
    })
    .catch(() => undefined)
  await page.waitForTimeout(250)
  await timedBlur('while main thread busy', true)
  await blocking
})

test('ARM 4: the block starts INSIDE the blur handler, which is where the call log points', async () => {
  await openSettings(page, 'display')
  // Arm 3 hangs one step too early: with the main thread already blocked the
  // locator never resolves, and its call log says "waiting for locator". The
  // recorded CI failure RESOLVED — `locator resolved to <input …
  // class="host-diagonal num"/>` — and then went silent, so at that moment the
  // renderer was answering. The block, if it is one, began between the resolve
  // and the evaluate's return.
  //
  // `blurNode` fires the element's own blur/focusout handlers synchronously, so
  // a handler that does not return is exactly that shape — and it is the shape
  // the app's own `onBlur` → `commit()` → `onCommit` chain occupies.
  await page.fill('.host-diagonal', '32')
  await page.evaluate(() => {
    const el = document.querySelector('.host-diagonal')
    el?.addEventListener(
      'blur',
      () => {
        const until = Date.now() + 20_000
        while (Date.now() < until) {
          /* a blur handler that does not return */
        }
      },
      { once: true },
    )
  })
  await timedBlur('block inside blur handler', true)
})

test('ARM 5: can the failure report itself? `unresponsive` fires from OUTSIDE the stuck renderer', async () => {
  await openSettings(page, 'display')
  // Henry's suggestion was to time the handler from inside — `performance.now()`
  // at blur entry and exit. **That instrument cannot fire on this failure:** a
  // handler that never returns never reaches its exit line, and a blocked main
  // thread runs no timer, no microtask and no console flush that could carry a
  // partial reading out. Nothing inside a stuck renderer can report that it is
  // stuck.
  //
  // Electron's `unresponsive` is the same observation made from the main
  // process, which is not blocked. So the question is whether it fires on the
  // signature arm 4 reproduces — and that is checkable, rather than assumable.
  const armed = await app.evaluate(async () => {
    const h = (globalThis as { __obsrv?: { win?: Electron.BrowserWindow } }).__obsrv
    if (h?.win === undefined) return false
    const g = globalThis as { __blurProbeEvents?: string[] }
    g.__blurProbeEvents = []
    h.win.on('unresponsive', () => g.__blurProbeEvents?.push(`unresponsive @${Date.now()}`))
    h.win.on('responsive', () => g.__blurProbeEvents?.push(`responsive @${Date.now()}`))
    return true
  })
  expect(armed, 'no window to watch').toBe(true)

  await page.fill('.host-diagonal', '32')
  await page.evaluate(() => {
    document.querySelector('.host-diagonal')?.addEventListener(
      'blur',
      () => {
        const until = Date.now() + 20_000
        while (Date.now() < until) {
          /* the same block arm 4 uses, so this is the same failure */
        }
      },
      { once: true },
    )
  })
  await timedBlur('with unresponsive watch', true)

  const events = await app.evaluate(() => (globalThis as { __blurProbeEvents?: string[] }).__blurProbeEvents ?? [])
  console.log(`  ARM 5  events: ${events.length === 0 ? 'NONE — the instrument is silent on this failure' : JSON.stringify(events)}`)
})

test('ARM 6: a main-process ping DOES see it, because main is not the thing that is stuck', async () => {
  await openSettings(page, 'display')
  // Arms 5 and Henry's suggestion are both silent, for two different reasons —
  // an in-handler timer never reaches its exit line, and `unresponsive` waits
  // on input acks that a CDP-driven blur never queues. What is left is the
  // main process asking the renderer a question on a timer and noticing when an
  // answer does not come back. Main is not blocked, so it can always report.
  await app.evaluate(async () => {
    const h = (globalThis as { __obsrv?: { win?: Electron.BrowserWindow } }).__obsrv
    if (h?.win === undefined) return
    const g = globalThis as { __pingLog?: string[]; __pingTimer?: NodeJS.Timeout }
    g.__pingLog = []
    const wc = h.win.webContents
    g.__pingTimer = setInterval(() => {
      const sent = Date.now()
      let answered = false
      void wc
        .executeJavaScript('1')
        .then(() => {
          answered = true
          const took = Date.now() - sent
          if (took > 1000) g.__pingLog?.push(`ping answered LATE after ${took}ms (sent ${sent})`)
        })
        .catch(() => undefined)
      setTimeout(() => {
        if (!answered) g.__pingLog?.push(`ping UNANSWERED after 1000ms (sent ${sent})`)
      }, 1000)
    }, 500)
  })

  await page.fill('.host-diagonal', '32')
  await page.evaluate(() => {
    document.querySelector('.host-diagonal')?.addEventListener(
      'blur',
      () => {
        const until = Date.now() + 20_000
        while (Date.now() < until) {
          /* the same block as arms 4 and 5 */
        }
      },
      { once: true },
    )
  })
  await timedBlur('with a main-process ping', true)

  const log = await app.evaluate(() => {
    const g = globalThis as { __pingLog?: string[]; __pingTimer?: NodeJS.Timeout }
    if (g.__pingTimer) clearInterval(g.__pingTimer)
    return g.__pingLog ?? []
  })
  console.log(`  ARM 6  ping log: ${log.length} entries`)
  for (const l of log.slice(0, 4)) console.log(`         ${l}`)
  // This is the arm with a verdict in it: if the ping never misses, there is no
  // instrument here either and the card must say the failure is unobservable
  // from every side tried.
  expect(log.length, 'a stuck renderer that answers every ping would mean this instrument is useless too').toBeGreaterThan(0)
})
