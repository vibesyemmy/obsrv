import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { launchApp, rendererWindow } from './launch'

/**
 * The loading strip inside the URL field. A held HTTP response keeps the
 * target loading for as long as the test wants, which is the only way to
 * see the strip mid-load: a fixture from disk loads in a beat.
 */

let app: ElectronApplication
let page: Page
let server: Server
let url: string
/** Responses the server is holding; both panes request the page. */
let held: ServerResponse[] = []
let hold = false

const PAGE = '<!doctype html><title>strip</title><p>strip</p>'

test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html')
    if (hold) held.push(res)
    else res.end(PAGE)
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  app = await launchApp()
  page = await rendererWindow(app)
})
test.afterAll(async () => {
  for (const res of held) res.end(PAGE)
  await app.close()
  await new Promise<void>(r => server.close(() => r()))
})

const release = () => {
  for (const res of held) res.end(PAGE)
  held = []
  hold = false
}

const barScale = () =>
  page.evaluate(() => {
    const bar = document.querySelector('.url-progress-bar')
    if (!bar) return null
    const m = getComputedStyle(bar).transform
    // matrix(a, b, c, d, tx, ty): `a` is the x scale.
    const a = /matrix\(([^,]+),/.exec(m)?.[1]
    return a === undefined ? (m === 'none' ? 1 : null) : Number(a)
  })

test('no strip while nothing loads', async () => {
  await expect(page.locator('.url-progress')).toHaveCount(0)
})

test('the strip runs inside the field while the target loads, creeping but never arriving', async () => {
  hold = true
  await page.fill('.url-form input', url)
  await page.press('.url-form input', 'Enter')
  const strip = page.locator('.url-field .url-progress')
  await expect(strip).toHaveCount(1)
  await expect(strip).toHaveAttribute('data-phase', 'loading')
  await expect(strip).toHaveAttribute('role', 'progressbar')
  // It sits along the field's bottom edge, inside the border, and is a hairline.
  const box = await strip.boundingBox()
  const field = await page.locator('.url-form input').boundingBox()
  expect(box).not.toBeNull()
  expect(field).not.toBeNull()
  expect(box!.height).toBeLessThanOrEqual(3)
  expect(box!.y + box!.height).toBeLessThanOrEqual(field!.y + field!.height)
  expect(box!.y + box!.height).toBeGreaterThan(field!.y + field!.height - 4)
  expect(box!.x).toBeGreaterThanOrEqual(field!.x)
  expect(box!.x + box!.width).toBeLessThanOrEqual(field!.x + field!.width)
  // Progress without a figure: it advances, and stays short of the end.
  await expect.poll(barScale, { timeout: 5_000 }).toBeGreaterThan(0.05)
  const early = (await barScale())!
  await page.waitForTimeout(600)
  const later = (await barScale())!
  expect(later).toBeGreaterThan(early)
  expect(later).toBeLessThan(0.95)
  await expect(strip).toHaveAttribute('data-phase', 'loading')
})

test('when the load stops the strip completes, fades, and goes', async () => {
  // Record every phase the strip passes through, so a 400 ms `done` cannot
  // slip between two polls.
  await page.evaluate(() => {
    const seen: string[] = []
    ;(window as any).__phases = seen
    const strip = document.querySelector('.url-progress')!
    seen.push(strip.getAttribute('data-phase')!)
    new MutationObserver(() => {
      const p = strip.getAttribute('data-phase')
      if (p && seen[seen.length - 1] !== p) seen.push(p)
    }).observe(strip, { attributes: true, attributeFilter: ['data-phase'] })
  })
  release()
  await expect(page.locator('.url-progress')).toHaveCount(0, { timeout: 10_000 })
  expect(await page.evaluate(() => (window as any).__phases)).toEqual(['loading', 'done'])
  await expect(page.locator('.tab.active, [role=tab][aria-selected=true]').first()).toContainText('strip')
})

test('a reload restarts the strip from zero', async () => {
  hold = true
  await page.click('button[aria-label="Reload"]')
  const strip = page.locator('.url-progress')
  await expect(strip).toHaveAttribute('data-phase', 'loading')
  await expect.poll(barScale, { timeout: 5_000 }).toBeGreaterThan(0.05)
  release()
  await expect(strip).toHaveCount(0, { timeout: 10_000 })
})
