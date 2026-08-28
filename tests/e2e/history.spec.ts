import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp, openOverflow, rendererWindow } from './launch'

/**
 * Visited-URL history in the URL bar (spec `2026-08-28-obsrv-history.md`).
 *
 * The file on disk is the assertion of record for what was recorded, and the
 * dropdown for what the user can act on: "not recorded" has to be checked
 * where the entry would be, not where a rendering of it might be missing for
 * some other reason.
 */

const fixture = (name: string): string => pathToFileURL(resolve(__dirname, `../fixtures/${name}`)).href
const HAIRLINE = fixture('hairline.html')
const TALL = fixture('tall.html')
const THIN = fixture('thin-text.html')
const BAD = 'https://obsrv-no-such-host.invalid/'

let app: ElectronApplication
let page: Page
let historyFile: string

interface Entry {
  url: string
  visits: number
  lastVisit: number
}

const stored = (): Entry[] => (existsSync(historyFile) ? (JSON.parse(readFileSync(historyFile, 'utf8')) as Entry[]) : [])
const storedUrls = (): string[] => stored().map(e => e.url)

/**
 * Types a query into the URL bar and waits for the list. Always clears first:
 * Playwright's `fill` writes the value React already has tracked, and React
 * then fires no change event at all — so refilling the same text would leave
 * the list closed and every assertion below vacuous.
 */
async function openList(query: string): Promise<void> {
  await page.click('.url-form input')
  await page.fill('.url-form input', '')
  await page.fill('.url-form input', query)
  await page.waitForSelector('.url-history')
}

/** Navigates through the URL bar and waits for both panes to arrive. */
async function goto(url: string): Promise<void> {
  await page.fill('.url-form input', '')
  await page.fill('.url-form input', url)
  await page.press('.url-form input', 'Enter')
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__obsrv.native.webContents.getURL()), { timeout: 15_000 })
    .toBe(url)
}

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
  historyFile = join(await app.evaluate(({ app: a }) => a.getPath('userData')), 'history.json')
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 1000)
  })
  for (const url of [HAIRLINE, TALL, THIN]) await goto(url)
  await expect.poll(storedUrls).toEqual([THIN, TALL, HAIRLINE])
})
test.afterAll(async () => {
  await app.close()
})

test('the boot navigation is not stored, so about:blank is never offered', async () => {
  expect(storedUrls().some(u => u.startsWith('about:'))).toBe(false)
})

test('typing shows the addresses that match, most recent first', async () => {
  await openList('tall')
  await expect(page.locator('.url-history-row')).toHaveCount(1)
  await expect(page.locator('.url-history-row .url-history-url')).toHaveText(TALL)

  // Broadening the query brings the others back, in visit order.
  await page.fill('.url-form input', 'fixtures')
  await expect(page.locator('.url-history-row .url-history-url')).toHaveText([THIN, TALL, HAIRLINE])

  // And each row carries its age, from the shared formatter.
  await expect(page.locator('.url-history-row').first().locator('.url-history-age')).toHaveText('just now')

  // A query nothing matches shows no list at all, rather than an empty box.
  await page.fill('.url-form input', 'no-such-address-anywhere')
  await expect(page.locator('.url-history')).toHaveCount(0)
  await page.press('.url-form input', 'Escape')
})

test('Down opens the list and Down/Up move the highlight', async () => {
  await page.click('.url-form input')
  await page.fill('.url-form input', '')
  // Clearing the field is itself typing, so close what that opened: Down has
  // to be shown opening the list from nothing.
  await page.press('.url-form input', 'Escape')
  await expect(page.locator('.url-history')).toHaveCount(0)
  // Nothing typed: Down alone opens the list on the most recent address.
  await page.press('.url-form input', 'ArrowDown')
  await expect(page.locator('.url-history-row')).toHaveCount(3)
  await expect(page.locator('.url-history-row.active .url-history-url')).toHaveText(THIN)

  await page.press('.url-form input', 'ArrowDown')
  await expect(page.locator('.url-history-row.active .url-history-url')).toHaveText(TALL)
  await page.press('.url-form input', 'ArrowUp')
  await expect(page.locator('.url-history-row.active .url-history-url')).toHaveText(THIN)
  // Up off the top lands on the typed text — nothing highlighted.
  await page.press('.url-form input', 'ArrowUp')
  await expect(page.locator('.url-history-row.active')).toHaveCount(0)
  // And the field itself never changed while the highlight moved.
  await expect(page.locator('.url-form input')).toHaveValue('')
  await page.press('.url-form input', 'Escape')
})

