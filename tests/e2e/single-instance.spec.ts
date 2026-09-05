import { test, expect, type ElectronApplication } from '@playwright/test'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CONTROL_FILE_NAME, parseControlFile } from '../../src/shared/control'
import { launchApp } from './launch'

/**
 * One Obsrv per profile. A second launch on the same user-data dir used to
 * start a rival agent-control server and overwrite the discovery file, so an
 * agent drove the newer window while the user watched the older one. Now the
 * second launch hands over and exits, the first is told (`second-instance`)
 * and brings its window forward, and the discovery file stays the first's.
 *
 * The second instance is spawned raw rather than through Playwright: it has
 * no window to attach to, by design.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronBin = require('electron') as unknown as string
const MAIN = resolve(__dirname, '../../out/main/index.js')

let app: ElectronApplication
let dir: string

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'obsrv-single-'))
  app = await launchApp([], { OBSRV_AGENT_CONTROL: '1' }, dir)
})
test.afterAll(async () => {
  await app.close()
  rmSync(dir, { recursive: true, force: true })
})

test('a second launch on the same profile exits, and the first window is told and keeps the control file', async () => {
  const controlFile = join(dir, CONTROL_FILE_NAME)
  await expect.poll(() => existsSync(controlFile)).toBe(true)
  const firstPid = await app.evaluate(() => process.pid)
  expect(parseControlFile(readFileSync(controlFile, 'utf8'))?.pid).toBe(firstPid)

  const second = spawn(electronBin, [MAIN, `--user-data-dir=${dir}`], { env: { ...process.env, OBSRV_TEST: '1' }, stdio: 'ignore' })
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done, fail) => {
    const t = setTimeout(() => fail(new Error('the second instance did not exit within 20 s')), 20_000)
    second.on('exit', (code, signal) => {
      clearTimeout(t)
      done({ code, signal })
    })
    second.on('error', fail)
  })
  expect(exit).toEqual({ code: 0, signal: null })

  // The first instance is alive, was told exactly once, and still owns the file.
  expect(await app.evaluate(() => process.pid)).toBe(firstPid)
  await expect.poll(() => app.evaluate(() => (globalThis as { __obsrvSecondInstances?: number }).__obsrvSecondInstances ?? 0)).toBe(1)
  expect(parseControlFile(readFileSync(controlFile, 'utf8'))?.pid).toBe(firstPid)
})
