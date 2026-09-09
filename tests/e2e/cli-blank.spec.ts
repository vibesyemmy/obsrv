import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { decodePng, pixelAt } from './helpers/decodePng'

/**
 * espn.com paints white, goes quiet for longer than the settle window, and
 * paints its page half a second to a second later. Five times out of five the
 * snap was a white PNG with `settled: true` and no warning — on the CLI,
 * through the MCP, and in the live pane — while an audit of the same URL
 * measured 110 targets. Quiescence is counted in paints, so a page that goes
 * quiet showing nothing looked finished. A quiet frame that is one colour end
 * to end is now given three seconds to paint something: a page that does is
 * captured as it should have been all along, and one that does not comes
 * back `settled: false, unsettledReason: "blank"` with a warning naming the
 * colour. The fixture paints an opaque veil at once and its content after
 * `?delay=` ms, which is deterministic where the real page's timing is not.
 */

const BIN = resolve(__dirname, '../../bin/obsrv.js')
const late = (delayMs: number): string => `${pathToFileURL(resolve(__dirname, '../fixtures/paints-late.html')).href}?delay=${delayMs}`
const VEIL = [0xfe, 0xfe, 0xfe, 255]

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
  outDir = mkdtempSync(join(tmpdir(), 'obsrv-blank-'))
})
test.afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
})

test('a page that paints its background and nothing else within the grace comes back blank, not settled', async () => {
  const out = join(outDir, 'blank.png')
  const r = await runCli(['snap', late(8000), '--preset', 'laptop-768', '--out', out])
  expect(r.code, r.stderr).toBe(0)
  const json = JSON.parse(r.stdout)
  expect(json.settled).toBe(false)
  expect(json.unsettledReason).toBe('blank')
  expect(json.warnings.join(' ')).toMatch(/one colour end to end \(#fefefe\) and stayed that way for 3000 ms/)
  expect(json.warnings.join(' ')).toMatch(/settled: false, blank/)
  // The grace was spent, and not the page's eight seconds.
  expect(r.ms).toBeGreaterThan(3000)
  expect(r.ms).toBeLessThan(7500)
  const png = decodePng(readFileSync(out))
  expect(png.width).toBe(1366)
  expect(pixelAt(png, 10, 10)).toEqual(VEIL)
  expect(pixelAt(png, 683, 384)).toEqual(VEIL)
})

test('a page that paints its content inside the grace is captured with it, settled, with no warning', async () => {
  // espn.com's shape: white, quiet, the page a second later. This used to be
  // the white frame; the grace now holds the shutter for the page.
  const out = join(outDir, 'late.png')
  const r = await runCli(['snap', late(1200), '--preset', 'laptop-768', '--out', out])
  expect(r.code, r.stderr).toBe(0)
  const json = JSON.parse(r.stdout)
  expect(json.settled).toBe(true)
  expect(json.unsettledReason).toBeUndefined()
  expect(json.warnings).toEqual([])
  const png = decodePng(readFileSync(out))
  expect(pixelAt(png, 683, 384)).not.toEqual(VEIL)
})

test('--wait past the page\'s own delay is the answer for a page that paints later than the grace', async () => {
  const out = join(outDir, 'waited.png')
  const r = await runCli(['snap', late(4500), '--preset', 'laptop-768', '--wait', '5000', '--out', out])
  expect(r.code, r.stderr).toBe(0)
  const json = JSON.parse(r.stdout)
  expect(json.settled).toBe(true)
  expect(json.warnings).toEqual([])
  const png = decodePng(readFileSync(out))
  expect(pixelAt(png, 683, 384)).not.toEqual(VEIL)
})
