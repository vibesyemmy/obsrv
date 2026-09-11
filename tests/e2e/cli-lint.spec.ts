import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
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
  // The srcset images fit a 1x screen: the 100w candidate over 100 device px.
  expect(find(m, 'img#responsive')).toBeUndefined()
  expect(find(m, 'img#short')).toBeUndefined()
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
  expect(byRule(m, 'image-upscaled').sort()).toEqual(['img#fit', 'img#short', 'img#up'])
  expect(find(m, 'img#up')).toMatchObject({ factor: 4, drawnDevicePx: { width: 400, height: 400 } })
  expect(find(m, 'img#fit')).toMatchObject({ factor: 2 })
  expect(find(m, 'img#over')).toMatchObject({ rule: 'image-oversized', factor: 2.5 })
  // A srcset image is judged by the file Chromium chose, not by the element's
  // density-corrected naturalWidth (which reads 100 for both of these): the
  // 200w candidate covers 200 device px, the lone 100w one does not.
  expect(find(m, 'img#responsive')).toBeUndefined()
  expect(find(m, 'img#short')).toMatchObject({ factor: 2, naturalWidth: 100, srcset: true, candidates: ['100w'], chosen: '100w' })
  expect(find(m, 'img#short').message).toContain('(the 100w candidate)')
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

test('--groups-only: the groups and the summary, an empty list, and nothing said about a list', async () => {
  const m = await lint('--preset', '1080p-24', '--groups-only')
  expect(m.findings).toEqual([])
  expect(m.truncated.findings).toBe(0)
  expect(m.groups.length).toBeGreaterThan(0)
  expect(m.summary.hairline).toBeGreaterThan(0)
  expect(m.warnings.join(' ')).not.toMatch(/past the 200 listed/)
  const listed = await lint('--preset', '1080p-24')
  expect(listed.findings.length).toBeGreaterThan(0)
  expect(listed.groups).toEqual(m.groups)
})

test('images are judged by the axis object-fit scales: a cover and a fill of a wide file are upscaled, a contain is not', async () => {
  // The 960×331 file that ebay.co.uk covered a 551×567 box with, which the
  // width-only rule called "upscaled 1.15×" on the phone and nothing on a 1x screen.
  const r = await runCli(['lint', fixture('object-fit.html'), '--preset', '1080p-24'])
  expect(r.code, r.stderr).toBe(0)
  const m = JSON.parse(r.stdout)
  expect(m.summary['image-upscaled']).toBe(2)
  expect(m.summary['image-oversized']).toBe(1)
  const by = (id: string) => m.findings.find((f: { element: string }) => f.element === `img#${id}`)
  expect(by('cover')).toMatchObject({ rule: 'image-upscaled', objectFit: 'cover' })
  expect(by('cover').factor).toBeCloseTo(1.71, 1)
  expect(by('fill')).toMatchObject({ rule: 'image-upscaled', objectFit: 'fill' })
  expect(by('fill').message).toContain('on its height')
  expect(by('small')).toMatchObject({ rule: 'image-oversized', objectFit: 'contain' })
  expect(by('small').factor).toBeCloseTo(4.8, 1)
  for (const id of ['contain', 'none', 'scale-down']) expect(by(id)).toBeUndefined()
})

test('an empty document is held for the grace and said, as for the audit', async () => {
  const r = await runCli(['lint', fixture('empty.html'), '--preset', '1080p-24'])
  expect(r.code, r.stderr).toBe(0)
  const m = JSON.parse(r.stdout)
  expect(m.summary).toEqual({ hairline: 0, 'thin-text': 0, contrast: 0, 'contrast-on-panel': 0, 'image-upscaled': 0, 'image-oversized': 0 })
  expect(m.warnings[0]).toMatch(/^nothing to measure: the page had no visible text, edges or images/)
  const late = await runCli(['lint', fixture('renders-late.html'), '--preset', '1080p-24'])
  expect(JSON.parse(late.stdout).warnings.join(' ')).not.toMatch(/nothing to measure/)
})

