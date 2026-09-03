import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { decodePng, pixelAt } from './helpers/decodePng'

/**
 * The fractional presets: a 1080p laptop at Windows' 125% and 150%, 4K at
 * 150%, a Pixel at 2.625×. What they claim is that the page lays out in the
 * CSS viewport the OS gives it and rasterises at the panel's real pixels —
 * so the PNG is the panel, and the page sees the fractional ratio.
 */

const BIN = resolve(__dirname, '../../bin/obsrv.js')
const fixture = (name: string): string => pathToFileURL(resolve(__dirname, `../fixtures/${name}`)).href

interface CliResult {
  code: number | null
  stdout: string
  stderr: string
}

function runCli(args: string[]): Promise<CliResult> {
  return new Promise(done => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd: resolve(__dirname, '../..') })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => (stdout += d))
    child.stderr.on('data', d => (stderr += d))
    child.on('close', code => done({ code, stdout, stderr }))
  })
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
  const b = readFileSync(file)
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

let outDir: string
test.beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'obsrv-presets-'))
})
test.afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
})

test('a 1080p laptop at Windows 125%: the PNG is the panel, the page sees 1536 CSS px and a 1.25 ratio', async () => {
  const out = join(outDir, 'win125.png')
  const r = await runCli(['snap', fixture('audit.html'), '--preset', 'laptop-1080-125', '--out', out])
  expect(r.code, r.stderr).toBe(0)
  const meta = JSON.parse(r.stdout)
  expect(meta).toMatchObject({ preset: 'laptop-1080-125', cssWidth: 1536, cssHeight: 864, deviceScaleFactor: 1.25 })
  expect(pngSize(out)).toEqual({ width: 1920, height: 1080 })
})

test('a Pixel at 2.625×: a fractional phone rasterises to its real panel within a pixel', async () => {
  const out = join(outDir, 'pixel.png')
  const r = await runCli(['snap', fixture('audit.html'), '--preset', 'pixel-8', '--out', out])
  expect(r.code, r.stderr).toBe(0)
  const meta = JSON.parse(r.stdout)
  expect(meta).toMatchObject({ preset: 'pixel-8', cssWidth: 412, cssHeight: 915, deviceScaleFactor: 2.625 })
  // 412 × 2.625 = 1081.5 and 915 × 2.625 = 2401.875: the frame is what
  // Chromium paints of that, the floor. Electron's bitmap is the rounding,
  // one column and row wider, and those never paint (measured: a black edge,
  // and a capture that never settled because its mask never filled) — so the
  // source crops them, and the PNG is page to its last pixel.
  expect(pngSize(out)).toEqual({ width: 1081, height: 2401 })
  expect(meta.settled).toBe(true)
  const png = decodePng(readFileSync(out))
  const mid = pixelAt(png, 540, 1200)
  expect(pixelAt(png, 1080, 1200)).toEqual(mid)
  expect(pixelAt(png, 540, 2400)).toEqual(mid)
})
