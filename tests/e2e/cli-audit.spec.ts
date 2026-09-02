import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { decodePng, pixelAt } from './helpers/decodePng'

/**
 * `obsrv audit`: tap targets and text measured in millimetres on the chosen
 * screen. The fixture places a 48px button, a 24px button, an inline link,
 * 16px body text and a 10px caption, plus things that must not be counted
 * (hidden, display:none, a zero-size wrapper, an opacity-0 button). On a
 * 24" 1080p the 24px button is 6.6 mm (under 7) and the caption 2.8 mm
 * (fine); on a 6.5" phone at 2x they are 4.5 mm and 1.9 mm (both under).
 *
 * Also here, because it is the CLI's and `cli.spec.ts` is closed: phone
 * presets must render with phone fidelity. Since 0.18.1 the CLI called
 * `setViewport` without the `mobile` argument, so a phone preset got the
 * desktop UA and no viewport emulation — the wrong page for any site that
 * sniffs. A fixture that paints by user agent pins it in a pixel.
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

const audit = async (...args: string[]): Promise<any> => {
  const r = await runCli(['audit', fixture('audit.html'), ...args])
  expect(r.code, r.stderr).toBe(0)
  return JSON.parse(r.stdout)
}

let outDir: string
test.beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'obsrv-audit-spec-'))
})
test.afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
})

test('on a 24" 1080p the 24px button is the one finding, and the counts skip what is not rendered', async () => {
  const r = await audit('--preset', '1080p-24')
  expect(r.preset).toBe('1080p-24')
  expect(r.ppi).toBeCloseTo(91.8, 1)
  expect(r.thresholds).toEqual({ tapMm: 7, textMm: 2 })
  // Targets: the two buttons. Not the inline link, not the opacity-0 ghost.
  expect(r.summary.targets).toMatchObject({ count: 2, under: 1, smallestPx: 24 })
  expect(r.summary.targets.smallestMm).toBeCloseTo(6.64, 1)
  // Text: two buttons, the link, body, caption, the span inside the
  // zero-size wrapper. Not the hidden ones, not the wrapper itself.
  expect(r.summary.text).toMatchObject({ count: 6, under: 0, smallestPx: 10 })
  expect(r.findings).toHaveLength(1)
  expect(r.findings[0]).toMatchObject({ kind: 'small-target', element: 'button#tiny', text: '×', cssWidth: 24, cssHeight: 24 })
  expect(r.findings[0].mm).toBeCloseTo(6.64, 1)
  expect(r.truncated).toEqual({ findings: 0, targets: 0, text: 0 })
  expect(r.warnings).toEqual([])
})

test('on a 6.5" phone the caption and the tiny button\'s glyph are under 2 mm, smallest first', async () => {
  const r = await audit('--preset', 'android-65')
  expect(r.cssWidth).toBe(360)
  expect(r.deviceScaleFactor).toBe(2)
  expect(r.findings.map((f: any) => f.kind)).toEqual(['small-text', 'small-text', 'small-target'])
  const elements = r.findings.map((f: any) => f.element)
  expect(elements).toContain('p#caption')
  expect(elements).toContain('button#tiny')
  expect(r.findings[0].mm).toBeCloseTo(1.88, 1)
  expect(r.findings[2].mm).toBeCloseTo(4.52, 1)
  expect(r.summary.text.under).toBe(2)
})

test('the thresholds are the caller\'s', async () => {
  const r = await audit('--preset', 'android-65', '--tap-mm', '4', '--text-mm', '1')
  expect(r.thresholds).toEqual({ tapMm: 4, textMm: 1 })
  expect(r.findings).toEqual([])
})

test('custom dimensions without a diagonal measure nothing in millimetres, and say so', async () => {
  const r = await audit('--width', '1366', '--height', '768')
  expect(r.ppi).toBeNull()
  expect(r.findings).toEqual([])
  expect(r.summary.targets).toMatchObject({ count: 2, under: null, smallestPx: 24, smallestMm: null })
  expect(r.warnings.join(' ')).toMatch(/--diagonal/)
})

test('--profile is refused with the reason, exit code 2', async () => {
  const r = await runCli(['audit', fixture('audit.html'), '--profile', 'budget-tn'])
  expect(r.code).toBe(2)
  expect(r.stderr).toMatch(/does not apply/)
})

test('a phone preset renders with phone fidelity: the page sees a mobile user agent', async () => {
  const phone = join(outDir, 'phone.png')
  const laptop = join(outDir, 'laptop.png')
  for (const [preset, out] of [
    ['iphone-61', phone],
    ['laptop-768', laptop],
  ] as const) {
    const r = await runCli(['snap', fixture('ua-paint.html'), '--preset', preset, '--out', out])
    expect(r.code, r.stderr).toBe(0)
  }
  const centre = (file: string): [number, number, number, number] => {
    const png = decodePng(readFileSync(file))
    return pixelAt(png, Math.floor(png.width / 2), Math.floor(png.height / 2))
  }
  // Red under a mobile UA, blue otherwise.
  expect(centre(phone).slice(0, 3)).toEqual([255, 0, 0])
  expect(centre(laptop).slice(0, 3)).toEqual([0, 0, 255])
})
