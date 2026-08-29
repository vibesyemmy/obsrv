import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { request } from 'node:http'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONTROL_FILE_NAME, parseControlFile, type ControlInfo } from '../../src/shared/control'
import { launchApp, openOverflow, rendererWindow } from './launch'

/**
 * Drives the agent-control server over real loopback HTTP against the real
 * app (launched with OBSRV_AGENT_CONTROL=1, in its own throwaway user-data
 * dir — a dev instance on the same machine is untouched), asserting through
 * `__obsrv` that commands land in the same state the renderer drives.
 */

const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href
const TALL = pathToFileURL(resolve(__dirname, '../fixtures/tall.html')).href
const BUTTON = pathToFileURL(resolve(__dirname, '../fixtures/button.html')).href
const APP_SHELL = pathToFileURL(resolve(__dirname, '../fixtures/app-shell.html')).href

let app: ElectronApplication
let page: Page
let controlFile: string
let info: ControlInfo

interface Reply {
  status: number
  body: Record<string, unknown>
}

/** One control-protocol POST; `token: null` sends a body with no token at all. */
function call(
  command: string,
  payload?: Record<string, unknown>,
  token?: string | null,
  headers?: Record<string, string>,
): Promise<Reply> {
  return new Promise((done, fail) => {
    const body: Record<string, unknown> = { command }
    if (token !== null) body.token = token ?? info.token
    if (payload) body.payload = payload
    const data = JSON.stringify(body)
    const req = request(
      {
        host: '127.0.0.1',
        port: info.port,
        method: 'POST',
        path: '/',
        headers: { 'content-type': 'application/json', ...headers },
      },
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

test.beforeAll(async () => {
  app = await launchApp([], { OBSRV_AGENT_CONTROL: '1' })
  page = await rendererWindow(app)
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'))
  controlFile = join(userData, CONTROL_FILE_NAME)
})
test.afterAll(async () => {
  await app.close()
})

test('writes a 0600 discovery file with a port and a 64-hex token', async () => {
  await expect.poll(() => existsSync(controlFile)).toBe(true)
  expect(statSync(controlFile).mode & 0o777).toBe(0o600)
  const parsed = parseControlFile(readFileSync(controlFile, 'utf8'))
  expect(parsed).not.toBeNull()
  info = parsed!
})

test('status answers with the app state, and the toolbar shows the AGENT badge', async () => {
  const r = await call('status')
  expect(r.status).toBe(200)
  // `viewMode: 'fit'` is the app's opening view — and, because main answers
  // `status` from its own mirror of the renderer's reports, this is also the
  // check that the mirror's seed matches the store's initial value.
  expect(r.body).toMatchObject({ ok: true, presetId: '1080p-24', profileId: 'reference', viewMode: 'fit', mode: 'url' })
  expect(typeof r.body.version).toBe('string')
  expect(typeof r.body.url).toBe('string')
  // Any authenticated command nudges the renderer's activity indicator.
  await expect(page.locator('.agent-activity')).toBeVisible()
  // The force-enabled server also reads back through settings: the toggle is on.
  await openOverflow(page)
  await expect(page.locator('.overflow-menu .agent-toggle input')).toBeChecked()
  // A label leaves the menu open; later tests need the panes uncovered.
  await page.keyboard.press('Escape')
})

test('status names the tab it describes, and follows the user to another one', async () => {
  const first = await call('status')
  expect(first.status).toBe(200)
  const firstId = await app.evaluate(() => (globalThis as any).__obsrv.tabs.activeId as string)
  expect(first.body).toMatchObject({ tabId: firstId, tabIndex: 0 })

  // The marker is standing (agent control is on) and lit (a command just
  // arrived) on the one tab open, and it goes back to standing on its own —
  // the AGENT chip's ~3 s beat, read here off the tab it names.
  await expect(page.locator('.tab.driven.busy')).toHaveCount(1)
  await expect(page.locator('.tab.driven.busy')).toHaveCount(0, { timeout: 6_000 })
  await expect(page.locator('.tab.driven')).toHaveCount(1)

  // A second tab, activated the way the user would. The agent binds nothing at
  // drive start: the next status must describe where its commands would now
  // land, not where the last one did.
  const second = await app.evaluate(() => {
    const ctx = (globalThis as any).__obsrv
    const session = ctx.tabs.add()
    ctx.tabs.activate(session.id)
    return session.id as string
  })
  expect(second).not.toBe(firstId)
  await expect.poll(async () => (await call('status')).body.tabId).toBe(second)
  expect((await call('status')).body).toMatchObject({ tabId: second, tabIndex: 1 })

  // The marker follows it: agent control is on for this whole file, so the
  // driven tab is whichever one is in front — and never more than one.
  await expect(page.locator('.tab.driven')).toHaveCount(1)
  const strip = await page.locator('.tab').all()
  expect(await strip[1]!.getAttribute('class')).toContain('driven')
  expect(await strip[0]!.getAttribute('class')).not.toContain('driven')

  // Back to where the rest of the file expects to be, and the extra tab gone.
  await app.evaluate((_electron, id: string) => (globalThis as any).__obsrv.tabs.activate(id), firstId)
  await expect.poll(async () => (await call('status')).body.tabId).toBe(firstId)
  await app.evaluate((_electron, id: string) => (globalThis as any).__obsrv.tabs.close(id), second)
  await expect(page.locator('.tab')).toHaveCount(1)
  await expect(page.locator('.tab.driven')).toHaveCount(1)
})

test('a wrong or missing token is a detail-free 403; unknown commands name the allowed list', async () => {
  const wrong = await call('status', undefined, 'ff'.repeat(32))
  expect(wrong.status).toBe(403)
  expect(wrong.body).toEqual({ error: 'forbidden' })

  const missing = await call('status', undefined, null)
  expect(missing.status).toBe(403)
  expect(missing.body).toEqual({ error: 'forbidden' })

  const unknown = await call('eval')
  expect(unknown.status).toBe(400)
  expect(String(unknown.body.error)).toContain('captureVisible')
  expect(String(unknown.body.error)).toContain('navigate')
})

test('browser-shaped requests are refused before the token is even read', async () => {
  // A browser's cross-site POST always carries an Origin header; even a
  // valid token does not get it past the door.
  const origin = await call('status', undefined, undefined, { origin: 'http://evil.test' })
  expect(origin.status).toBe(403)
  expect(String(origin.body.error)).toContain('cross-origin')

  // A no-cors "simple request" cannot send application/json.
  const textPlain = await call('status', undefined, undefined, { 'content-type': 'text/plain' })
  expect(textPlain.status).toBe(415)
  expect(String(textPlain.body.error)).toContain('application/json')
})

test('navigate + setPreset over HTTP actually drive the app', async () => {
  const nav = await call('navigate', { url: FIXTURE })
  expect(nav.status).toBe(200)
  expect(nav.body).toMatchObject({ ok: true, url: FIXTURE })
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__obsrv.target.webContents.getURL()))
    .toBe(FIXTURE)

  const preset = await call('setPreset', { id: 'laptop-768' })
  expect(preset.status).toBe(200)
  expect(preset.body).toMatchObject({ ok: true, applied: true, presetId: 'laptop-768' })
  // The renderer applied it exactly as the toolbar would: its viewport effect
  // resized the offscreen target.
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__obsrv.target.getViewport()))
    .toEqual({ width: 1366, height: 768 })
  // And the toolbar select shows it — this is the visible app being driven.
  await expect(page.locator('.preset-select')).toHaveValue('laptop-768')

  // A javascript: URL never reaches the panes; the custom preset is refused.
  const bad = await call('navigate', { url: 'javascript:alert(1)' })
  expect(bad.status).toBe(400)
  expect(String(bad.body.error)).toContain('unsupported URL scheme')
  const custom = await call('setPreset', { id: 'custom' })
  expect(custom.status).toBe(400)
  expect(String(custom.body.error)).toContain('custom')
})

