import { test, expect, type ElectronApplication } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONTROL_FILE_NAME } from '../../src/shared/control'
import { launchApp, rendererWindow } from './launch'

/**
 * The MCP server against a *running*, control-enabled app: `obsrv_snap`
 * auto-discovers it and goes live, `obsrv_drive` flips visible state. The
 * server is pointed at the test app's isolated user-data dir through
 * OBSRV_CONTROL_FILE, so a real Obsrv the developer has open is never
 * touched (and can never hijack the test).
 */

const ROOT = resolve(__dirname, '../..')
const MCP_BIN = resolve(ROOT, 'bin/obsrv-mcp.js')
const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href

// A headless-override render boots a full Electron; same budgets as mcp.spec.
const CALL_TIMEOUT_MS = 150_000
test.describe.configure({ timeout: 180_000 })

let app: ElectronApplication
let client: Client

test.beforeAll(async () => {
  app = await launchApp([], { OBSRV_AGENT_CONTROL: '1' })
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'))
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  )
  client = new Client({ name: 'obsrv-mcp-live-spec', version: '0.0.0' })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [MCP_BIN],
      cwd: ROOT,
      env: { ...env, OBSRV_CONTROL_FILE: join(userData, CONTROL_FILE_NAME) },
    }),
  )
})

test.afterAll(async () => {
  await client?.close()
  await app?.close()
})

const call = (name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
  client.callTool({ name, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS }) as Promise<CallToolResult>

test('obsrv_snap (auto) drives the visible app and captures its window', async () => {
  const r = await call('obsrv_snap', { url: FIXTURE, preset: 'laptop-768' })
  expect(r.isError).toBeFalsy()

  const meta = r.structuredContent as Record<string, unknown>
  expect(meta).toMatchObject({
    mode: 'live',
    url: FIXTURE,
    presetId: 'laptop-768',
    profileId: 'reference',
    settled: true,
  })
  expect(meta.width as number).toBeGreaterThanOrEqual(900)
  expect(meta.height as number).toBeGreaterThanOrEqual(600)

  // The PNG on disk is the app window (not a headless render).
  expect(existsSync(meta.pngPath as string)).toBe(true)
  const png = readFileSync(meta.pngPath as string)
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  // The app really navigated and resized — visible state, not a simulation.
  expect(await app.evaluate(() => (globalThis as any).__obsrv.target.webContents.getURL())).toBe(FIXTURE)
  expect(await app.evaluate(() => (globalThis as any).__obsrv.target.getViewport())).toEqual({ width: 1366, height: 768 })
})

test('obsrv_drive flips the preset and returns the confirming status', async () => {
  const r = await call('obsrv_drive', { preset: '1080p-27', profile: 'budget-tn' })
  expect(r.isError).toBeFalsy()
  expect(r.structuredContent).toMatchObject({ presetId: '1080p-27', profileId: 'budget-tn', mode: 'url' })
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__obsrv.target.getViewport()))
    .toEqual({ width: 1920, height: 1080 })
})

test('obsrv_drive sets the text scale; the page reflows and the status confirms it', async () => {
  const innerWidth = (): Promise<number> =>
    app.evaluate(() => (globalThis as any).__obsrv.target.webContents.executeJavaScript('innerWidth'))
  const r = await call('obsrv_drive', { textScale: 1.5 })
  expect(r.isError).toBeFalsy()
  expect(r.structuredContent).toMatchObject({ textScale: 1.5 })
  await expect.poll(innerWidth).toBe(1280)
  const back = await call('obsrv_drive', { textScale: 1 })
  expect(back.structuredContent).toMatchObject({ textScale: 1 })
  await expect.poll(innerWidth).toBe(1920)
})

test('obsrv_snap mode:"headless" ignores the running app', async () => {
  const r = await call('obsrv_snap', { url: FIXTURE, preset: 'laptop-768', mode: 'headless' })
  expect(r.isError).toBeFalsy()
  const meta = r.structuredContent as Record<string, unknown>
  // A headless render of the page, not a window capture: CLI metadata shape.
  expect(meta).toMatchObject({ mode: 'headless', preset: 'laptop-768', cssWidth: 1366, cssHeight: 768 })
})

