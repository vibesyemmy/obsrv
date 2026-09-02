import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp, rendererWindow } from './launch'

/**
 * The app log. A packaged app launched from the Dock has no stderr, and the
 * first field report of a GPU-reset white pane came with no evidence because
 * there was nowhere for any to go. Main now writes what the renderer cannot
 * see to a file, and the renderer reports what main cannot see through it.
 */

const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href

let app: ElectronApplication
let page: Page
let logFile: string

const logText = (): string => readFileSync(logFile, 'utf8')

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
  logFile = await app.evaluate(() => (globalThis as any).__obsrv.logFile)
  await page.fill('.url-form input', FIXTURE)
  await page.press('.url-form input', 'Enter')
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLCanvasElement>('canvas.target-canvas')?.dataset.gl)).toBe('ok')
})
test.afterAll(async () => {
  await app.close()
})

test('lives under the user-data directory in tests, and opens with the boot line', async () => {
  // Never the real `~/Library/Logs/Obsrv`: the harness's throwaway user-data
  // directory is where a test's writes belong.
  expect(logFile).toMatch(/obsrv-e2e-[^/]+\/logs\/obsrv\.log$/)
  const text = logText()
  expect(text).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z info  obsrv \d+\.\d+\.\d+ starting: electron \d+/m)
  expect(text).toMatch(/ info  gpu: compositing \S+, webgl \S+$/m)
})

test('the window going hidden and coming back is on record, once per transition', async () => {
  const before = (logText().match(/window hidden/g) ?? []).length
  await app.evaluate(() => (globalThis as any).__obsrv.win.hide())
  await expect.poll(() => (logText().match(/window hidden; target rasterisation paused/g) ?? []).length).toBe(before + 1)
  // A second hide event for a window that is already hidden is not news.
  await app.evaluate(() => (globalThis as any).__obsrv.win.hide())
  await app.evaluate(() => (globalThis as any).__obsrv.win.show())
  await expect.poll(() => logText()).toMatch(/window shown; target rasterisation resumed/)
  expect((logText().match(/window hidden/g) ?? []).length).toBe(before + 1)
})

test('a GPU death, and what the renderer made of it, are on record', async () => {
  const appPid: number = await app.evaluate(() => process.pid)
  const rows = execSync('ps -axo pid,ppid,command').toString().split('\n')
  const gpu = rows.find(r => r.includes('--type=gpu-process') && r.trim().split(/\s+/)[1] === String(appPid))
  expect(gpu, 'a GPU helper to kill').toBeDefined()
  process.kill(Number(gpu!.trim().split(/\s+/)[0]), 'SIGKILL')

  await expect.poll(logText, { timeout: 10_000 }).toMatch(/ warn  GPU process gone \(killed, exit code 9\)/)
  await expect.poll(logText, { timeout: 10_000 }).toMatch(/ info  renderer: webgl context lost/)
  await expect.poll(logText, { timeout: 10_000 }).toMatch(/ info  renderer: webgl context restored/)
})

test('a line from the renderer is one bounded line, whatever it sends', async () => {
  await page.evaluate(() => {
    window.obsrv.log('one\nforged second entry')
    window.obsrv.log('x'.repeat(5000))
    window.obsrv.log('')
  })
  await expect.poll(logText).toMatch(/ info  renderer: one forged second entry$/m)
  expect(logText()).not.toMatch(/^forged/m)
  expect(logText()).not.toMatch(/x{300}/)
})

test('Help → Show Log File exists', async () => {
  const item = await app.evaluate(({ Menu }) => {
    const found = Menu.getApplicationMenu()?.getMenuItemById('show-log')
    return found ? { label: found.label, enabled: found.enabled } : null
  })
  expect(item).toEqual({ label: 'Show Log File', enabled: true })
})