test('setOrientation rotates the driven app, and status reports it', async () => {
  await call('setPreset', { id: 'iphone-61' })
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__obsrv.target.getViewport()))
    .toEqual({ width: 393, height: 852 })

  const rotated = await call('setOrientation', { orientation: 'landscape' })
  expect(rotated.status).toBe(200)
  expect(rotated.body).toMatchObject({ ok: true, applied: true, orientation: 'landscape' })
  // Applied by the renderer store exactly as a toolbar click would, so its
  // viewport effect resized the offscreen target for real.
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__obsrv.target.getViewport()))
    .toEqual({ width: 852, height: 393 })
  // And the visible control moved with it: this is the user's window.
  await expect(page.locator('.orientation-control button.orient-landscape')).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  const status = await call('status')
  expect(status.body).toMatchObject({ orientation: 'landscape', presetId: 'iphone-61' })

  const bad = await call('setOrientation', { orientation: 'sideways' })
  expect(bad.status).toBe(400)
  expect(String(bad.body.error)).toContain('portrait')
  expect(String(bad.body.error)).toContain('landscape')
  // A refused payload changes nothing.
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__obsrv.target.getViewport()))
    .toEqual({ width: 852, height: 393 })

  // Restored to exactly what this test found: the specs below share one app
  // and read pane geometry, so a preset or a rotation left behind here would
  // surface as an unrelated failure three tests later.
  await call('setOrientation', { orientation: 'portrait' })
  await call('setPreset', { id: 'laptop-768' })
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__obsrv.target.getViewport()))
    .toEqual({ width: 1366, height: 768 })
})