test('one obsrv_drive call combines preset + scroll + highlight and returns the final status', async () => {
  const TALL = pathToFileURL(resolve(__dirname, '../fixtures/tall.html')).href
  const r = await call('obsrv_drive', {
    focus: true,
    url: TALL,
    preset: 'laptop-768',
    scroll: { x: 0, y: 800 },
    highlight: { x: 40, y: 40, width: 120, height: 60, durationMs: 8000 },
  })
  expect(r.isError).toBeFalsy()
  // The result is the final status, reflecting everything that ran — plus the
  // scroll round-trip, so an agent can tell a scroll from a clamp.
  expect(r.structuredContent).toMatchObject({
    url: TALL,
    presetId: 'laptop-768',
    mode: 'url',
    scrolled: { x: 0, y: 800 },
    scroller: 'root',
  })

  // The steering really happened in the visible app: the preset resized the
  // target, the scroll landed in both panes, the overlay is up.
  expect(await app.evaluate(() => (globalThis as any).__obsrv.target.getViewport())).toEqual({ width: 1366, height: 768 })
  const scrollY = (pane: 'native' | 'target') =>
    app.evaluate(
      (_e, p: string) => (globalThis as any).__obsrv[p].webContents.executeJavaScript('window.scrollY') as Promise<number>,
      pane,
    )
  await expect.poll(() => scrollY('target'), { timeout: 5_000 }).toBe(800)
  await expect.poll(() => scrollY('native'), { timeout: 5_000 }).toBe(800)
  const page = await rendererWindow(app)
  await expect(page.locator('.agent-highlight')).toHaveCount(1)
})

test('a scroll in the same call as a preset waits for the resize', async () => {
  // A preset change reloads the page at a new viewport. Scrolling before that
  // lands finds the pre-reflow document: on an app shell that is the root
  // rather than the inner scroller, and the offset clamps to 0. The two must
  // work in one call, in the documented order.
  const APP_SHELL = pathToFileURL(resolve(__dirname, '../fixtures/app-shell.html')).href
  await call('obsrv_drive', { url: APP_SHELL, preset: '1080p-24' })

  const started = Date.now()
  const r = await call('obsrv_drive', { preset: 'laptop-768', scroll: { x: 0, y: 1500 } })
  const elapsed = Date.now() - started

  expect(r.isError).toBeFalsy()
  expect(r.structuredContent).toMatchObject({
    presetId: 'laptop-768',
    scrolled: { x: 0, y: 1500 },
    scroller: 'element',
  })

  // The outcome alone cannot prove the wait happened: a local fixture reloads
  // fast enough to win the race by luck, which is exactly why the bug only
  // showed on a real site. Assert the mechanism instead — settling costs two
  // stable viewport polls, a forced repaint and a draw window, so a call that
  // skipped it comes back in tens of milliseconds.
  expect(elapsed).toBeGreaterThan(200)
})

test('obsrv_drive reports the inner scroller it found on an app shell', async () => {
  const APP_SHELL = pathToFileURL(resolve(__dirname, '../fixtures/app-shell.html')).href
  const r = await call('obsrv_drive', { url: APP_SHELL, scroll: { x: 0, y: 1500 } })
  expect(r.isError).toBeFalsy()
  // `window.scrollTo` would clamp to 0 here and used to answer a bare ok.
  expect(r.structuredContent).toMatchObject({ url: APP_SHELL, scrolled: { x: 0, y: 1500 }, scroller: 'element' })

  const miss = await call('obsrv_drive', { scroll: { x: 0, y: 100, scrollSelector: '#absent' } })
  expect(miss.isError).toBeFalsy()
  expect((miss.structuredContent as { warnings: string[] }).warnings.join(' ')).toMatch(/matched no element/)
})

