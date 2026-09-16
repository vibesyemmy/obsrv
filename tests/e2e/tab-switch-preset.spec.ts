import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { join } from 'node:path'
import { CONTROL_FILE_NAME, parseControlFile, type ControlInfo } from '../../src/shared/control'
import { launchApp, rendererWindow } from './launch'

/**
 * bug-preset-after-tab-switch-lands-on-the-other-tab, reproduced before anything is fixed.
 *
 * `activateTab` switches main's front tab and answers at once. The renderer learns of
 * the switch afterwards, through `tabsChanged`. An agent's preset sent in between
 * is applied by the renderer to the tab it still thinks is in front (the one just
 * left), and main resizes the tab now in front with that tab's settings.
 * `openTab` with a preset does the same thing inside one command.
 *
 * The gap is forced with OBSRV_TEST_TABS_CHANGED_DELAY_MS, so it is open on purpose
 * rather than by the luck of a slow machine.
 */

const HOLD_MS = Number(process.env['TAB_SWITCH_HOLD_MS'] ?? 600)
const LAPTOP = { id: 'laptop-768', width: 1366, height: 768 }
const PHONE = { id: 'iphone-61', width: 393, height: 852 }

let app: ElectronApplication
let page: Page
let info: ControlInfo

interface Reply {
  status: number
  body: Record<string, unknown>
}

function call(command: string, payload?: Record<string, unknown>): Promise<Reply> {
  return new Promise((done, fail) => {
    const data = JSON.stringify({ command, token: info.token, ...(payload ? { payload } : {}) })
    const req = request({ host: '127.0.0.1', port: info.port, method: 'POST', path: '/', headers: { 'content-type': 'application/json' } }, res => {
      let text = ''
      res.on('data', d => (text += String(d)))
      res.on('end', () => done({ status: res.statusCode ?? 0, body: JSON.parse(text || '{}') as Record<string, unknown> }))
    })
    req.on('error', fail)
    req.end(data)
  })
}

/** Main's tab ids, in strip order, and which one it has in front. */
const mainTabs = (): Promise<{ ids: string[]; activeId: string }> =>
  app.evaluate(() => {
    const t = (globalThis as any).__obsrv.tabs
    return { ids: t.tabs.map((s: { id: string }) => s.id), activeId: t.activeId as string }
  })

/** Whether the renderer's strip has caught up with main: the selected tab sits where main's front tab does. */
async function rendererCaughtUp(): Promise<boolean> {
  const { ids, activeId } = await mainTabs()
  const selected = await page.evaluate(() => [...document.querySelectorAll('button.tab-label')].findIndex(b => b.getAttribute('aria-selected') === 'true'))
  return selected === ids.indexOf(activeId)
}

/** The CSS viewport a tab's target renders at, read from main by tab id. */
const viewportOf = (id: string): Promise<{ width: number; height: number }> =>
  app.evaluate((_e, tabId: string) => {
    const s = (globalThis as any).__obsrv.tabs.tabs.find((t: { id: string }) => t.id === tabId)
    return s.target.getViewport() as { width: number; height: number }
  }, id)

const hold = (ms: number): Promise<void> =>
  app.evaluate((_e, v: number) => {
    process.env['OBSRV_TEST_TABS_CHANGED_DELAY_MS'] = String(v)
  }, ms)

test.beforeAll(async () => {
  app = await launchApp([], { OBSRV_AGENT_CONTROL: '1' })
  page = await rendererWindow(app)
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'))
  const controlFile = join(userData, CONTROL_FILE_NAME)
  await expect.poll(() => existsSync(controlFile)).toBe(true)
  const parsed = parseControlFile(readFileSync(controlFile, 'utf8'))
  if (!parsed) throw new Error(`the control file at ${controlFile} did not parse`)
  info = parsed
})

test.afterAll(async () => {
  await app?.close()
})