test('captureVisible returns a real PNG of the window', async () => {
  const r = await call('captureVisible')
  expect(r.status).toBe(200)
  const { width, height, data } = r.body as { width: number; height: number; data: string }
  // The main window is at least its 900x600 minimum.
  expect(width).toBeGreaterThanOrEqual(900)
  expect(height).toBeGreaterThanOrEqual(600)
  const png = Buffer.from(data, 'base64')
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  // IHDR width (offset 16, big-endian): the raster is the window at 1x-3x.
  const ihdrWidth = png.readUInt32BE(16)
  expect(ihdrWidth).toBeGreaterThanOrEqual(width * 0.5)
  expect(ihdrWidth).toBeLessThanOrEqual(width * 3)
})

// --- v0.5 drive controls -----------------------------------------------------

/** window.scrollY of a pane's page, straight from its webContents. */
function paneScrollY(pane: 'native' | 'target'): Promise<number> {
  return app.evaluate((_electron, p: string) => {
    return (globalThis as any).__obsrv[p].webContents.executeJavaScript('window.scrollY') as Promise<number>
  }, pane)
}

test('focusWindow answers ok and fronts the window', async () => {
  const r = await call('focusWindow')
  expect(r.status).toBe(200)
  expect(r.body).toEqual({ ok: true })
  // Some runners' window managers refuse to grant focus; the command itself
  // succeeded above, so the visible effect is checked only where it can be.
  let focused = false
  for (let i = 0; i < 20 && !focused; i++) {
    focused = await app.evaluate(() => (globalThis as any).__obsrv.win.isFocused())
    if (!focused) await new Promise(res => setTimeout(res, 100))
  }
  test.skip(!focused, 'the runner did not grant window focus')
})

test('setPixelExact pins the footer magnification to the host scale', async () => {
  const bad = await call('setPixelExact', { on: 1 })
  expect(bad.status).toBe(400)
  expect(String(bad.body.error)).toContain('on: boolean')

  const r = await call('setPixelExact', { on: true })
  expect(r.status).toBe(200)
  expect(r.body).toEqual({ ok: true })
  // 1:1 explicitly: the app opens in fit, whose footer names the fit
  // magnification instead — the host scale is what pixel-exact pins.
  expect((await call('setViewMode', { mode: '1:1' })).status).toBe(200)
  const dpr = await page.evaluate(() => window.devicePixelRatio)
  await expect(page.locator('.target-pane .pane-footer')).toContainText(`×${dpr.toFixed(2)}`)
})

test('scroll drives the page offset of both panes and reports the offset reached', async () => {
  const nav = await call('navigate', { url: TALL })
  expect(nav.status).toBe(200)

  const bad = await call('scroll', { x: 0, y: -5 })
  expect(bad.status).toBe(400)
  expect(String(bad.body.error)).toContain('scroll payload')

  const r = await call('scroll', { x: 0, y: 1200 })
  expect(r.status).toBe(200)
  // A normal long page still scrolls the document root, and the round-trip
  // answers with what it actually reached rather than a bare ok.
  expect(r.body).toEqual({ ok: true, scrolled: { x: 0, y: 1200 }, scroller: 'root' })
  await expect.poll(() => paneScrollY('target'), { timeout: 5_000 }).toBe(1200)
  await expect.poll(() => paneScrollY('native'), { timeout: 5_000 }).toBe(1200)
})

