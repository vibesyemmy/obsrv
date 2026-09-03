import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { choose } from './helpers/select'
import { launchApp, rendererWindow } from './launch'

/**
 * Throttling on the live app: the same debugger call the CLI makes, on
 * the tab in front's target. Measured from inside the page — a fixed
 * amount of work takes longer under a CPU rate — and read back through
 * the footer and the menu. Per tab, and off by default on every launch.
 */

let app: ElectronApplication
let page: Page
let server: Server
let url: string

// ~120 ms of work on an M-series; the comparison is a ratio, so the host's speed cancels.
const WORK = 'let x=0;for(let i=0;i<40000000;i++){x=(x+i)%7};x'
const PAGE = '<!doctype html><title>throttle</title><p>throttle</p>'

const workMs = (): Promise<number> =>
  app.evaluate(({}, code: string) => (globalThis as any).__obsrv.target.webContents.executeJavaScript(code), `(() => { const t = performance.now(); ${WORK}; return performance.now() - t })()`)
const footer = (): Promise<string> => page.locator('.target-pane .pane-footer').innerText()
const targetThrottle = (): Promise<string> => app.evaluate(() => (globalThis as any).__obsrv.target.getThrottle().id)

test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html')
    res.end(PAGE)
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  app = await launchApp()
  page = await rendererWindow(app)
  await page.fill('.url-form input', url)
  await page.press('.url-form input', 'Enter')
  await expect.poll(() => app.evaluate(() => (globalThis as any).__obsrv.target.webContents.executeJavaScript('document.title')), { timeout: 10_000 }).toBe('throttle')
})
test.afterAll(async () => {
  await app.close()
  await new Promise<void>(r => server.close(() => r()))
})

test('off by default: the menu says none, the footer says nothing, the target has no session', async () => {
  await expect(page.locator('.throttle-select')).toHaveAttribute('data-value', 'none')
  await expect(page.locator('.throttle-select')).toHaveText(/Throttle none/)
  expect(await footer()).not.toContain('throttle ')
  expect(await targetThrottle()).toBe('none')
})

test('the menu applies a CPU rate to the target: the same work takes several times longer, and the footer says so', async () => {
  const plain = await workMs()
  await choose(app, page, '.throttle-select', 'cpu-6x')
  await expect.poll(targetThrottle).toBe('cpu-6x')
  await expect.poll(footer).toContain('throttle cpu-6x')
  const slow = await workMs()
  // 6× nominal; anything under 3× would mean the rate is not in force.
  expect(slow / plain).toBeGreaterThan(3)

  await choose(app, page, '.throttle-select', 'none')
  await expect.poll(targetThrottle).toBe('none')
  await expect.poll(footer).not.toContain('throttle ')
  const back = await workMs()
  expect(back / plain).toBeLessThan(2)
})

test('it is per tab, and a new tab starts unthrottled', async () => {
  await choose(app, page, '.throttle-select', 'budget-phone')
  await expect.poll(targetThrottle).toBe('budget-phone')
  await page.locator('.chrome-tabs .tab-new').click()
  await expect(page.locator('.chrome-tabs [role="tab"]')).toHaveCount(2)
  await expect(page.locator('.throttle-select')).toHaveAttribute('data-value', 'none')
  await expect.poll(targetThrottle).toBe('none')
  await page.locator('.chrome-tabs [role="tab"]').nth(0).click()
  await expect(page.locator('.throttle-select')).toHaveAttribute('data-value', 'budget-phone')
  await expect.poll(targetThrottle).toBe('budget-phone')
  await choose(app, page, '.throttle-select', 'none')
})
