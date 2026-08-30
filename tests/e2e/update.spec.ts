import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { launchApp, openSettings, rendererWindow } from './launch'

/**
 * The update path end to end against a loopback stand-in for the GitHub
 * releases API, pointed at by OBSRV_RELEASES_API. No test touches the network.
 */

let app: ElectronApplication
let page: Page
let server: Server

/** Swapped per test; the server answers with whatever is here. */
let reply = { code: 200, body: '' }

const release = (tag: string): string =>
  JSON.stringify({ tag_name: tag, html_url: `https://github.com/vibesyemmy/obsrv/releases/tag/${tag}` })

test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(reply.code, { 'content-type': 'application/json' })
    res.end(reply.body)
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo

  // A fresh user-data dir means lastUpdateCheck is 0, so the boot check runs
  // and the first test asserts what it produced.
  reply = { code: 200, body: release('v99.0.0') }
  app = await launchApp([], { OBSRV_RELEASES_API: `http://127.0.0.1:${port}/latest` })
  page = await rendererWindow(app)
})

test.afterAll(async () => {
  await app?.close()
  await new Promise<void>(r => server.close(() => r()))
})

const check = (): Promise<Record<string, unknown>> =>
  page.evaluate(() => window.obsrv.checkUpdate() as Promise<Record<string, unknown>>)

test('the boot check reports the newer release', async () => {
  await expect
    .poll(() => page.evaluate(() => window.obsrv.getUpdate()), { timeout: 10_000 })
    .toMatchObject({ status: 'available', latest: '99.0.0' })
})

test('a release that is not newer reads as current', async () => {
  reply = { code: 200, body: release('v0.0.1') }
  expect(await check()).toMatchObject({ status: 'current' })
  expect(await page.evaluate(() => window.obsrv.getUpdate())).toMatchObject({ status: 'current' })
})

test('an HTTP failure reads as error, never as an update', async () => {
  reply = { code: 403, body: '{"message":"API rate limit exceeded"}' }
  expect(await check()).toMatchObject({ status: 'error' })
})

test('a malformed body reads as error', async () => {
  reply = { code: 200, body: '<html>not json</html>' }
  expect(await check()).toMatchObject({ status: 'error' })
})

test('a release URL on another host is refused rather than offered', async () => {
  reply = {
    code: 200,
    body: JSON.stringify({ tag_name: 'v99.0.0', html_url: 'https://github.com.evil.test/x' }),
  }
  expect(await check()).toMatchObject({ status: 'error' })
})

test('openRelease does nothing when main holds no validated URL', async () => {
  // The last check errored, so nothing is stored. This must be a quiet no-op:
  // the renderer never supplies the URL, so there is nothing else it could open.
  expect(await page.evaluate(() => window.obsrv.openRelease())).toBe(false)
})

test('every check stamps the settings, so an offline app retries daily not hourly', async () => {
  const before = (await page.evaluate(() => window.obsrv.getSettings())) as { lastUpdateCheck: number }
  expect(before.lastUpdateCheck).toBeGreaterThan(0)
})

test('the state survives a renderer reload', async () => {
  reply = { code: 200, body: release('v99.0.0') }
  await check()
  await page.reload()
  await expect
    .poll(() => page.evaluate(() => window.obsrv.getUpdate()), { timeout: 10_000 })
    .toMatchObject({ status: 'available', latest: '99.0.0' })
})

test('the toolbar offers the update only when there is one', async () => {
  reply = { code: 200, body: release('v99.0.0') }
  await check()
  await expect(page.locator('.update-button')).toHaveText('v99.0.0 ↓')
  // Rendered width, not just DOM text: the 0.7.0 `.toolbar button` rule pinned
  // every button to a 26px square, and a bare `.update-button` rule lost to it
  // on specificity — the text was then correct in the DOM and read "v99." on
  // screen. Measure it, don't read it.
  const box = await page.locator('.update-button').boundingBox()
  expect(box!.width).toBeGreaterThan(60)

  reply = { code: 200, body: release('v0.0.1') }
  await check()
  await expect(page.locator('.update-button')).toHaveCount(0)

  reply = { code: 500, body: '' }
  await check()
  // An error must never reach the toolbar.
  await expect(page.locator('.update-button')).toHaveCount(0)
})

test('the Settings block reports every state', async () => {
  await openSettings(page, 'updates')

  reply = { code: 200, body: release('v99.0.0') }
  await check()
  await expect(page.locator('.version-block')).toContainText('99.0.0')
  await expect(page.locator('.version-latest')).toContainText('Download')

  reply = { code: 200, body: release('v0.0.1') }
  await check()
  await expect(page.locator('.version-latest')).toHaveText('Up to date')

  reply = { code: 500, body: '' }
  await check()
  await expect(page.locator('.version-latest')).toHaveText('Couldn’t check')
  await expect(page.locator('.version-checked')).not.toHaveText('never')
})

test('the automatic-check toggle round-trips through main', async () => {
  await page.uncheck('.update-check-toggle input')
  await expect
    .poll(() => page.evaluate(() => window.obsrv.getSettings()))
    .toMatchObject({ updateCheck: false })

  await page.reload()
  // The settings fields only exist while the modal is open, so the reloaded
  // shell announces itself with the button that opens it.
  await expect(page.locator('.toggle-settings')).toBeVisible()
  await openSettings(page, 'updates')
  await expect(page.locator('.update-check-toggle input')).not.toBeChecked()

  await page.check('.update-check-toggle input')
  await expect
    .poll(() => page.evaluate(() => window.obsrv.getSettings()))
    .toMatchObject({ updateCheck: true })
})