test('back / forward / reload keep the Task-11 semantics over HTTP', async () => {
  const urls = () =>
    app.evaluate(() => {
      const ctx = (globalThis as any).__obsrv
      return { native: ctx.native.webContents.getURL(), target: ctx.target.webContents.getURL() }
    })

  // Native-only history: back commits in the native pane and the mirror
  // carries the target along.
  const back = await call('back')
  expect(back.status).toBe(200)
  await expect.poll(urls, { timeout: 5_000 }).toEqual({ native: FIXTURE, target: FIXTURE })

  const forward = await call('forward')
  expect(forward.status).toBe(200)
  await expect.poll(urls, { timeout: 5_000 }).toEqual({ native: TALL, target: TALL })

  // Reload reloads both panes explicitly (the mirror rightly ignores a
  // same-URL commit): a page-world marker must not survive in either.
  await app.evaluate(async () => {
    const ctx = (globalThis as any).__obsrv
    await ctx.native.webContents.executeJavaScript('window.__marker = 1')
    await ctx.target.webContents.executeJavaScript('window.__marker = 1')
  })
  const reload = await call('reload')
  expect(reload.status).toBe(200)
  const markers = () =>
    app.evaluate(async () => {
      const ctx = (globalThis as any).__obsrv
      return {
        native: (await ctx.native.webContents.executeJavaScript('typeof window.__marker')) as string,
        target: (await ctx.target.webContents.executeJavaScript('typeof window.__marker')) as string,
      }
    })
  await expect.poll(markers, { timeout: 5_000 }).toEqual({ native: 'undefined', target: 'undefined' })
})

/** `scrollTop` of a named element in a pane's page, straight from its webContents. */
function paneElementScrollTop(pane: 'native' | 'target', selector: string): Promise<number> {
  return app.evaluate(
    (_electron, [p, sel]: string[]) =>
      (globalThis as any).__obsrv[p!].webContents.executeJavaScript(
        `document.querySelector(${JSON.stringify(sel)}).scrollTop`,
      ) as Promise<number>,
    [pane, selector],
  )
}

test('scroll finds the inner scroller on an app shell whose root cannot scroll', async () => {
  // `html, body { overflow: hidden }` with a scrolling flex child: the shape
  // that made `window.scrollTo` clamp to 0 and answer ok anyway.
  const nav = await call('navigate', { url: APP_SHELL })
  expect(nav.status).toBe(200)

  const r = await call('scroll', { x: 0, y: 1500 })
  expect(r.status).toBe(200)
  expect(r.body).toEqual({ ok: true, scrolled: { x: 0, y: 1500 }, scroller: 'element' })

  // The reported offset is not the whole claim: the inner scroller really
  // moved, in both panes, while the window itself never left the top.
  await expect.poll(() => paneElementScrollTop('target', '#scroller'), { timeout: 5_000 }).toBe(1500)
  await expect.poll(() => paneElementScrollTop('native', '#scroller'), { timeout: 5_000 }).toBe(1500)
  expect(await paneScrollY('target')).toBe(0)

  // The marker at 1500 is what the pane now shows at the top of the scroller.
  const topMarker = await app.evaluate(
    () =>
      (globalThis as any).__obsrv.target.webContents.executeJavaScript(
        `(() => { const s = document.querySelector('#scroller');
                  const r = s.getBoundingClientRect();
                  return document.elementFromPoint(r.left + r.width / 2, r.top + 4).dataset.offset })()`,
      ) as Promise<string>,
  )
  expect(topMarker).toBe('1500')
})

test('scroll clamps honestly: the reported offset is the one reached, not the one asked for', async () => {
  const r = await call('scroll', { x: 0, y: 999_999 })
  expect(r.status).toBe(200)
  expect(r.body.ok).toBe(true)
  expect(r.body.scroller).toBe('element')
  const reached = r.body.scrolled as { x: number; y: number }
  expect(reached.y).toBeGreaterThan(1500)
  expect(reached.y).toBeLessThan(999_999)
  expect(await paneElementScrollTop('target', '#scroller')).toBe(reached.y)
})

