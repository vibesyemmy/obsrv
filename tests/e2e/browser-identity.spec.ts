import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp, rendererWindow } from './launch'
import { choose } from './helpers/select'

test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page

const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
  await page.evaluate(u => window.obsrv.navigate(u), FIXTURE)
})
test.afterAll(async () => {
  await app.close()
})

/** What the page under test believes it is running in. */
const identity = (): Promise<{ mobileUA: boolean; dpr: number }> =>
  app.evaluate(async () => {
    const wc = (globalThis as any).__obsrv.target.webContents
    const ua: string = await wc.executeJavaScript('navigator.userAgent')
    return { mobileUA: /Mobile|iPhone|Android/.test(ua), dpr: await wc.executeJavaScript('window.devicePixelRatio') }
  })

/**
 * The guarantee this file exists for.
 *
 * Phone fidelity used to be keyed on the scale factor alone, which was
 * indistinguishable from correct only while every laptop and desktop preset
 * happened to be 1x. Adding Retina laptops made them claim to be phones: a
 * preset labelled "MacBook Pro 14" told every site that sniffs the user agent
 * it was a mobile device. Density and being-a-phone are different facts, and
 * this is the assertion that keeps them apart.
 */
test('a dense laptop is still a desktop browser', async () => {
  await choose(app, page, '.preset-select', 'mbp-14')
  await expect.poll(async () => (await identity()).dpr).toBe(2)
  expect((await identity()).mobileUA, 'a MacBook Pro must not claim to be a phone').toBe(false)
})

test('every laptop and desktop preset keeps the desktop identity', async () => {
  for (const id of ['1080p-24', '4k-27', 'ultrawide-34', 'laptop-768', 'mbp-16']) {
    await choose(app, page, '.preset-select', id)
    await expect.poll(async () => (await identity()).mobileUA, { message: id }).toBe(false)
  }
})

test('every mobile preset still gets phone fidelity', async () => {
  // The other half: this is what the old dsf-based rule got right, and the
  // reason it survived so long. It must keep working.
  for (const id of ['iphone-61', 'iphone-67', 'android-65', 'ipad-pro-129']) {
    await choose(app, page, '.preset-select', id)
    await expect.poll(async () => (await identity()).mobileUA, { message: id }).toBe(true)
  }
})

test('switching away from a phone restores the desktop identity', async () => {
  await choose(app, page, '.preset-select', 'iphone-61')
  await expect.poll(async () => (await identity()).mobileUA).toBe(true)
  await choose(app, page, '.preset-select', 'mbp-16')
  // Same density either side of this switch, so nothing but the kind of screen
  // changed — which is exactly the case the old rule could not express.
  await expect.poll(async () => (await identity()).mobileUA).toBe(false)
})
