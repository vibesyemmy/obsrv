import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, rendererWindow } from './launch'

/**
 * Image mode is per tab in every visible respect — the mode itself, the file's
 * name and dimensions, the URL bar — but the decoded pixels were held in one
 * slot for the whole window. So the tab in front showed its own filename over
 * whichever file was dropped last, in any tab; and a switch to a live tab ran
 * the leave-image-mode cleanup, revoking the blob of the tab being left, which
 * came back to an empty pane over a canvas frozen on another tab's frame.
 *
 * Both panes are read from what they actually hold — the decoded blob's own
 * size and the colour on the canvas — never from the readouts, which come from
 * the store and were per tab all along, so they agreed either way.
 *
 * Its own app, not `image-mode.spec.ts`'s: that spec drives one window through
 * every drop path in the product, and these tests need a window whose tabs are
 * theirs alone.
 */
test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
})
test.afterAll(async () => {
  await app.close()
})

const strip = () => page.locator('.chrome-tabs [role="tab"]')

/** Drops a solid PNG on the window and answers the scale prompt with 1x. */
async function dropAt(width: number, height: number, name: string, fill: string): Promise<void> {
  await page.evaluate(
    async (arg: { width: number; height: number; name: string; fill: string }) => {
      const canvas = new OffscreenCanvas(arg.width, arg.height)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = arg.fill
      ctx.fillRect(0, 0, arg.width, arg.height)
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      const dt = new DataTransfer()
      dt.items.add(new File([blob], arg.name, { type: 'image/png' }))
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
    },
    { width, height, name, fill },
  )
  await expect(page.locator('.scale-prompt')).toContainText(name)
  await page.click('.scale-1x')
  await expect(page.locator('.url-form input')).toHaveValue(name)
}

/** The left pane's decoded file, from the blob itself. Null when there is none. */
const sourceSize = (): Promise<{ w: number; h: number } | null> =>
  page.evaluate(() => {
    const el = document.querySelector('.image-pane img') as HTMLImageElement | null
    return el ? { w: el.naturalWidth, h: el.naturalHeight } : null
  })

/** RGBA at the centre of the target canvas, from a compositor screenshot. */
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

test('two tabs holding two files each show their own', async () => {
  await dropAt(400, 200, 'red.png', '#ff0000')
  await expect.poll(sourceSize).toEqual({ w: 400, h: 200 })

  await page.click('.tab-new')
  await expect(strip()).toHaveCount(2)
  await dropAt(200, 400, 'blue.png', '#0000ff')
  await expect.poll(sourceSize).toEqual({ w: 200, h: 400 })
  const onBlue = await canvasCentrePixel()
  expect(onBlue[2]).toBeGreaterThan(onBlue[0]!)

  // Back to the first tab: its name was always right; its pixels were not.
  await strip().nth(0).click()
  await expect(page.locator('.url-form input')).toHaveValue('red.png')
  await expect.poll(sourceSize).toEqual({ w: 400, h: 200 })
  const onRed = await canvasCentrePixel()
  expect(onRed[0]).toBeGreaterThan(onRed[2]!)

  await strip().nth(1).click()
  await expect(page.locator('.url-form input')).toHaveValue('blue.png')
  await expect.poll(sourceSize).toEqual({ w: 200, h: 400 })
})

test('a tab keeps its file across a switch to a live tab and back', async () => {
  // The second tab leaves image mode for a live page, which is the switch that
  // used to take the first tab's blob with it.
  await page.click('.close-image')
  await expect(page.locator('.image-pane')).toHaveCount(0)

  await strip().nth(0).click()
  await expect(page.locator('.url-form input')).toHaveValue('red.png')
  await strip().nth(1).click()
  await expect(page.locator('.image-pane')).toHaveCount(0)

  await strip().nth(0).click()
  // A revoked blob leaves an <img> that never decodes: 0×0, over a canvas
  // still showing whatever it last received.
  await expect.poll(sourceSize).toEqual({ w: 400, h: 200 })
  const px = await canvasCentrePixel()
  expect(px[0]).toBeGreaterThan(px[2]!)
  // And main agrees the left pane is the renderer's to draw, so the native
  // view is not sitting behind an empty pane.
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__obsrv.native.isVisible()))
    .toBe(false)
})