test('scrollSelector targets a named container, and says so when it matches nothing', async () => {
  const back = await call('scroll', { x: 0, y: 0 })
  expect(back.status).toBe(200)

  const named = await call('scroll', { x: 0, y: 900, scrollSelector: '#scroller' })
  expect(named.status).toBe(200)
  expect(named.body).toEqual({ ok: true, scrolled: { x: 0, y: 900 }, scroller: 'element' })
  expect(await paneElementScrollTop('target', '#scroller')).toBe(900)

  // A selector that matches nothing must report the mismatch, not quietly
  // scroll something else that happens to work.
  const missing = await call('scroll', { x: 0, y: 1500, scrollSelector: '#not-here' })
  expect(missing.status).toBe(200)
  expect(missing.body.ok).toBe(true)
  expect(String((missing.body.warnings as string[])[0])).toContain('matched no element')
  expect(await paneElementScrollTop('target', '#scroller')).toBe(900)

  // A matched element that cannot scroll is reported the same honest way.
  const decoy = await call('scroll', { x: 0, y: 1500, scrollSelector: 'aside' })
  expect(decoy.status).toBe(200)
  expect(decoy.body).toMatchObject({ ok: true, scroller: 'element', scrolled: { x: 0, y: 0 } })
  expect(String((decoy.body.warnings as string[])[0])).toContain('could not reach')

  const empty = await call('scroll', { x: 0, y: 10, scrollSelector: '   ' })
  expect(empty.status).toBe(400)
  expect(String(empty.body.error)).toContain('scrollSelector')
})

test('panTo centres the target pixel in the pane, clamped to the scroll range', async () => {
  const bad = await call('panTo', { x: Infinity, y: 0 })
  expect(bad.status).toBe(400)
  expect(String(bad.body.error)).toContain('panTo payload')

  // Pixel-exact is on, so one target pixel is one CSS pixel of canvas and the
  // expected offsets need no scale terms: centring the far corner clamps each
  // axis to its maximum (canvas minus pane, floored at 0).
  const r = await call('panTo', { x: 1366, y: 768 })
  expect(r.status).toBe(200)
  expect(r.body).toEqual({ ok: true })
  const expected = await page.evaluate(() => {
    const body = document.querySelector('.target-pane .pane-body') as HTMLElement
    return {
      left: Math.max(1366 - body.clientWidth, 0),
      top: Math.max(768 - body.clientHeight, 0),
    }
  })
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const body = document.querySelector('.target-pane .pane-body') as HTMLElement
          return { left: body.scrollLeft, top: body.scrollTop }
        }),
      { timeout: 5_000 },
    )
    .toEqual(expected)
})

test('highlight draws a neutral overlay at rect × scale, replaces, and expires', async () => {
  // Park the pane back at its origin (also the panTo origin clamp) so the
  // overlay geometry below is measured in an unscrolled pane.
  await call('panTo', { x: 0, y: 0 })
  await expect
    .poll(() => page.evaluate(() => (document.querySelector('.target-pane .pane-body') as HTMLElement).scrollLeft))
    .toBe(0)

  const bad = await call('highlight', { x: 0, y: 0, width: 0, height: 10 })
  expect(bad.status).toBe(400)
  expect(String(bad.body.error)).toContain('at least 1x1')

  const first = await call('highlight', { x: 100, y: 50, width: 200, height: 80, durationMs: 8000 })
  expect(first.status).toBe(200)
  const overlay = page.locator('.agent-highlight')
  await expect(overlay).toHaveCount(1)
  // Pixel-exact scale: one target pixel = one CSS pixel, so the overlay box
  // is the rect itself, offset by the canvas origin.
  const canvas = await page.locator('.target-canvas').boundingBox()
  const box = await overlay.boundingBox()
  expect(box).not.toBeNull()
  expect(Math.abs(box!.x - (canvas!.x + 100))).toBeLessThanOrEqual(2)
  expect(Math.abs(box!.y - (canvas!.y + 50))).toBeLessThanOrEqual(2)
  expect(Math.abs(box!.width - 200)).toBeLessThanOrEqual(2)
  expect(Math.abs(box!.height - 80)).toBeLessThanOrEqual(2)

  // A new highlight replaces the previous one — still exactly one overlay,
  // now at the new geometry — and expires after its own (clamped) duration.
  const second = await call('highlight', { x: 300, y: 120, width: 60, height: 40, durationMs: 500 })
  expect(second.status).toBe(200)
  await expect.poll(async () => (await overlay.boundingBox())?.width, { timeout: 3_000 }).toBe(60)
  await expect(overlay).toHaveCount(1)
  await expect(overlay).toHaveCount(0, { timeout: 3_000 })
})

