import { test, expect, type ElectronApplication } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp, rendererWindow } from './launch'

const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href
// The three `.chrome-row` heights in styles.css, and `TOOLBAR_H` in
// src/main/ipc.ts. toolbar.spec.ts pins the rendered chrome to main's value;
// this file only needs the number to bound the pane below it.
const TOOLBAR_H = 114

let app: ElectronApplication

test.beforeAll(async () => {
  app = await launchApp()
})
test.afterAll(async () => {
  await app.close()
})

test('main window opens with the renderer loaded', async () => {
  const page = await rendererWindow(app)
  // The shell's signature readouts (Task 14) prove the React tree mounted.
  await expect(page.locator('#root')).toContainText('NATIVE')
  await expect(page.locator('#root')).toContainText('TARGET')
})

test('native pane loads a URL', async () => {
  const title = await app.evaluate(async (_electron, url: string) => {
    const ctx = (globalThis as any).__obsrv
    await ctx.native.load(url)
    return ctx.native.webContents.getTitle()
  }, FIXTURE)
  expect(title).toBe('hairline-fixture')
})

test('native pane fills the left half below the toolbar', async () => {
  // Main's fallback layout (x 0, y TOOLBAR_H, half width) holds only until
  // the renderer's NativeSlot reports; from Task 14 that happens within the
  // first paint, so what is observable is the renderer-driven layout: the
  // left half, below the toolbar, above the pane footer. The exact
  // slot-equals-bounds check lives in panes.spec.ts.
  const seen = await app.evaluate(async () => {
    const ctx = (globalThis as any).__obsrv
    const [width = 0, height = 0] = ctx.win.getContentSize()
    return { bounds: ctx.native.getBounds(), content: { width, height } }
  })
  expect(seen.bounds.x).toBe(0)
  expect(seen.bounds.y).toBeGreaterThanOrEqual(TOOLBAR_H)
  // Two known single pixels stand between the view and an exact half, and both
  // are deliberate: the draggable seam is a flex item, so the two panes divide
  // `width - 1` rather than `width`; and `.native-slot` is a further 1px
  // narrower than its pane so the seam's hover band is visible on the native
  // side too (styles.css). The exact slot-equals-bounds check lives in
  // panes.spec.ts — this one only asserts "the left half, give or take the
  // chrome between them".
  expect(Math.abs(seen.bounds.width - seen.content.width / 2)).toBeLessThanOrEqual(2)
  expect(seen.bounds.height).toBeLessThanOrEqual(seen.content.height - TOOLBAR_H)
  expect(seen.bounds.height).toBeGreaterThan((seen.content.height - TOOLBAR_H) * 0.8)
})

test('back returns to the previous document', async () => {
  const landed = await app.evaluate(async (_electron, url: string) => {
    const ctx = (globalThis as any).__obsrv
    await ctx.native.load('about:blank')
    await ctx.native.load(url)
    const wc = ctx.native.webContents
    const navigated = new Promise<string>(res => {
      wc.once('did-navigate', (_e: unknown, u: string) => res(u))
    })
    ctx.native.back()
    return navigated
  }, FIXTURE)
  expect(landed).toBe('about:blank')
})
