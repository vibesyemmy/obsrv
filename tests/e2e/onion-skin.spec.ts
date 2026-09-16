import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONTROL_FILE_NAME, isDisabledStance, parseControlFile, type ControlInfo } from '../../src/shared/control'
import { captureScale, captureScaleReason, skipWhenCapturesAreScaled } from './helpers/captureScale'
import { decodePng, pixelAt } from './helpers/decodePng'
import { openPanel } from './helpers/select'
import { launchApp, rendererWindow } from './launch'

/**
 * The onion skin (shared/onionSkin.ts): the page rendered again at 2× and
 * blended over the target's 1x raster. The fixture is blue at 1x and red at
 * 2dppx — the one page whose two renders differ in every pixel — so the
 * blend is measurable in a capture of the pane, taken through the control
 * server exactly as an agent would take it.
 */

const DPPX = pathToFileURL(resolve(__dirname, '../fixtures/dppx.html')).href
const TALL = pathToFileURL(resolve(__dirname, '../fixtures/tall.html')).href

let app: ElectronApplication
let page: Page
let info: ControlInfo
let scale = 1

interface Reply {
  status: number
  body: Record<string, unknown>
}

function call(command: string, payload?: Record<string, unknown>): Promise<Reply> {
  return new Promise((done, fail) => {
    const body: Record<string, unknown> = { command, token: info.token }
    if (payload) body.payload = payload
    const data = JSON.stringify(body)
    const req = request(
      { host: '127.0.0.1', port: info.port, method: 'POST', path: '/', headers: { 'content-type': 'application/json' } },
      res => {
        let text = ''
        res.on('data', d => (text += String(d)))
        res.on('end', () => {
          let parsed: Record<string, unknown> = {}
          try {
            parsed = JSON.parse(text) as Record<string, unknown>
          } catch {
            // Non-JSON reply: surface it through the empty body.
          }
          done({ status: res.statusCode ?? 0, body: parsed })
        })
      },
    )
    req.on('error', fail)
    req.end(data)
  })
}

/** The colour at the centre of the target pane, as an agent's capture sees it. */
async function centre(): Promise<[number, number, number]> {
  const r = await call('captureTarget')
  expect(r.status).toBe(200)
  const png = decodePng(Buffer.from((r.body as { data: string }).data, 'base64'))
  const [red, green, blue] = pixelAt(png, Math.floor(png.width / 2), Math.floor(png.height / 2))
  return [red, green, blue]
}
const near = (a: [number, number, number], b: [number, number, number], tol = 24): boolean =>
  a.every((v, i) => Math.abs(v - b[i]!) <= tol)

const reference = (): Promise<{ url: string; dsf: number; width: number; height: number } | null> =>
  app.evaluate(() => {
    const ref = (globalThis as any).__obsrv.session.reference
    if (!ref) return null
    const vp = ref.getViewport()
    return { url: ref.webContents.getURL() as string, dsf: ref.getDeviceScaleFactor() as number, width: vp.width, height: vp.height }
  })
const footer = (): Promise<string> => page.locator('.target-pane .pane-footer').innerText()

test.beforeAll(async () => {
  app = await launchApp([], { OBSRV_AGENT_CONTROL: '1' })
  page = await rendererWindow(app)
  scale = await captureScale(app)
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'))
  const controlFile = join(userData, CONTROL_FILE_NAME)
  await expect.poll(() => existsSync(controlFile)).toBe(true)
  const parsed = parseControlFile(readFileSync(controlFile, 'utf8'))
  if (!parsed || isDisabledStance(parsed)) throw new Error(`the control file at ${controlFile} names no port`)
  info = parsed
  await page.fill('.url-form input', DPPX)
  await page.press('.url-form input', 'Enter')
  await expect.poll(() => app.evaluate(() => (globalThis as any).__obsrv.target.webContents.executeJavaScript('document.title')), { timeout: 10_000 }).toBe('dppx')
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLCanvasElement>('canvas.target-canvas')?.dataset.gl)).toBe('ok')
  await page.click('.panes-target')
  // The onion-skin slider lives in the side panel.
  await openPanel(page)
})
test.afterAll(async () => {
  await app.close()
})

test('off by default: the 1x raster alone, no reference, the slider at 0', async () => {
  // One of the three that go red on a 2× desk and green on CI (2026-09-12,
  // docs/e2e-flakes.md): `centre` reads a pixel out of a capture the host
  // display has already scaled. Skipped there rather than failed.
  test.skip(skipWhenCapturesAreScaled(scale), captureScaleReason(scale))
  await expect.poll(centre).toEqual([0, 0, 255])
  expect(await reference()).toBeNull()
  await expect(page.locator('.onion-slider')).toHaveValue('0')
  expect(await footer()).not.toContain('onion ')
  const s = await call('status')
  expect(s.body).toMatchObject({ onionSkin: 0 })
})

test('at 50% a 2× reference exists at the target viewport, and the pane is the blend of the two rasters', async () => {
  const r = await call('setOnionSkin', { onionSkin: 0.5 })
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  await expect.poll(reference).toMatchObject({ dsf: 2, width: 1920, height: 1080 })
  await expect.poll(() => reference().then(x => x?.url ?? '')).toBe(DPPX)
  await expect.poll(async () => near(await centre(), [128, 0, 128]), { timeout: 10_000 }).toBe(true)
  await expect.poll(footer).toContain('onion 50%')
  await expect(page.locator('.onion-slider')).toHaveValue('50')
  expect((await call('status')).body).toMatchObject({ onionSkin: 0.5 })
})

