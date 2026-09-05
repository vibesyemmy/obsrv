import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * `obsrv lint`: rules over the rendered page for what a 1x screen and a
 * cheap panel break. The fixture has a half-pixel-high rule and a
 * half-pixel box-shadow (sub-pixel on a 1x screen, whole on a phone), a
 * 0.5px border (which Chromium snaps to a whole device pixel at any
 * density — so it is never a finding, and the test says so), 300-weight
 * text at 12px, a grey that just clears AA as stated and a grey that does
 * not, a large heading in the first grey, text on a gradient, and three
 * raster images plus a vector: 100 px drawn at 200, 1000 px drawn at 200,
 * 100 px drawn at 100.
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

const lint = async (...args: string[]): Promise<any> => {
  const r = await runCli(['lint', fixture('lint.html'), ...args])
  expect(r.code, r.stderr).toBe(0)
  return JSON.parse(r.stdout)
}
const byRule = (m: any, rule: string): string[] => m.findings.filter((f: any) => f.rule === rule).map((f: any) => f.element)
const find = (m: any, element: string): any => m.findings.find((f: any) => f.element === element)

test('on a 24" 1080p: the sub-pixel edges, the light text, the failing grey, the two images', async () => {
  const m = await lint('--preset', '1080p-24')
  expect(m).toMatchObject({ preset: '1080p-24', cssWidth: 1920, cssHeight: 1080, deviceScaleFactor: 1, profile: 'reference', thresholds: { thinPx: 14 } })
  expect(m.textScale).toBeUndefined()
  expect(m.summary).toEqual({ hairline: 2, 'thin-text': 1, contrast: 1, 'contrast-on-panel': 0, 'image-upscaled': 1, 'image-oversized': 1 })
  // Chromium gives a 0.5px border a whole device pixel, so div#hair is not here.
  expect(byRule(m, 'hairline').sort()).toEqual(['div#rule', 'div#shadow'])
  expect(find(m, 'div#rule')).toMatchObject({ kind: 'height', cssPx: 0.5, devicePx: 0.5 })
  expect(find(m, 'div#shadow')).toMatchObject({ kind: 'box-shadow', cssPx: 0.5 })
  expect(find(m, 'div#rule').message).toContain('0.5 of a device pixel')
  expect(byRule(m, 'thin-text')).toEqual(['p#thin'])
  expect(find(m, 'p#thin')).toMatchObject({ fontWeight: 300, fontSizePx: 12, devicePx: 12 })
  expect(byRule(m, 'contrast')).toEqual(['p#fail'])
  expect(find(m, 'p#fail')).toMatchObject({ color: '#999999', background: '#ffffff', threshold: 4.5, largeText: false })
  expect(find(m, 'p#fail').asIs).toBeCloseTo(2.85, 1)
  expect(byRule(m, 'image-upscaled')).toEqual(['img#up'])
  expect(find(m, 'img#up')).toMatchObject({ naturalWidth: 100, naturalHeight: 100, drawnDevicePx: { width: 200, height: 200 }, factor: 2, srcset: false })
  expect(find(m, 'img#up').src).toBe('data:image/png;base64,')
  expect(byRule(m, 'image-oversized')).toEqual(['img#over'])
  expect(find(m, 'img#over')).toMatchObject({ naturalWidth: 1000, factor: 5 })
  // Every finding carries a page rect an agent can highlight.
  for (const f of m.findings) expect(f.rect.width).toBeGreaterThan(0)
  expect(m.skipped.textOnImages).toBe(1)
  expect(m.warnings[0]).toMatch(/1 text element sits on an image/)
  expect(m.truncated).toEqual({ findings: 0, text: 0, edges: 0, images: 0 })
  expect(m.pageHeight).toBeGreaterThan(500)
})

test('--profile budget-tn: the grey that clears AA as stated fails on the panel; large text is judged at 3:1', async () => {
  const m = await lint('--preset', '1080p-24', '--profile', 'budget-tn')
  expect(m.profile).toBe('budget-tn')
  expect(byRule(m, 'contrast-on-panel')).toEqual(['p#grey'])
  const grey = find(m, 'p#grey')
  expect(grey.asIs).toBeGreaterThanOrEqual(4.5)
  expect(grey.onPanel).toBeLessThan(4.5)
  expect(grey.message).toContain('on Budget TN')
  expect(find(m, 'h1#big')).toBeUndefined()
  expect(byRule(m, 'contrast')).toEqual(['p#fail'])
})

test('on a 6.5" phone at 2x: no sub-pixel edges, no thin text, images judged in device pixels', async () => {
  const m = await lint('--preset', 'android-65')
  expect(m).toMatchObject({ cssWidth: 360, deviceScaleFactor: 2 })
  expect(m.summary.hairline).toBe(0)
  expect(m.summary['thin-text']).toBe(0)
  expect(byRule(m, 'image-upscaled').sort()).toEqual(['img#fit', 'img#up'])
  expect(find(m, 'img#up')).toMatchObject({ factor: 4, drawnDevicePx: { width: 400, height: 400 } })
  expect(find(m, 'img#fit')).toMatchObject({ factor: 2 })
  expect(find(m, 'img#over')).toMatchObject({ rule: 'image-oversized', factor: 2.5 })
})

test('text scale multiplies the density: at 200% on the 1080p the half-pixel edges are whole and the light text tall enough', async () => {
  const m = await lint('--preset', '1080p-24', '--text-scale', '2')
  expect(m.textScale).toBe(2)
  expect(m.summary.hairline).toBe(0)
  expect(m.summary['thin-text']).toBe(0)
})

test("the thin threshold is the caller's", async () => {
  const m = await lint('--preset', '1080p-24', '--thin-px', '10')
  expect(m.thresholds.thinPx).toBe(10)
  expect(m.summary['thin-text']).toBe(0)
})

test("another command's flag is refused with its owner, exit code 2", async () => {
  const r = await runCli(['lint', fixture('lint.html'), '--tap-mm', '9'])
  expect(r.code).toBe(2)
  expect(r.stderr).toContain('--tap-mm is an audit flag')
})
