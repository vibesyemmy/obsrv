import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONTROL_FILE_NAME, isDeclinedStance, isDisabledStance, parseControlFile } from '../../src/shared/control'
import { CONTROL_FILE_ENV, discover } from '../../src/mcp/control'
import { launchApp, rendererWindow } from './launch'

/**
 * The one state where the app can ask (live-first spec §2c): open, control
 * off, and a second launch knocks. `second-instance` is raised synthetically
 * through the test hook rather than by spawning a second Electron.
 *
 * Finding 1 (final review): the bug this branch fixes was entirely in how
 * the MCP side (`discover()`, src/mcp/control.ts) read the disabled stance
 * this app writes — every "control is off" write used to read as a genuine
 * decline, so `ensureLive` never launched and the consent bar below was
 * unreachable except by a human double-launching Obsrv by hand. `stance()`
 * now tells `not-asked` apart from `declined`, and a couple of tests call
 * the real `discover()` against this app's own control file to prove the
 * MCP-side interpretation agrees with what the app wrote.
 */

let app: ElectronApplication
let page: Page
let controlFile: string

const stance = (): 'live' | 'not-asked' | 'declined' | 'absent' => {
  if (!existsSync(controlFile)) return 'absent'
  const f = parseControlFile(readFileSync(controlFile, 'utf8'))
  if (!f) return 'absent'
  if (!isDisabledStance(f)) return 'live'
  return isDeclinedStance(f) ? 'declined' : 'not-asked'
}
const knock = (): Promise<void> => app.evaluate(() => (globalThis as any).__obsrv.hooks.secondInstance())

/**
 * Points the real MCP-side `discover()` at this test app's own control file
 * and reads it back — no launch involved, just the same file read and parse
 * a production MCP call would do. `CONTROL_FILE_ENV` is restored afterwards
 * so this never leaks into another test in the same worker.
 */
async function realDiscover(): Promise<Awaited<ReturnType<typeof discover>>> {
  const prev = process.env[CONTROL_FILE_ENV]
  process.env[CONTROL_FILE_ENV] = controlFile
  try {
    return await discover()
  } finally {
    if (prev === undefined) delete process.env[CONTROL_FILE_ENV]
    else process.env[CONTROL_FILE_ENV] = prev
  }
}

test.beforeAll(async () => {
  app = await launchApp() // control off: the saved default
  page = await rendererWindow(app)
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'))
  controlFile = join(userData, CONTROL_FILE_NAME)
})
test.afterAll(async () => {
  await app.close()
})

test('control off: the app writes a not-asked stance, and no bar shows until someone knocks', async () => {
  await expect.poll(stance).toBe('not-asked')
  await expect(page.locator('.consent-bar')).toHaveCount(0)
  // The reachable route Finding 1 restores: the real MCP-side discover()
  // must read this the same way, not as a decline — that misreading is what
  // made ensureLive skip the launch that raises the bar in the first place.
  const pid = await app.evaluate(() => process.pid)
  expect(await realDiscover()).toEqual({ kind: 'not-asked', pid })
})

test('agentConsent(true) with nothing outstanding is ignored: this channel answers a question, not a claim', async () => {
  // No `hooks.secondInstance()` here — the bar has never shown. A renderer
  // calling the API directly (buggy or otherwise) must not be able to grant
  // itself agent control just by saying so.
  await page.evaluate(() => window.obsrv.agentConsent(true))
  await expect(page.locator('.consent-bar')).toHaveCount(0)
  expect(stance()).toBe('not-asked')
  expect(await app.evaluate(() => (globalThis as any).__obsrv.settings().agentControl)).toBe(false)
})

test('a knock shows the bar with the agreed copy; a second knock does not stack a second bar', async () => {
  // The bar is a plain in-flow <div>, never focused: confirm it doesn't
  // steal focus rather than just asserting that from the markup.
  const activeBefore = await page.evaluate(() => document.activeElement?.tagName ?? null)
  await knock()
  await expect(page.locator('.consent-bar')).toBeVisible()
  await expect(page.locator('.consent-bar')).toContainText('An agent wants to drive Obsrv.')
  await expect(page.locator('.consent-bar button', { hasText: 'Allow for this session' })).toBeVisible()
  await expect(page.locator('.consent-bar button', { hasText: 'Not now' })).toBeVisible()
  expect(await page.evaluate(() => document.activeElement?.tagName ?? null)).toBe(activeBefore)
  await knock()
  await expect(page.locator('.consent-bar')).toHaveCount(1)
})

test('Not now: the bar goes, the stance becomes declined, the saved setting is untouched', async () => {
  await page.locator('.consent-bar button', { hasText: 'Not now' }).click()
  await expect(page.locator('.consent-bar')).toHaveCount(0)
  expect(stance()).toBe('declined')
  expect(await app.evaluate(() => (globalThis as any).__obsrv.settings().agentControl)).toBe(false)
  // Only now — after an actual "Not now" — does the real discover() report
  // declined; a second knock while declined must not launch or re-ask.
  const pid = await app.evaluate(() => process.pid)
  expect(await realDiscover()).toEqual({ kind: 'declined', pid })
})

test('Allow for this session: control on, the file is live, the toggle reads on, nothing persisted', async () => {
  await knock()
  await page.locator('.consent-bar button', { hasText: 'Allow for this session' }).click()
  await expect(page.locator('.consent-bar')).toHaveCount(0)
  await expect.poll(stance).toBe('live')
  await expect(page.locator('button.agent-activity')).toBeVisible()
  // In memory, not on disk: the same rule as OBSRV_AGENT_CONTROL=1.
  expect(await app.evaluate(() => (globalThis as any).__obsrv.settings().agentControl)).toBe(true)
  expect(await app.evaluate(() => (globalThis as any).__obsrv.persistedSettings().agentControl)).toBe(false)
})

test('with control on, a knock shows nothing: the app is already driveable', async () => {
  await knock()
  await expect(page.locator('.consent-bar')).toHaveCount(0)
})