test('at 100% the pane is the HiDPI render outright; off again drops the reference and the 1x raster returns', async () => {
  // The second of the three. Note what is NOT skipped: the 50% test above also
  // reads `centre`, and was not among the three observed red on 2026-09-12, so
  // it keeps running. If a 2× desk turns it red too, it belongs here — on that
  // observation, not on the symmetry.
  test.skip(skipWhenCapturesAreScaled(scale), captureScaleReason(scale))
  await call('setOnionSkin', { onionSkin: 1 })
  await expect.poll(async () => near(await centre(), [255, 0, 0]), { timeout: 10_000 }).toBe(true)
  await call('setOnionSkin', { onionSkin: 0 })
  await expect.poll(reference).toBeNull()
  await expect.poll(async () => near(await centre(), [0, 0, 255]), { timeout: 10_000 }).toBe(true)
  expect(await footer()).not.toContain('onion ')
})

test('the reference follows a navigation of the target', async () => {
  await call('setOnionSkin', { onionSkin: 0.25 })
  await expect.poll(reference).not.toBeNull()
  await page.fill('.url-form input', TALL)
  await page.press('.url-form input', 'Enter')
  await expect.poll(() => reference().then(x => x?.url ?? ''), { timeout: 10_000 }).toBe(TALL)
  await call('setOnionSkin', { onionSkin: 0 })
  await expect.poll(reference).toBeNull()
})

test('the reply is the skin in force: from off, on a screen that can have one, it answers the value set', async () => {
  // The confirmation accepted "off" so that a refusal could confirm, and so it
  // accepted the off from before the patch: on main this reply read 0 six times
  // of six (bug-onion-skin-zero-means-three-things).
  await expect.poll(async () => (await call('status')).body.onionSkin).toBe(0)
  const on = await call('setOnionSkin', { onionSkin: 0.5 })
  expect(on.status, JSON.stringify(on.body)).toBe(200)
  expect(on.body).toMatchObject({ ok: true, applied: true, onionSkin: 0.5 })
  expect(on.body.warnings).toBeUndefined()
  await expect.poll(reference).not.toBeNull()
  const off = await call('setOnionSkin', { onionSkin: 0 })
  expect(off.body).toMatchObject({ ok: true, applied: true, onionSkin: 0 })
  await expect.poll(reference).toBeNull()
})

test('a viewport too wide for a 2× reference refuses the skin: the value reads back as 0, and the reply says why', async () => {
  await call('setPreset', { id: '4k-27' })
  await expect.poll(() => app.evaluate(() => (globalThis as any).__obsrv.target.getViewport().width)).toBe(3840)
  const vp = await app.evaluate(() => (globalThis as any).__obsrv.target.getViewport() as { width: number; height: number })
  const r = await call('setOnionSkin', { onionSkin: 0.5 })
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  expect(r.body).toMatchObject({ ok: true, applied: false, onionSkin: 0 })
  expect(r.body.warnings).toEqual([expect.stringContaining(`the onion skin was left off`)])
  expect((r.body.warnings as string[])[0]).toContain(`at this ${vp.width}x${vp.height} viewport`)
  // Refused before the renderer was asked, so the value never passes through
  // 0.5 on its way to 0, where a status read in between would have caught it.
  const seen = new Set<unknown>()
  for (const end = Date.now() + 1_000; Date.now() < end; ) seen.add((await call('status')).body.onionSkin)
  expect([...seen]).toEqual([0])
  expect(await reference()).toBeNull()
  await expect(page.locator('.onion-slider')).toHaveValue('0')
  await call('setPreset', { id: '1080p-24' })
})

test('a skin that is on goes off when a resize leaves a screen too big for it, and stays off back on one that fits', async () => {
  // bug-onion-skin-dies-on-a-preset-round-trip: main dropped the reference and
  // nothing told the renderer, so the skin read 0.5 over nothing — on the big
  // screen, and back on a screen that fits, until the value was changed.
  await call('setPreset', { id: '1080p-24' })
  await expect.poll(() => app.evaluate(() => (globalThis as any).__obsrv.target.getViewport().width)).toBe(1920)
  const on = await call('setOnionSkin', { onionSkin: 0.5 })
  expect(on.body).toMatchObject({ ok: true, applied: true, onionSkin: 0.5 })
  await expect.poll(reference).not.toBeNull()

  await call('setPreset', { id: '4k-27' })
  await expect.poll(() => app.evaluate(() => (globalThis as any).__obsrv.target.getViewport().width)).toBe(3840)
  await expect.poll(async () => (await call('status')).body.onionSkin).toBe(0)
  expect(await reference()).toBeNull()
  await expect(page.locator('.onion-slider')).toHaveValue('0')

  await call('setPreset', { id: '1080p-24' })
  await expect.poll(() => app.evaluate(() => (globalThis as any).__obsrv.target.getViewport().width)).toBe(1920)
  // Off, and saying so: the value and the reference agree on a screen that could have one.
  expect((await call('status')).body).toMatchObject({ onionSkin: 0 })
  expect(await reference()).toBeNull()
  await expect(page.locator('.onion-slider')).toHaveValue('0')
})

test('a bad value is refused with the reason', async () => {
  const r = await call('setOnionSkin', { onionSkin: 2 })
  expect(r.status).toBe(400)
  expect(String(r.body.error)).toContain('setOnionSkin payload must be')
})
