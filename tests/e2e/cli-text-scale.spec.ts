import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * `--text-scale`: browser zoom as reflow, headless. The PNG must stay the
 * screen's size while the page lays out in `1/scale` of it — so the audit,
 * which measures the page's own CSS px, must report every millimetre grown
 * by the scale: the 24 px control that is 6.07 mm on the 15.6" laptop at
 * ×1 is 9.1 mm at ×1.5, and no longer a finding.
 */

const BIN = resolve(__dirname, '../../bin/obsrv.js')
const fixture = (name: string): string => pathToFileURL(resolve(__dirname, `../fixtures/${name}`)).href

interface CliResult {
  code: number
  stdout: string
  stderr: string
}

function runCli(args: string[]): Promise<CliResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd: resolve(__dirname, '../..') })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => (stdout += d))
    child.stderr.on('data', d => (stderr += d))
    child.on('error', rejectPromise)
    child.on('close', code => resolvePromise({ code: code ?? -1, stdout, stderr }))
  })
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
  const b = readFileSync(file)
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

let outDir: string
test.beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'obsrv-text-scale-spec-'))
})
test.afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
})

test('snap --text-scale 1.5: the PNG is still the screen, the JSON says the scale', async () => {
  // The ×1 contract (`cli.spec.ts`) has no `textScale` key; a scaled run adds it.
  const out = join(outDir, 'scaled.png')
  const r = await runCli(['snap', fixture('audit.html'), '--preset', 'laptop-768', '--text-scale', '1.5', '--out', out])
  expect(r.code, r.stderr).toBe(0)
  // One preset prints one object; a matrix would print an array.
  const meta = JSON.parse(r.stdout)
  expect(meta).toMatchObject({ preset: 'laptop-768', cssWidth: 1366, cssHeight: 768, deviceScaleFactor: 1, textScale: 1.5 })
  expect(pngSize(out)).toEqual({ width: 1366, height: 768 })
  expect(r.stderr).toContain('text 150%')
})

test('audit --text-scale 1.5: every millimetre grows by the scale, so the small control is no longer small', async () => {
  const plain = await runCli(['audit', fixture('audit.html'), '--preset', 'laptop-768'])
  expect(plain.code, plain.stderr).toBe(0)
  const before = JSON.parse(plain.stdout)
  // At ×1 the JSON is the contract it always was: no new key.
  expect(before.textScale).toBeUndefined()
  expect(before.summary.targets).toMatchObject({ count: 2, under: 1 })
  expect(before.summary.targets.smallestMm).toBeCloseTo(6.07, 1)

  const scaled = await runCli(['audit', fixture('audit.html'), '--preset', 'laptop-768', '--text-scale', '1.5'])
  expect(scaled.code, scaled.stderr).toBe(0)
  const after = JSON.parse(scaled.stdout)
  expect(after.textScale).toBe(1.5)
  expect(after.summary.targets).toMatchObject({ count: 2, under: 0 })
  expect(after.summary.targets.smallestMm).toBeCloseTo(9.1, 1)
  // The page laid out in two thirds of the screen: its own viewport says so.
  expect(after.cssWidth).toBe(1366)
})

test('the scale is one number, in range, on every command', async () => {
  const r = await runCli(['snap', fixture('audit.html'), '--preset', 'laptop-768', '--text-scale', '10'])
  expect(r.code).toBe(2)
  expect(r.stderr).toMatch(/--text-scale: expected a number <= 4/)
  const help = await runCli(['--help'])
  expect(help.stdout).toContain('--text-scale <f>')
})
