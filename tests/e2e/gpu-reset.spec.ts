import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp, rendererWindow } from './launch'

/**
 * The GPU process dies in the field — a driver reset, a dock or display
 * change, memory pressure — and takes every WebGL context in the app with it.
 * Main's offscreen paint stream survives that on its own (a fresh GPU process
 * picks it up), but the target canvas is WebGL, and a canvas that loses its
 * context stops listening for frames. What followed was the failure this file
 * pins: a white pane, "No frames from target renderer" over a target that was
 * painting perfectly well, a Reload button that reloads the wrong thing, and
 * nothing short of a relaunch to clear it.
 *
 * Reproduced by killing the helper outright. Chromium restores a context after
 * one reset; a second inside about ten seconds of the first had it block WebGL
 * for the renderer's domain for the rest of the session, and Electron has no
 * API to lift that. The domain block is now switched off in main and the
 * canvas recovers on its own. Chromium's own limit is separate: after the
 * third crash of a session it gives up on the GPU, and the notice has to say
 * so instead of blaming the target.
 *
 * Crashes are counted per session, so the order below is the budget: two for
 * the burst, the third for the notice. Every canvas state is read from the
 * `data-gl` attribute the canvas maintains — asking `getContext` from here
 * would create a context on a canvas that has none.
 */

const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href
const TALL = pathToFileURL(resolve(__dirname, '../fixtures/tall.html')).href

let app: ElectronApplication
let page: Page
let appPid: number

/** The pid of the app's GPU helper, found by parentage, or null between two. */
function gpuHelper(): number | null {
  const rows = execSync('ps -axo pid,ppid,command').toString().split('\n')
  for (const row of rows) {
    const cols = row.trim().split(/\s+/)
    if (cols[1] === String(appPid) && row.includes('--type=gpu-process')) return Number(cols[0])
  }
  return null
}

/** Kills the GPU helper and waits until Chromium has spawned its replacement. */
async function resetGpu(): Promise<void> {
  const before = gpuHelper()
  expect(before, 'a GPU helper to kill').not.toBeNull()
  process.kill(before!, 'SIGKILL')
  await expect
    .poll(
      () => {
        const now = gpuHelper()
        return now !== null && now !== before
      },
      { timeout: 10_000 },
    )
    .toBe(true)
}

const glState = (): Promise<string | undefined> =>
  page.evaluate(() => document.querySelector<HTMLCanvasElement>('canvas.target-canvas')?.dataset.gl)

/** Grey-level statistics of the visible target canvas, from a compositor screenshot. */
async function canvasPixels(): Promise<{ distinct: number; total: number }> {
  const clip = await page.evaluate(() => {
    const c = document.querySelector('.target-pane canvas')!
    const r = c.getBoundingClientRect()
    const body = c.closest('.pane-body')!.getBoundingClientRect()
    const left = Math.max(r.left, body.left)
    const top = Math.max(r.top, body.top)
    const right = Math.min(r.right, body.right)
    const bottom = Math.min(r.bottom, body.bottom)
    return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
  })
  const png = await page.screenshot({ clip })
  return page.evaluate(async (b64: string) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    const greys = new Set<number>()
    for (let i = 0; i < d.length; i += 4) greys.add(d[i]!)
    return { distinct: greys.size, total: d.length / 4 }
  }, png.toString('base64'))
}

async function navigateTo(url: string): Promise<void> {
  await page.fill('.url-form input', url)
  await page.press('.url-form input', 'Enter')
  // Past the watchdog's window: a stall notice that was going to appear has.
  await new Promise(r => setTimeout(r, 3500))
}

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
  appPid = await app.evaluate(() => process.pid)
  await navigateTo(FIXTURE)
  await expect.poll(glState).toBe('ok')
})
test.afterAll(async () => {
  await app.close()
})

// GPU crashes arrive in bursts — the replacement process meets the same
// condition and dies too — and a second reset inside about ten seconds of
// the first is the one Chromium used to answer by blocking WebGL for the
// domain. The gap matters at both ends: spaced further apart the old code
// survived it, and a kill that lands before the renderer has reconnected to
// the replacement is only one loss from the renderer's side. A few seconds
// is the reproduction.
const BURST_GAP_MS = 3000

test('the target survives two GPU resets in quick succession', async () => {
  await resetGpu()
  await new Promise(r => setTimeout(r, BURST_GAP_MS))
  await resetGpu()
  await expect.poll(glState, { timeout: 15_000 }).toBe('ok')

  await navigateTo(TALL)
  await expect(page.locator('.stall')).toBeHidden()
  // Not a blank canvas: the page is on it.
  expect((await canvasPixels()).distinct).toBeGreaterThan(1)
})

// Chromium gives up on the GPU process after its third crash: software
// compositing, no WebGL, for the rest of the session. Nothing in the app can
// bring it back, so the honest thing is to say so and offer the one action
// that works. Whichever way Chromium goes on the machine running this, the
// notice over a painting target must never again be the one that blames it.
test('after the third, the notice says WebGL is gone and offers a restart', async () => {
  await resetGpu()
  await expect.poll(glState, { timeout: 20_000 }).not.toBe('lost')
  await navigateTo(TALL)

  const state = await glState()
  const gone = page.locator('.stall.gl-gone')
  // Which way Chromium went is worth having in the log when this file is
  // read on a machine that behaves differently.
  console.log(`gpu-reset: after the third reset the canvas is '${state}'`)
  if (state === 'ok') {
    await expect(page.locator('.stall')).toBeHidden()
    expect((await canvasPixels()).distinct).toBeGreaterThan(1)
  } else {
    await expect(gone).toBeVisible()
    await expect(gone).toContainText('WebGL')
    await expect(gone.locator('button')).toHaveText(/Restart/)
  }
  await expect(page.locator('.stall:not(.gl-gone)')).toBeHidden()
})
