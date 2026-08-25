import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { request } from 'node:http'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONTROL_FILE_NAME, parseControlFile, type ControlInfo } from '../../src/shared/control'
import { launchApp, rendererWindow } from './launch'

/**
 * Drives the agent-control server over real loopback HTTP against the real
 * app (launched with OBSRV_AGENT_CONTROL=1, in its own throwaway user-data
 * dir — a dev instance on the same machine is untouched), asserting through
 * `__obsrv` that commands land in the same state the renderer drives.
 */

const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href

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
  expect(r.body).toMatchObject({ ok: true, presetId: '1080p-24', profileId: 'reference', viewMode: '1:1', mode: 'url' })
  expect(typeof r.body.version).toBe('string')
  expect(typeof r.body.url).toBe('string')
  // Any authenticated command nudges the renderer's activity indicator.
  await expect(page.locator('.agent-activity')).toBeVisible()
  // The force-enabled server also reads back through settings: the toggle is on.
  await expect(page.locator('.agent-toggle')).toHaveAttribute('aria-pressed', 'true')
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

test('toggling agent control off stops the server and removes the discovery file', async () => {
  // The real user flow: the toolbar toggle persists agentControl: false and
  // main stops the server.
  await page.click('.agent-toggle')
  await expect(page.locator('.agent-toggle')).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => existsSync(controlFile)).toBe(false)
  await expect(call('status')).rejects.toThrow(/ECONNREFUSED/)
})