test('a click that navigates is reflected in the returned obsrv_drive status', async () => {
  // link.html is one viewport-filling <a href="hairline.html">: the drive
  // call's click navigates the target, and the server's bounded settle poll
  // must return the post-navigation URL, not the page that was clicked.
  const LINK = pathToFileURL(resolve(__dirname, '../fixtures/link.html')).href
  const r = await call('obsrv_drive', { url: LINK, click: { x: 100, y: 100 } })
  expect(r.isError).toBeFalsy()
  expect((r.structuredContent as Record<string, unknown>).url).toBe(FIXTURE)
})

test('obsrv_snap live capture:"pane" returns a PNG smaller than the window capture', async () => {
  const whole = await call('obsrv_snap', { url: FIXTURE, preset: 'laptop-768' })
  expect(whole.isError).toBeFalsy()
  const wholeMeta = whole.structuredContent as Record<string, unknown>
  expect(wholeMeta.mode).toBe('live')

  const pane = await call('obsrv_snap', { url: FIXTURE, preset: 'laptop-768', capture: 'pane' })
  expect(pane.isError).toBeFalsy()
  const paneMeta = pane.structuredContent as Record<string, unknown>
  expect(paneMeta.mode).toBe('live')
  expect(existsSync(paneMeta.pngPath as string)).toBe(true)
  const png = readFileSync(paneMeta.pngPath as string)
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  // The pane is a crop of the window: strictly smaller on both axes.
  expect(paneMeta.width as number).toBeLessThan(wholeMeta.width as number)
  expect(paneMeta.height as number).toBeLessThan(wholeMeta.height as number)
})

const TALL = pathToFileURL(resolve(__dirname, '../fixtures/tall.html')).href

const paneScrollY = (a: ElectronApplication): Promise<number> =>
  a.evaluate(() => (globalThis as any).__obsrv.target.webContents.executeJavaScript('window.scrollY') as Promise<number>)

test('a capture after a preset change shows the new preset, cropped to the render', async () => {
  // One assertion, two defects. Before the fix the capture cropped to the
  // *pane* (landscape, whatever the preset) and fired before the resize had
  // landed (so it showed the *previous* preset). A phone preset is portrait,
  // so only cropping to the render AND waiting for the resize makes this hold.
  await call('obsrv_drive', { url: FIXTURE, preset: '1080p-24', capture: 'pane' })

  const phone = await call('obsrv_drive', { preset: 'iphone-61', capture: 'pane' })
  expect(phone.isError).toBeFalsy()
  const m = phone.structuredContent as Record<string, number>

  expect(m.height).toBeGreaterThan(m.width)
  expect(m.width / m.height).toBeCloseTo(393 / 852, 1)
})

test('a desktop capture in fit mode hugs the render', async () => {
  // At 1:1 a desktop render overflows the pane, so the crop is correctly the
  // visible part — pane-shaped. In fit mode the whole render is inside the
  // pane, so cropping to it must give the preset's aspect and nothing else.
  const fit = await call('obsrv_drive', { preset: '1080p-24', viewMode: 'fit', capture: 'pane' })
  expect(fit.isError).toBeFalsy()
  const m = fit.structuredContent as Record<string, number>
  expect(m.width / m.height).toBeCloseTo(1920 / 1080, 1)

  // And back to 1:1, where the crop is the pane because the render overflows.
  await call('obsrv_drive', { viewMode: '1:1' })
})

test('obsrv_drive captures the scrolled state it just produced', async () => {
  const r = await call('obsrv_drive', {
    url: TALL,
    preset: 'laptop-768',
    scroll: { x: 0, y: 900 },
    capture: 'pane',
  })
  expect(r.isError).toBeFalsy()

  const meta = r.structuredContent as Record<string, unknown>
  expect(meta).toMatchObject({ url: TALL, scrolled: { x: 0, y: 900 }, scroller: 'root' })

  expect(existsSync(meta.pngPath as string)).toBe(true)
  const png = readFileSync(meta.pngPath as string)
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  expect(meta.width as number).toBeGreaterThan(0)
  expect(meta.height as number).toBeGreaterThan(0)

  // The point of the whole thing: capturing did not reset the page. A capture
  // that navigated to take the shot would leave the pane back at the top.
  expect(await paneScrollY(app)).toBe(900)
})

