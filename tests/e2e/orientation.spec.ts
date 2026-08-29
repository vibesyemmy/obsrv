import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp, rendererWindow } from './launch'

const ORIENTATION = pathToFileURL(resolve(__dirname, '../fixtures/orientation.html')).href
const NO_VIEWPORT = pathToFileURL(resolve(__dirname, '../fixtures/no-viewport.html')).href

/**
 * Rotation is a renderer-side axis swap that has to survive the whole pipeline:
 * store → `setViewport` → the offscreen window's content size → the raster
 * Chromium actually produces → the page's own layout. Asserting the store alone
 * would pass while the pixels stayed portrait, so every test here reads either
 * the emitted frame or the target page.
 *
 * The fixture keys its layout off `@media (orientation)`, which is the reading
 * the swap is meant to make true — and `no-viewport.html` covers the case that
 * has to be right for phones: with no `<meta viewport>`, `applyEmulation`'s
 * screenSize/viewSize must carry the rotated dims or the page lays out against
 * a portrait virtual viewport inside a landscape raster.
 */

let app: ElectronApplication
let page: Page

async function installFrameHelper(a: ElectronApplication): Promise<void> {
  await a.evaluate(() => {
    ;(globalThis as any).__waitForFrame = (target: any, matches: (f: any) => boolean, label: string) =>
      new Promise<any>((res, rej) => {
        const timer = setTimeout(() => {
          target.off('frame', onFrame)
          rej(new Error(`no ${label} paint within 10s`))
        }, 10_000)
        const onFrame = (f: any): void => {
          if (!matches(f)) return
          clearTimeout(timer)
          target.off('frame', onFrame)
          res(f)
        }
        target.on('frame', onFrame)
      })
  })
}

/** The target page's value for `expr`, or `fallback` while it is mid-navigation. */
async function inTarget(expr: string, fallback: unknown = null): Promise<unknown> {
  return app.evaluate(
    async (_e, arg: { expr: string; fallback: unknown }) => {
      const ctx = (globalThis as any).__obsrv
      try {
        return await ctx.target.webContents.executeJavaScript(arg.expr)
      } catch {
        return arg.fallback
      }
    },
    { expr, fallback },
  )
}

const viewport = (): Promise<{ width: number; height: number }> =>
  app.evaluate(() => (globalThis as any).__obsrv.target.getViewport())

/**
 * The button that *produces* the named shape — which is how the control reads
 * to a user, and deliberately not the same thing as the stored flag. For a
 * phone (portrait-natural) the two coincide; for a monitor preset, stored
 * landscape-natural, `shape('portrait')` is the button carrying the landscape
 * flag. The invariant every test below leans on: the pressed button is always
 * the one whose glyph matches the screen's actual shape.
 */
const shape = (s: 'portrait' | 'landscape') =>
  page.locator(`.orientation-control button.orient-${s}`)

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
  await installFrameHelper(app)
})
test.afterAll(async () => {
  await app.close()
})

test('the pressed button is the one whose glyph matches the screen, without hue', async () => {
  // The app opens on 1080p-24, which the table stores landscape-natural — so
  // the wide glyph is the pressed one even though the stored flag is
  // 'portrait'. That divergence is the whole reason the buttons are labelled
  // by shape.
  await expect(shape('landscape')).toHaveAttribute('aria-pressed', 'true')
  await expect(shape('portrait')).toHaveAttribute('aria-pressed', 'false')

  // Every grey in the chrome is exactly neutral (UI style spec rule 1), and the
  // pressed marker is the same fill step the rest of the row uses — not colour.
  const [pressed, resting] = await page.evaluate(() => {
    const buttons = document.querySelectorAll<HTMLElement>('.orientation-control button')
    return [...buttons].map(b => getComputedStyle(b).backgroundColor)
  })
  const channels = (rgb: string): number[] => rgb.match(/\d+/g)!.slice(0, 3).map(Number)
  for (const colour of [pressed!, resting!]) {
    const [r, g, b] = channels(colour)
    expect(r).toBe(g)
    expect(g).toBe(b)
  }
  expect(pressed).not.toBe(resting)
})