test('spacer files are counted, not judged, and do not spend the image cap', async () => {
  // paulgraham.com's desktop table: 332 "upscaled" 1×1 GIFs and 206 more past the cap.
  const r = await runCli(['lint', fixture('spacers.html'), '--preset', '1080p-24'])
  expect(r.code, r.stderr).toBe(0)
  const m = JSON.parse(r.stdout)
  expect(m.summary['image-upscaled']).toBe(1)
  expect(m.findings.map((f: { element: string }) => f.element)).toEqual(['img#photo'])
  expect(m.skipped.spacers).toBe(300)
  expect(m.truncated.images).toBe(0)
  expect(m.warnings.join(' ')).toContain('300 images are a file of a pixel or two on a side stretched into a gap')
})

test('a page that holds its main thread after load: the lint answers within the budget with nothing, and says so', async () => {
  const r = await runCli(['lint', fixture('blocks-after-load.html'), '--preset', '1080p-24', '--timeout', '3000'])
  expect(r.code, r.stderr).toBe(0)
  const m = JSON.parse(r.stdout)
  expect(m.summary).toEqual({ hairline: 0, 'thin-text': 0, contrast: 0, 'contrast-on-panel': 0, 'image-upscaled': 0, 'image-oversized': 0 })
  expect(m.warnings[0]).toMatch(/^the page did not answer the lint within 3 s of loading/)
})

/**
 * A page whose `load` never fires: the document is complete and painted,
 * but /hang.png never answers (apnews.com behind its consent wall, measured
 * 2026-09-11). The snap captured that page as it stood; the measurements
 * refused it. Both should measure what is there.
 */
test.describe('a load that never finishes', () => {
  let server: Server
  let url: string
  const held: ServerResponse[] = []
  test.beforeAll(async () => {
    const html = readFileSync(resolve(__dirname, '../fixtures/never-loads.html'), 'utf8')
    server = createServer((req, res) => {
      if (req.url === '/hang.png') {
        held.push(res)
        return
      }
      res.setHeader('Content-Type', 'text/html')
      res.end(html)
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  })
  test.afterAll(async () => {
    for (const res of held) res.destroy()
    await new Promise<void>(r => server.close(() => r()))
  })

  test('the lint measures the page as it stands, and its first warning names the cut load', async () => {
    const r = await runCli(['lint', url, '--preset', '1080p-24', '--timeout', '3000'])
    expect(r.code, r.stderr).toBe(0)
    const m = JSON.parse(r.stdout)
    expect(m.warnings[0]).toMatch(/^load did not finish within 3000 ms: http:\/\/127\.0\.0\.1:\d+\/ — measured the page as it stood/)
    expect(m.warnings.join(' ')).not.toMatch(/nothing to measure/)
  })
})

/**
 * Two ways a report used to be lost between the page and the judge, and what
 * the reader is told about it (docs/research/2026-09-11-live-run-0.53.0.md).
 */
test.describe('a report that arrives with something odd in it', () => {
  test('a srcset whose comma has no space after it is read, not refused', async () => {
    const r = await runCli(['lint', fixture('srcset-no-space.html'), '--preset', '1080p-24'])
    expect(r.code, r.stderr).toBe(0)
    const m = JSON.parse(r.stdout)
    const glued = m.findings.find((f: { element: string }) => f.element === 'img#glued')
    expect(glued?.message).toContain('200w candidate')
    expect(r.stderr).not.toContain('did not answer the lint')
  })

  test('a report the checks refuse says so, rather than guessing at the page', async () => {
    const r = await runCli(['lint', fixture('long-id.html'), '--preset', '1080p-24'])
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('the page answered the lint')
    expect(r.stderr).toContain('did not pass checking')
    expect(r.stderr).not.toContain('may have navigated away')
  })
})
