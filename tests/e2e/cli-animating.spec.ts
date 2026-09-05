import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * An animating page never goes paint-quiet. Until 0.28 every headless render
 * of one waited the whole budget (30 s by default) to say so — a report's
 * six renders, three minutes, every diff noise. Now a frame that is covered
 * and keeps painting steadily is captured after ~2 s and the JSON says why.
 */

const BIN = resolve(__dirname, '../../bin/obsrv.js')
const ANIMATED = pathToFileURL(resolve(__dirname, '../fixtures/animated.html')).href

function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string; ms: number }> {
  return new Promise(done => {
    const t0 = Date.now()
    const child = spawn(process.execPath, [BIN, ...args], { cwd: resolve(__dirname, '../..') })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => (stdout += d))
    child.stderr.on('data', d => (stderr += d))
    child.on('close', code => done({ code, stdout, stderr, ms: Date.now() - t0 }))
  })
}

let outDir: string
test.beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'obsrv-animating-'))
})
test.afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
})

test('a snap of an animating page returns in seconds, unsettled, and names the reason', async () => {
  const r = await runCli(['snap', ANIMATED, '--preset', 'laptop-768', '--out', join(outDir, 'a.png')])
  expect(r.code, r.stderr).toBe(0)
  const meta = JSON.parse(r.stdout)
  expect(meta.settled).toBe(false)
  expect(meta.unsettledReason).toBe('animating')
  expect(meta.warnings.join(' ')).toMatch(/painting steadily/)
  // Well under the 30 s budget: the page, the app's start and the encode.
  expect(r.ms).toBeLessThan(12_000)
})

test('under a throttle the early exit is off: settledMs is the measurement, and the budget is honoured', async () => {
  const r = await runCli(['snap', ANIMATED, '--preset', 'laptop-768', '--throttle', 'none', '--timeout', '4000', '--out', join(outDir, 'b.png')])
  expect(r.code, r.stderr).toBe(0)
  const meta = JSON.parse(r.stdout)
  expect(meta.settled).toBe(false)
  expect(meta.unsettledReason).toBe('timeout')
  expect(meta.settledMs).toBeNull()
})

test('a settled snap carries no reason: the flagless object is unchanged', async () => {
  const r = await runCli(['snap', pathToFileURL(resolve(__dirname, '../fixtures/fill.html')).href, '--preset', 'laptop-768', '--out', join(outDir, 'c.png')])
  expect(r.code, r.stderr).toBe(0)
  const meta = JSON.parse(r.stdout)
  expect(meta.settled).toBe(true)
  expect(meta).not.toHaveProperty('unsettledReason')
})