test('rotating a phone preset swaps the real raster, not just the store', async () => {
  await page.selectOption('.preset-select', 'iphone-61')
  await expect.poll(() => inTarget('devicePixelRatio', 0)).toBe(3)
  await expect.poll(viewport).toEqual({ width: 393, height: 852 })

  await shape('landscape').click()
  await expect(shape('landscape')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(viewport).toEqual({ width: 852, height: 393 })

  // The frame is the product's actual claim: 852×393 CSS at 3x is 2556×1179
  // device pixels, the transpose of the portrait raster.
  const f = await app.evaluate(async () => {
    const ctx = (globalThis as any).__obsrv
    const painted = (globalThis as any).__waitForFrame(
      ctx.target,
      (m: any) => m.frameWidth === 2556 && m.frameHeight === 1179,
      '2556x1179',
    )
    ctx.target.invalidate()
    const m = await painted
    return { width: m.frameWidth, height: m.frameHeight, dsf: ctx.target.getDeviceScaleFactor() }
  })
  expect(f).toEqual({ width: 2556, height: 1179, dsf: 3 })

  // The density is untouched: rotation is the same panel turned sideways.
  await expect.poll(() => inTarget('devicePixelRatio', 0)).toBe(3)

  await shape('portrait').click()
  await expect.poll(viewport).toEqual({ width: 393, height: 852 })
})

test('the page itself sees landscape: CSS media query and screen dimensions', async () => {
  await page.selectOption('.preset-select', 'iphone-61')
  await expect.poll(() => inTarget('devicePixelRatio', 0)).toBe(3)
  await shape('portrait').click()
  await page.evaluate(u => window.obsrv.navigate(u), ORIENTATION)
  await expect
    .poll(() => inTarget('document.title', ''), { timeout: 10_000 })
    .toBe('orientation-fixture')

  await expect.poll(() => inTarget('matchMedia("(orientation: landscape)").matches', null)).toBe(false)
  await expect.poll(() => inTarget('innerWidth', 0)).toBe(393)

  await shape('landscape').click()
  // The reading the whole feature exists to make true.
  await expect
    .poll(() => inTarget('matchMedia("(orientation: landscape)").matches', null), { timeout: 10_000 })
    .toBe(true)
  await expect.poll(() => inTarget('innerWidth', 0)).toBe(852)
  await expect.poll(() => inTarget('innerHeight', 0)).toBe(393)
  // `screen` follows the offscreen window, so it is rotated too.
  await expect.poll(() => inTarget('screen.width + "x" + screen.height', '')).toBe('852x393')

  await shape('portrait').click()
  await expect
    .poll(() => inTarget('matchMedia("(orientation: landscape)").matches', null), { timeout: 10_000 })
    .toBe(false)
})

test('a page with no viewport meta lays out against the rotated virtual viewport', async () => {
  // The case `applyEmulation` exists for. Without the rotated screenSize the
  // page would lay out at a portrait virtual viewport inside a landscape
  // raster — the exact failure that makes a landscape check worthless.
  await page.selectOption('.preset-select', 'iphone-61')
  await expect.poll(() => inTarget('devicePixelRatio', 0)).toBe(3)
  await shape('landscape').click()
  await page.evaluate(u => window.obsrv.navigate(u), NO_VIEWPORT)
  await expect
    .poll(() => inTarget('document.title', ''), { timeout: 10_000 })
    .toBe('no-viewport-fixture')

  // Chromium's 980px virtual viewport is width-only; the *height* is what
  // proves the emulated screen rotated with the window. 393×852 portrait gives
  // a virtual height of 852/393×980 ≈ 2124; 852×393 landscape gives
  // 393/852×980 ≈ 452.
  await expect.poll(() => inTarget('innerWidth', 0), { timeout: 10_000 }).toBe(980)
  const height = (await inTarget('innerHeight', 0)) as number
  expect(height).toBeGreaterThan(400)
  expect(height).toBeLessThan(600)

  await shape('portrait').click()
  await expect.poll(() => inTarget('innerHeight', 0), { timeout: 10_000 }).toBeGreaterThan(2000)
})

test('rotation applies to a monitor preset, and the footer names the shape it produces', async () => {
  await page.selectOption('.preset-select', '1080p-24')
  await expect.poll(viewport).toEqual({ width: 1920, height: 1080 })
  const footer = page.locator('.target-pane .pane-footer')
  await expect(footer).toContainText('1920×1080 landscape')

  // A 1080p monitor stood on end is a real setup, and reaching it is one click
  // on the tall glyph — no special-casing for non-mobile presets anywhere.
  await shape('portrait').click()
  await expect.poll(viewport).toEqual({ width: 1080, height: 1920 })
  await expect(footer).toContainText('1080×1920 portrait')
  await expect(shape('portrait')).toHaveAttribute('aria-pressed', 'true')

  await shape('landscape').click()
  await expect(footer).toContainText('1920×1080 landscape')
})

test('orientation is per tab, like the preset it rotates', async () => {
  await page.selectOption('.preset-select', 'iphone-61')
  await shape('landscape').click()
  await expect.poll(viewport).toEqual({ width: 852, height: 393 })

  await page.locator('.tab-new').click()
  await expect(page.locator('.chrome-tabs [role="tab"]')).toHaveCount(2)
  // A fresh tab opens unrotated on its own screen (1080p-24, landscape); the
  // first tab's rotation must not have followed it.
  await expect(shape('landscape')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(viewport).toEqual({ width: 1920, height: 1080 })

  await page.locator('.chrome-tabs [role="tab"]').nth(0).click()
  await expect(shape('landscape')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(viewport).toEqual({ width: 852, height: 393 })

  // Closing the other tab leaves this one's rotation exactly as it was: the
  // close reshuffles the strip, and a rotation that rode the reshuffle would
  // be the same class of cross-tab leak the per-tab state exists to stop.
  // `.tab-close` is a sibling of the `[role="tab"]` label, not a descendant.
  await page.locator('.chrome-tabs .tab').nth(1).locator('.tab-close').click()
  await expect(page.locator('.chrome-tabs [role="tab"]')).toHaveCount(1)
  await expect(shape('landscape')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(viewport).toEqual({ width: 852, height: 393 })

  await shape('portrait').click()
  await expect.poll(viewport).toEqual({ width: 393, height: 852 })
})

/**
 * A single launch cannot prove what survives a quit, so this owns its own
 * user-data directory and launches twice — the same shape as the tab-restore
 * block in tabs.spec.ts.
 */
test.describe('rotation survives a relaunch', () => {
  const dirs: string[] = []
  const dir = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'obsrv-orient-'))
    dirs.push(d)
    return d
  }
  test.afterAll(() => {
    while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
  })

  test('a rotated tab comes back rotated', async () => {
    const home = dir()
    const first = await launchApp([], {}, home)
    const p1 = await rendererWindow(first)

    await p1.evaluate(u => window.obsrv.navigate(u), ORIENTATION)
    await expect(p1.locator('.chrome-tabs [role="tab"]').nth(0)).toHaveText('orientation-fixture')
    await p1.selectOption('.preset-select', 'iphone-61')
    await p1.locator('.orientation-control button.orient-landscape').click()
    await expect(p1.locator('.orientation-control button.orient-landscape')).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    // The write is on change, not on quit, so the file is already there — and
    // it is the file, not a lucky in-memory value, that the next launch reads.
    await expect.poll(() => existsSync(join(home, 'tabs.json')), { timeout: 5_000 }).toBe(true)
    await expect
      .poll(() => JSON.parse(readFileSync(join(home, 'tabs.json'), 'utf8')).tabs[0].orientation, {
        timeout: 5_000,
      })
      .toBe('landscape')
    await first.close()

    const second = await launchApp([], {}, home)
    const p2 = await rendererWindow(second)
    await expect(p2.locator('.orientation-control button.orient-landscape')).toHaveAttribute(
      'aria-pressed',
      'true',
      { timeout: 10_000 },
    )
    await expect
      .poll(() => second.evaluate(() => (globalThis as any).__obsrv.target.getViewport()), {
        timeout: 10_000,
      })
      .toEqual({ width: 852, height: 393 })
    await second.close()
  })

  test('a tabs.json with a junk orientation opens portrait rather than failing', async () => {
    const home = dir()
    // Written by hand, the way a corrupted or hand-edited file arrives: a
    // malformed value must cost the user the rotation, never the app.
    const { writeFileSync } = await import('node:fs')
    writeFileSync(
      join(home, 'tabs.json'),
      JSON.stringify({
        tabs: [{ url: ORIENTATION, presetId: 'iphone-61', profileId: 'reference', orientation: 'sideways' }],
        activeIndex: 0,
      }),
    )
    const only = await launchApp([], {}, home)
    const p = await rendererWindow(only)
    await expect(p.locator('.orientation-control button.orient-portrait')).toHaveAttribute(
      'aria-pressed',
      'true',
      { timeout: 10_000 },
    )
    await expect
      .poll(() => only.evaluate(() => (globalThis as any).__obsrv.target.getViewport()), { timeout: 10_000 })
      .toEqual({ width: 393, height: 852 })
    await only.close()
  })
})