test('Enter navigates to the highlighted row, not to the typed text', async () => {
  await openList('fixtures')
  await page.press('.url-form input', 'ArrowDown')
  await page.press('.url-form input', 'ArrowDown')
  await expect(page.locator('.url-history-row.active .url-history-url')).toHaveText(TALL)
  await page.press('.url-form input', 'Enter')

  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__obsrv.native.webContents.getURL()), { timeout: 15_000 })
    .toBe(TALL)
  await expect(page.locator('.url-form input')).toHaveValue(TALL)
  await expect(page.locator('.url-history')).toHaveCount(0)
})

test('Escape closes the list; a second Escape reverts the draft', async () => {
  const showing = await page.locator('.url-form input').inputValue()
  await openList('hairline')
  await expect(page.locator('.url-history')).toBeVisible()

  // First press: the list goes, the draft stays. This is the one that is easy
  // to break silently — a handler that reverts here loses the edit as well.
  await page.press('.url-form input', 'Escape')
  await expect(page.locator('.url-history')).toHaveCount(0)
  await expect(page.locator('.url-form input')).toHaveValue('hairline')

  // Second press: the draft reverts to where the panes actually are.
  await page.press('.url-form input', 'Escape')
  await expect(page.locator('.url-form input')).toHaveValue(showing)
})

test('the list never falls left of the native pane, at a wide split or in solo target', async () => {
  // Drag the seam right, so the native pane covers most of the window and a
  // list anchored to the URL field would be entirely underneath it.
  const seam = await page.evaluate(() => {
    const s = document.querySelector('.pane-divider')!.getBoundingClientRect()
    const row = document.querySelector('.panes')!.getBoundingClientRect()
    return { x: s.left + s.width / 2, y: row.top + row.height / 2 }
  })
  await page.mouse.move(seam.x, seam.y)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(seam.x + (380 * i) / 10, seam.y)
  await page.mouse.up()

  await openList('fixtures')
  const listLeft = (): Promise<number> =>
    page.evaluate(() => document.querySelector('.url-history')!.getBoundingClientRect().left)
  // Against the OS-level view's own bounds, not the renderer's slot: the
  // WebContentsView is the thing that paints over the list, and main is the
  // only place its rectangle is real.
  const nativeRight = await app.evaluate(() => {
    const b = (globalThis as any).__obsrv.native.getBounds()
    return b.x + b.width
  })
  expect(nativeRight).toBeGreaterThan(1000)
  expect(await listLeft()).toBeGreaterThanOrEqual(nativeRight)
  // And it is still on screen — pushed right, not pushed out.
  const win = await page.evaluate(() => {
    const r = document.querySelector('.url-history')!.getBoundingClientRect()
    return { right: r.right, width: r.width, viewport: window.innerWidth }
  })
  expect(win.width).toBeGreaterThan(200)
  expect(win.right).toBeLessThanOrEqual(win.viewport)

  // Solo target: no native view, so the clamp collapses and the list sits
  // under the field it belongs to.
  await page.press('.url-form input', 'Escape')
  await page.click('.panes-control .panes-target')
  await openList('fixtures')
  const aligned = await page.evaluate(() => {
    const list = document.querySelector('.url-history')!.getBoundingClientRect()
    const field = document.querySelector('.url-form input')!.getBoundingClientRect()
    return { listLeft: list.left, listRight: list.right, fieldLeft: field.left, fieldRight: field.right }
  })
  expect(aligned.listLeft).toBeCloseTo(aligned.fieldLeft, 0)
  expect(aligned.listRight).toBeCloseTo(aligned.fieldRight, 0)

  await page.press('.url-form input', 'Escape')
  await page.click('.panes-control .panes-both')
})

/**
 * The clamp leaves the list narrow at a wide split, so what survives the
 * truncation decides whether the list is usable at all: these addresses
 * differ only in their tails, and a right-truncated list of them is six
 * identical rows. Asserted as geometry — where the characters actually land
 * inside the clipped box — because `textContent` is the whole URL either way.
 */
