import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp, rendererWindow } from './launch'

const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href
const TALL = pathToFileURL(resolve(__dirname, '../fixtures/tall.html')).href

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
  await new Promise(r => setTimeout(r, 1500))
})
test.afterAll(async () => {
  await app.close()
})

test('a target that stops painting is called out, and recovers', async () => {
  // Cut frame delivery, then give the canvas a reason to expect one.
  await app.evaluate(() => (globalThis as any).__obsrv.bus.setEnabled(false))
  await page.fill('.url-form input', FIXTURE)
  await page.press('.url-form input', 'Enter')

  await expect(page.locator('.stall')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.stall')).toContainText('No frames from target renderer')

  // Restoring delivery invalidates the target, so a frame arrives immediately.
  await app.evaluate(() => (globalThis as any).__obsrv.bus.setEnabled(true))
  await expect(page.locator('.stall')).toBeHidden({ timeout: 10_000 })
})

test('a page that simply finishes painting is not called a stall', async () => {
  // The fixture is static: no further paints ever arrive. The watchdog must
  // stay quiet, or it would fire on every static page in existence.
  await new Promise(r => setTimeout(r, 4000))
  await expect(page.locator('.stall')).toBeHidden()
})

test('a subframe load on a healthy page is not a stall', async () => {
  // `did-start-loading` fires for an iframe too, and a hidden one changes no
  // pixel, so no frame follows. Only a main-frame navigation owes a frame.
  await app.evaluate(async (_electron, src: string) => {
    const ctx = (globalThis as any).__obsrv
    await ctx.target.webContents.executeJavaScript(
      `new Promise(r => {
        const f = document.createElement('iframe')
        f.hidden = true
        f.src = ${JSON.stringify(src)}
        f.onload = () => r(true)
        document.body.append(f)
      })`,
    )
  }, TALL)
  await new Promise(r => setTimeout(r, 3000))
  await expect(page.locator('.stall')).toBeHidden()
})

test('image mode never arms the watchdog, even across a reload', async () => {
  // Main stops target frames in image mode by design, so "no frame" is the
  // normal state there. Cmd+R still reloads the hidden panes (and fires the
  // target's loading transitions); that must not be read as a stall either.
  await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(40, 20)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ff0000'
    ctx.fillRect(0, 0, 40, 20)
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    const dt = new DataTransfer()
    dt.items.add(new File([blob], 'stall@2x.png', { type: 'image/png' }))
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  })
  await expect(page.locator('.scale-prompt')).toContainText('stall@2x.png')
  await page.click('.scale-2x')
  await expect(page.locator('.close-image')).toHaveCount(1)

  // The same two calls the View → Reload menu item makes.
  await app.evaluate(() => {
    const ctx = (globalThis as any).__obsrv
    ctx.native.reload()
    ctx.target.reload()
  })
  await new Promise(r => setTimeout(r, 3500))
  await expect(page.locator('.stall')).toBeHidden()

  // Back in URL mode main re-enables frames and invalidates the target, so
  // the frame the watchdog is owed arrives and nothing is reported.
  await page.click('.close-image')
  await expect(page.locator('.close-image')).toHaveCount(0)
  await new Promise(r => setTimeout(r, 3500))
  await expect(page.locator('.stall')).toBeHidden()
})