test('a live obsrv_snap of the page already showing keeps its scroll position', async () => {
  await call('obsrv_drive', { url: TALL, preset: 'laptop-768' })
  const scrolled = await call('obsrv_drive', { scroll: { x: 0, y: 1200 } })
  expect(scrolled.structuredContent).toMatchObject({ scrolled: { x: 0, y: 1200 } })

  // Same URL: no reload, so the capture shows where the page actually is.
  const same = await call('obsrv_snap', { url: TALL, capture: 'pane' })
  expect(same.isError).toBeFalsy()
  expect(same.structuredContent).toMatchObject({ mode: 'live', url: TALL, navigated: false, settled: true })
  expect(await paneScrollY(app)).toBe(1200)

  // A different URL is a real navigation, and a fresh load starts at the top.
  const moved = await call('obsrv_snap', { url: FIXTURE, capture: 'pane' })
  expect(moved.isError).toBeFalsy()
  expect(moved.structuredContent).toMatchObject({ mode: 'live', url: FIXTURE, navigated: true })
  expect(await paneScrollY(app)).toBe(0)
})

test('a drive on a second tab is answered by that tab, and leaves the first alone', async () => {
  // `scrollResult` is the other process-global channel a second session can
  // speak on. Before the sender router its one listener was bound to the panes
  // of whichever session booted, so a scroll driven on any later tab was
  // answered by a webContents the listener refused — the reply was dropped and
  // the agent was told the offset could not be confirmed. The reported
  // `scrolled` here is that round trip, made on a tab that did not boot.
  const scrollY = (id: string, pane: 'native' | 'target'): Promise<number> =>
    app.evaluate((_e, arg: { id: string; pane: string }) => {
      const ctx = (globalThis as any).__obsrv
      const session = ctx.tabs.tabs.find((t: any) => t.id === arg.id)
      return session[arg.pane].webContents.executeJavaScript('window.scrollY') as Promise<number>
    }, { id, pane })

  const first = await app.evaluate(() => (globalThis as any).__obsrv.tabs.activeId as string)
  const before = await scrollY(first, 'target')
  const second = await app.evaluate(() => {
    const ctx = (globalThis as any).__obsrv
    const session = ctx.tabs.add()
    if (!session) throw new Error('the tab cap refused a second tab')
    ctx.tabs.activate(session.id)
    return session.id as string
  })

  const r = await call('obsrv_drive', { url: TALL, preset: 'laptop-768', scroll: { x: 0, y: 900 } })
  expect(r.isError).toBeFalsy()
  expect(r.structuredContent).toMatchObject({ url: TALL, scrolled: { x: 0, y: 900 }, scroller: 'root' })

  await expect.poll(() => scrollY(second, 'target'), { timeout: 5_000 }).toBe(900)
  await expect.poll(() => scrollY(second, 'native'), { timeout: 5_000 }).toBe(900)
  // The tab that booted was not driven and was not scrolled by the drive.
  expect(await scrollY(first, 'target')).toBe(before)

  await app.evaluate((_e, id: string) => (globalThis as any).__obsrv.tabs.close(id), second)
})

test('obsrv_inspect (auto) inspects the running app: the page it is navigated to, on the screen in force', async () => {
  const contrast = pathToFileURL(resolve(__dirname, '../fixtures/contrast.html')).href
  const r = await call('obsrv_inspect', { url: contrast, selector: '#grey' })
  expect(r.isError).toBeFalsy()
  const m = r.structuredContent as { mode: string; found: boolean; url: string; preset: string; readout: { id: string; font: { px: number }; contrast: { asIs: number } } }
  expect(m.mode).toBe('live')
  expect(m.found).toBe(true)
  expect(m.url).toContain('contrast.html')
  expect(m.readout.id).toBe('grey')
  expect(m.readout.font.px).toBe(13)
  expect(m.readout.contrast.asIs).toBeCloseTo(4.84, 1)
  // A point works too, and nothing there is found: false.
  const at = await call('obsrv_inspect', { at: { x: 20, y: 17 } })
  expect((at.structuredContent as { readout: { id: string } }).readout.id).toBe('grey')
  const off = await call('obsrv_inspect', { selector: '#nope' })
  expect(off.structuredContent).toMatchObject({ mode: 'live', found: false })
})