test('a preset sent straight after activateTab lands on the tab in front, not the one just left', async () => {
  const a = (await mainTabs()).activeId
  expect((await call('setPreset', { id: LAPTOP.id })).body.applied).toBe(true)
  const b = (await call('openTab')).body.id as string
  await expect.poll(rendererCaughtUp).toBe(true)
  expect((await call('setPreset', { id: LAPTOP.id })).body.applied).toBe(true)
  expect((await call('activateTab', { id: a })).status).toBe(200)
  await expect.poll(rendererCaughtUp).toBe(true)

  await hold(HOLD_MS)
  try {
    expect((await call('activateTab', { id: b })).status).toBe(200)
    const r = await call('setPreset', { id: PHONE.id })
    console.log(`[tab-switch] setPreset reply: applied=${String(r.body.applied)} presetId=${String(r.body.presetId)}`)
  } finally {
    await hold(0)
  }
  await expect.poll(rendererCaughtUp, { timeout: HOLD_MS * 5 }).toBe(true)
  await page.waitForTimeout(500)

  const inFront = await viewportOf(b)
  const left = await viewportOf(a)
  const strip = (await call('tabs')).body.tabs as { id: string; presetId: string }[]
  console.log(`[tab-switch] B (in front) ${inFront.width}x${inFront.height}; A (left) ${left.width}x${left.height}; strip ${JSON.stringify(strip.map(t => [t.id === a ? 'A' : 'B', t.presetId]))}`)
  // Where did the preset go? Main's strip only knows what the renderer reported for the tab in
  // front, so bring A back to front and read what it renders now.
  expect((await call('activateTab', { id: a })).status).toBe(200)
  await expect.poll(rendererCaughtUp).toBe(true)
  await page.waitForTimeout(500)
  const leftAfter = await viewportOf(a)
  const stripAfter = (await call('tabs')).body.tabs as { id: string; presetId: string }[]
  console.log(`[tab-switch] A back in front: ${leftAfter.width}x${leftAfter.height}; strip ${JSON.stringify(stripAfter.map(t => [t.id === a ? 'A' : 'B', t.presetId]))}`)
  expect(inFront, 'the tab in front took the preset').toEqual({ width: PHONE.width, height: PHONE.height })
  expect(leftAfter, 'the tab just left kept its preset').toEqual({ width: LAPTOP.width, height: LAPTOP.height })
})

test('openTab with a preset gives the preset to the new tab, not the one in front before it', async () => {
  const before = (await mainTabs()).activeId
  expect((await call('setPreset', { id: LAPTOP.id })).body.applied).toBe(true)
  await hold(HOLD_MS)
  let opened = ''
  try {
    const r = await call('openTab', { preset: PHONE.id })
    opened = r.body.id as string
  } finally {
    await hold(0)
  }
  await expect.poll(rendererCaughtUp, { timeout: HOLD_MS * 5 }).toBe(true)
  await page.waitForTimeout(500)
  const strip = (await call('tabs')).body.tabs as { id: string; presetId: string }[]
  const fresh = await viewportOf(opened)
  console.log(`[tab-switch] openTab: new ${fresh.width}x${fresh.height}; strip ${JSON.stringify(strip.map(t => [t.id === opened ? 'new' : t.id === before ? 'before' : 'other', t.presetId]))}`)
  expect((await call('activateTab', { id: before })).status).toBe(200)
  await expect.poll(rendererCaughtUp).toBe(true)
  await page.waitForTimeout(500)
  const beforeAfter = await viewportOf(before)
  console.log(`[tab-switch] openTab: the tab in front before it, back in front: ${beforeAfter.width}x${beforeAfter.height}`)
  expect(fresh, 'the new tab took the preset').toEqual({ width: PHONE.width, height: PHONE.height })
  expect(beforeAfter, 'the tab in front before it kept its preset').toEqual({ width: LAPTOP.width, height: LAPTOP.height })
})
