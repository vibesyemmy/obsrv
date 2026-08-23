import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp, rendererWindow } from './launch'

const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
})
test.afterAll(async () => {
  await app.close()
})

/** Builds a solid PNG in the page and drops it on the window. */
async function drop(p: Page, width: number, height: number, name: string): Promise<void> {
  await p.evaluate(
    async (arg: { width: number; height: number; name: string }) => {
      const canvas = new OffscreenCanvas(arg.width, arg.height)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ff0000'
      ctx.fillRect(0, 0, arg.width, arg.height)
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      const dt = new DataTransfer()
      dt.items.add(new File([blob], arg.name, { type: 'image/png' }))
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
    },
    { width, height, name },
  )
}

/** RGBA of the pixel at the centre of the target canvas, from a screenshot. */
async function canvasCentrePixel(): Promise<number[]> {
  const clip = await page.evaluate(() => {
    const r = document.querySelector('.target-pane canvas')!.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: 1, height: 1 }
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
    return Array.from(ctx.getImageData(0, 0, 1, 1).data)
  }, png.toString('base64'))
}

test('an unsupported file is refused with a toast', async () => {
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.items.add(new File(['x'], 'notes.txt', { type: 'text/plain' }))
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  })

  await expect(page.locator('.toast')).toHaveText('Unsupported file type')
  // And it did not switch modes.
  await expect(page.locator('.url-form input')).not.toHaveAttribute('readonly', '')
})

test('a dropped 2x export is shown at its 1x size', async () => {
  await page.fill('.url-form input', FIXTURE)
  await page.press('.url-form input', 'Enter')
  await expect(page.locator('.url-form input')).toHaveValue(FIXTURE)
  await page.check('.pixel-exact input')

  await drop(page, 400, 200, 'hero@2x.png')
  // The strip names the file and asks for the scale.
  await expect(page.locator('.scale-prompt')).toContainText('hero@2x.png')
  await page.click('.scale-2x')

  // Spec §7: the URL bar shows the filename, read-only.
  await expect(page.locator('.url-form input')).toHaveValue('hero@2x.png')
  await expect(page.locator('.url-form input')).toHaveAttribute('readonly', '')

  // The native view is out of the way; the renderer draws both panes.
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__obsrv.native.isVisible()))
    .toBe(false)

  // Left pane: the file at one image pixel per device pixel, with its readout.
  await expect(page.locator('.image-pane img')).toBeVisible()
  await expect(page.locator('.image-pane .pane-footer')).toContainText('SOURCE')
  await expect(page.locator('.image-pane .pane-footer')).toContainText('400×200')
  const img = await page.evaluate(() => {
    const el = document.querySelector('.image-pane img') as HTMLImageElement
    const r = el.getBoundingClientRect()
    return { w: r.width * window.devicePixelRatio, h: r.height * window.devicePixelRatio }
  })
  expect(Math.round(img.w)).toBe(400)
  expect(Math.round(img.h)).toBe(200)

  // Right pane: 400x200 exported at 2x is 200x100 of real pixels, magnified by S = dpr.
  const dpr = await page.evaluate(() => window.devicePixelRatio)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const el = document.querySelector('.target-pane canvas') as HTMLCanvasElement
        return { w: el.width, h: el.height }
      }),
    )
    .toEqual({ w: Math.round(200 * dpr), h: Math.round(100 * dpr) })
  await expect(page.locator('.target-pane .pane-footer')).toContainText('200×100')

  // The downsampled pixels reached the texture: the canvas is red, not blank.
  // WebGL's drawing buffer is cleared after each composite, so read what the
  // user sees — a compositor screenshot — rather than the canvas itself.
  const px = await canvasCentrePixel()
  expect(px[0]).toBeGreaterThan(150)
  expect(px[1]).toBeLessThan(80)
  expect(px[2]).toBeLessThan(80)
})

test('closing the image restores the URL and the live panes', async () => {
  await page.click('.close-image')

  await expect(page.locator('.url-form input')).toHaveValue(FIXTURE)
  await expect(page.locator('.url-form input')).not.toHaveAttribute('readonly', '')
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__obsrv.native.isVisible()))
    .toBe(true)
  await expect(page.locator('.image-pane')).toHaveCount(0)
  await expect(page.locator('.close-image')).toHaveCount(0)
})

test('the menu nudges the renderer rather than acting on the shell', async () => {
  // No `viewMenu` role: its Cmd+R would reload the Obsrv shell itself.
  const menu = await app.evaluate(({ Menu }) => {
    const m = Menu.getApplicationMenu()
    const items = m ? m.items : []
    const flat: { label: string; role?: string; accelerator?: string }[] = []
    const walk = (list: Electron.MenuItem[]): void => {
      for (const it of list) {
        flat.push({ label: it.label, role: it.role, accelerator: it.accelerator })
        if (it.submenu) walk(it.submenu.items)
      }
    }
    walk(items)
    return flat
  })
  const roles = menu.map(i => (i.role ?? '').toLowerCase())
  expect(roles).not.toContain('viewmenu')
  expect(roles).not.toContain('reload')
  expect(roles).not.toContain('forcereload')
  const byAccel = (a: string) => menu.find(i => i.accelerator === a)
  expect(byAccel('CmdOrCtrl+O')?.label).toBe('Open Image…')
  expect(byAccel('CmdOrCtrl+R')?.label).toBe('Reload')
  expect(byAccel('CmdOrCtrl+L')?.label).toBe('Open Location')

  // Cmd+L reaches the URL bar over IPC, so it works while the native pane has focus.
  await page.click('.target-pane canvas')
  await expect(page.locator('.url-form input')).not.toBeFocused()
  await app.evaluate(() => (globalThis as any).__obsrv.win.webContents.send('obsrv:focus-url'))
  await expect(page.locator('.url-form input')).toBeFocused()
})