test('obsrv_audit (auto) audits the running app on the screen in force, and names the tab', async () => {
  const auditPage = pathToFileURL(resolve(__dirname, '../fixtures/audit.html')).href
  await call('obsrv_drive', { preset: '1080p-24', textScale: 1 })
  const r = await call('obsrv_audit', { url: auditPage })
  expect(r.isError).toBeFalsy()
  const m = r.structuredContent as {
    mode: string
    url: string
    preset: string
    tabId: string
    tabIndex: number
    cssWidth: number
    textScale?: number
    ppi: number
    thresholds: { tapMm: number; textMm: number }
    summary: { targets: { count: number; under: number } }
    findings: { kind: string; element: string; mm: number }[]
    notes: string[]
  }
  // The same numbers the headless audit reports for this fixture on a 24" 1080p (mcp.spec / cli-audit.spec).
  expect(m).toMatchObject({ mode: 'live', preset: '1080p-24', tabIndex: 0, cssWidth: 1920, thresholds: { tapMm: 7, textMm: 2 }, notes: [] })
  expect(m.url).toContain('audit.html')
  expect(typeof m.tabId).toBe('string')
  expect(m.textScale).toBeUndefined()
  expect(m.ppi).toBeCloseTo(91.8, 1)
  expect(m.summary.targets).toMatchObject({ count: 2, under: 1 })
  expect(m.findings).toHaveLength(1)
  expect(m.findings[0]).toMatchObject({ kind: 'small-target', element: 'button#tiny' })
  expect(m.findings[0]!.mm).toBeCloseTo(6.64, 1)
  // Headless-only options are ignored live, with a note each; the thresholds are honoured.
  const noted = await call('obsrv_audit', { preset: 'android-65', tapMm: 6 })
  expect(noted.structuredContent).toMatchObject({ mode: 'live', preset: '1080p-24', thresholds: { tapMm: 6, textMm: 2 } })
  expect((noted.structuredContent as { notes: string[] }).notes.join(' ')).toContain('`preset` is headless-only')
  expect((noted.structuredContent as { summary: { targets: { under: number } } }).summary.targets.under).toBe(0)
  // mode: 'headless' never touches the app, and needs a url.
  const headless = await call('obsrv_audit', { url: auditPage, preset: 'android-65', mode: 'headless' })
  expect(headless.structuredContent).toMatchObject({ mode: 'headless', preset: 'android-65', cssWidth: 360 })
  const nourl = await call('obsrv_audit', { mode: 'headless' })
  expect(nourl.isError).toBe(true)
})

test('obsrv_drive sets a throttle on the live target; status and the footer report it', async () => {
  const r = await call('obsrv_drive', { throttle: 'cpu-6x' })
  expect(r.isError).toBeFalsy()
  expect(r.structuredContent).toMatchObject({ throttle: 'cpu-6x' })
  await expect.poll(() => app.evaluate(() => (globalThis as any).__obsrv.target.getThrottle().id)).toBe('cpu-6x')
  const page = await rendererWindow(app)
  await expect(page.locator('.target-pane .pane-footer')).toContainText('throttle cpu-6x')
  const back = await call('obsrv_drive', { throttle: 'none' })
  expect(back.structuredContent).toMatchObject({ throttle: 'none' })
  await expect.poll(() => app.evaluate(() => (globalThis as any).__obsrv.target.getThrottle().id)).toBe('none')
  const bad = await call('obsrv_drive', { throttle: 'edge' })
  expect(bad.isError).toBe(true)
})