test('a truncated row shows its tail, not its scheme', async () => {
  await openList('fixtures')
  const m = await page.evaluate(() => {
    const span = document.querySelector('.url-history-row .url-history-url') as HTMLElement
    const node = span.querySelector('bdi')!.firstChild!
    const text = node.textContent!
    const box = span.getBoundingClientRect()
    const rect = (from: number, to: number): DOMRect => {
      const r = document.createRange()
      r.setStart(node, from)
      r.setEnd(node, to)
      return r.getBoundingClientRect()
    }
    return {
      overflowing: span.scrollWidth > span.clientWidth,
      boxLeft: box.left,
      boxRight: box.right,
      head: rect(0, 12).left,
      tailLeft: rect(text.length - 12, text.length).left,
      tailRight: rect(text.length - 12, text.length).right,
    }
  })
  // The premise: at this split the row genuinely does not fit.
  expect(m.overflowing).toBe(true)
  // The filename is on screen...
  expect(m.tailLeft).toBeGreaterThanOrEqual(m.boxLeft)
  expect(m.tailRight).toBeLessThanOrEqual(m.boxRight + 1)
  // ...and the scheme, which every row shares, is the part clipped away.
  expect(m.head).toBeLessThan(m.boxLeft)
  await page.press('.url-form input', 'Escape')

  // A row that does fit still starts at the left edge: the right-to-left box
  // is there to move the ellipsis, not to right-align the list.
  await page.click('.panes-control .panes-target')
  await openList('fixtures')
  const fits = await page.evaluate(() => {
    const span = document.querySelector('.url-history-row .url-history-url') as HTMLElement
    const box = span.getBoundingClientRect()
    return {
      overflowing: span.scrollWidth > span.clientWidth,
      boxLeft: box.left,
      textLeft: span.querySelector('bdi')!.getBoundingClientRect().left,
    }
  })
  expect(fits.overflowing).toBe(false)
  expect(fits.textLeft).toBeCloseTo(fits.boxLeft, 0)
  await page.press('.url-form input', 'Escape')
  await page.click('.panes-control .panes-both')
})

test('an in-page navigation is not recorded', async () => {
  await goto(HAIRLINE)
  const before = storedUrls()
  const fragment = `${HAIRLINE}#section`

  // Same document, so Chromium reports `did-navigate-in-page` — the event
  // SyncBus mirrors and history deliberately does not listen to.
  await app.evaluate(({}, u: string) => (globalThis as any).__obsrv.native.load(u), fragment)
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__obsrv.native.webContents.getURL()), { timeout: 15_000 })
    .toBe(fragment)

  expect(storedUrls()).not.toContain(fragment)
  expect(storedUrls()).toEqual(before)
})

test('a failed load is not recorded', async () => {
  await goto(HAIRLINE)
  const before = storedUrls()

  await page.fill('.url-form input', '')
  await page.fill('.url-form input', BAD)
  await page.press('.url-form input', 'Enter')
  // The badge is the app's own verdict that this load failed; waiting for it
  // means the whole navigation has been through Chromium, not merely started.
  await expect(page.locator('.badge-error')).toBeVisible({ timeout: 15_000 })
  await expect
    .poll(() =>
      app.evaluate(() => {
        const ctx = (globalThis as any).__obsrv
        return ctx.native.webContents.isLoading() || ctx.target.webContents.isLoading()
      }),
    )
    .toBe(false)

  // The address that did not load is nowhere on disk...
  expect(storedUrls()).not.toContain(BAD)
  expect(storedUrls()).toEqual(before)
  // ...and cannot be offered back as a suggestion.
  await page.click('.url-form input')
  await page.fill('.url-form input', '')
  await page.fill('.url-form input', 'invalid')
  await expect(page.locator('.url-history')).toHaveCount(0)
  await page.press('.url-form input', 'Escape')
  await goto(HAIRLINE)
})

test('turning the setting off stops recording, and keeps what is stored', async () => {
  await openOverflow(page)
  await page.click('.toggle-settings')
  await page.uncheck('.record-history-toggle input')
  const before = storedUrls()
  expect(before.length).toBeGreaterThan(0)

  await goto(THIN)
  // A moment for a write that should not happen to have happened.
  await expect.poll(storedUrls).toEqual(before)
  await expect(page.locator('.history-count')).toHaveText(String(before.length))

  // Back on, and the next navigation lands again.
  await page.check('.record-history-toggle input')
  await goto(TALL)
  await expect.poll(() => storedUrls()[0]).toBe(TALL)
})

test('Clear empties the file, the count and the list', async () => {
  expect(storedUrls().length).toBeGreaterThan(0)
  await page.click('.clear-history')

  await expect.poll(storedUrls).toEqual([])
  await expect(page.locator('.history-count')).toHaveText('0')
  await expect(page.locator('.clear-history')).toBeDisabled()

  // Nothing left to offer, for any query.
  await page.click('.url-form input')
  await page.fill('.url-form input', '')
  await page.press('.url-form input', 'ArrowDown')
  await expect(page.locator('.url-history')).toHaveCount(0)
  await page.fill('.url-form input', 'fixtures')
  await expect(page.locator('.url-history')).toHaveCount(0)

  // And the next navigation starts the file again.
  await page.press('.url-form input', 'Escape')
  await goto(HAIRLINE)
  await expect.poll(storedUrls).toEqual([HAIRLINE])
})