test('a preset change clears a showing highlight (its long timer never fires late)', async () => {
  const r = await call('highlight', { x: 10, y: 10, width: 100, height: 60, durationMs: 8000 })
  expect(r.status).toBe(200)
  const overlay = page.locator('.agent-highlight')
  await expect(overlay).toHaveCount(1)

  // The rect marked pixels of the laptop-768 raster; a preset change
  // re-rasters the target, so the overlay is dropped with the old content —
  // well before its own 8 s lifetime.
  const preset = await call('setPreset', { id: '1080p-24' })
  expect(preset.status).toBe(200)
  expect(preset.body).toMatchObject({ ok: true, applied: true })
  await expect(overlay).toHaveCount(0)
})

test('click reaches the live page and can act on it; out-of-viewport is refused', async () => {
  const nav = await call('navigate', { url: BUTTON })
  expect(nav.status).toBe(200)

  const outside = await call('click', { x: 5000, y: 10 })
  expect(outside.status).toBe(400)
  expect(String(outside.body.error)).toContain('outside the current CSS viewport')

  const r = await call('click', { x: 100, y: 100 })
  expect(r.status).toBe(200)
  expect(r.body).toEqual({ ok: true })
  await expect
    .poll(
      () => app.evaluate(() => (globalThis as any).__obsrv.target.webContents.executeJavaScript('document.title')),
      { timeout: 5_000 },
    )
    .toBe('clicked')
})

test('captureTarget returns a PNG of just the target pane', async () => {
  const whole = await call('captureVisible')
  expect(whole.status).toBe(200)
  const wholePng = Buffer.from((whole.body as { data: string }).data, 'base64')

  const r = await call('captureTarget')
  expect(r.status).toBe(200)
  expect(r.body).toMatchObject({ ok: true, warnings: [] })
  const png = Buffer.from((r.body as { data: string }).data, 'base64')
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  // The raster is the pane's CSS bounds × the display scale (tolerant: the
  // capture rounds, and the pane can move a pixel between measurements).
  const { bounds, dpr } = await page.evaluate(() => {
    const rect = (document.querySelector('.target-pane') as HTMLElement).getBoundingClientRect()
    return { bounds: { width: rect.width, height: rect.height }, dpr: window.devicePixelRatio }
  })
  const ihdrW = png.readUInt32BE(16)
  const ihdrH = png.readUInt32BE(20)
  expect(Math.abs(ihdrW - bounds.width * dpr)).toBeLessThanOrEqual(Math.max(8, bounds.width * dpr * 0.02))
  expect(Math.abs(ihdrH - bounds.height * dpr)).toBeLessThanOrEqual(Math.max(8, bounds.height * dpr * 0.02))
  // And it is a crop, not the window: strictly narrower than the full capture.
  expect(ihdrW).toBeLessThan(wholePng.readUInt32BE(16))
})

test('setPanes gives the target the window and reports it in status', async () => {
  const applied = await call('setPanes', { panes: 'target' })
  expect(applied.status).toBe(200)
  expect(applied.body).toMatchObject({ ok: true, applied: true, panes: 'target' })
  // The native pane is really gone from the layout, not merely reported gone.
  await expect(page.locator('.native-slot')).toHaveCount(0)
  // And a plain status agrees — this is the state an agent reads before a capture.
  expect((await call('status')).body).toMatchObject({ ok: true, panes: 'target' })

  const back = await call('setPanes', { panes: 'both' })
  expect(back.status).toBe(200)
  expect(back.body).toMatchObject({ ok: true, applied: true, panes: 'both' })
  await expect(page.locator('.native-slot')).toHaveCount(1)
})

test('setPanes refuses an unknown value', async () => {
  const bad = await call('setPanes', { panes: 'native' })
  expect(bad.status).toBe(400)
  expect(String(bad.body.error)).toContain('setPanes payload')
  // Refused, not half-applied: both panes are still up.
  await expect(page.locator('.native-slot')).toHaveCount(1)
})

test('toggling agent control off stops the server and removes the discovery file', async () => {
  // The real user flow: the toolbar toggle persists agentControl: false and
  // main stops the server.
  await openOverflow(page)
  await page.click('.overflow-menu .agent-toggle')
  await expect(page.locator('.overflow-menu .agent-toggle input')).not.toBeChecked()
  await page.keyboard.press('Escape')
  await expect.poll(() => existsSync(controlFile)).toBe(false)
  await expect(call('status')).rejects.toThrow(/ECONNREFUSED/)
})
