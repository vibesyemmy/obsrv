import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
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
  // Grouped by kind and size, over every finding: the one small button is its own group.
  expect(r.groups).toEqual([expect.objectContaining({ kind: 'small-target', key: '24 px tall', count: 1, elements: ['button#tiny'] })])
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

test('--groups-only: the summary and the groups, an empty list, and nothing said about a list', async () => {
  const m = await audit('--preset', '1080p-24', '--groups-only')
  expect(m.findings).toEqual([])
  expect(m.groups.length).toBeGreaterThan(0)
  expect(m.summary.targets.under).toBe(1)
  expect(m.warnings.join(' ')).not.toMatch(/past the 200 listed/)
  const listed = await audit('--preset', '1080p-24')
  expect(listed.findings.length).toBeGreaterThan(0)
  expect(listed.groups).toEqual(m.groups)
})

test('a list that was cut says so and counts the cut; with --groups-only there is no list and nothing cut', async () => {
  // 260 targets under the threshold on any screen, 200 listed.
  const listed = await runCli(['audit', fixture('many-targets.html'), '--preset', '1080p-24'])
  expect(listed.code, listed.stderr).toBe(0)
  const l = JSON.parse(listed.stdout)
  expect(l.summary.targets).toMatchObject({ count: 260, under: 260 })
  expect(l.findings).toHaveLength(200)
  expect(l.truncated.findings).toBe(60)
  expect(l.warnings.join(' ')).toContain('60 more findings past the 200 listed')
  // ebay.co.uk with groupsOnly answered `findings: []` and `truncated: { findings: 17 }`.
  const grouped = await runCli(['audit', fixture('many-targets.html'), '--preset', '1080p-24', '--groups-only'])
  expect(grouped.code, grouped.stderr).toBe(0)
  const g = JSON.parse(grouped.stdout)
  expect(g.findings).toEqual([])
  expect(g.truncated.findings).toBe(0)
  expect(g.warnings.join(' ')).not.toMatch(/past the 200 listed/)
  expect(g.groups[0]).toMatchObject({ kind: 'small-target', count: 260 })
})

test('a document that renders after load is held for and measured; one that stays empty is measured as empty and says so', async () => {
  // booking.com's mobile page: empty at `load`, filled by script 900 ms later.
  const late = await runCli(['audit', fixture('renders-late.html'), '--preset', 'android-65'])
  expect(late.code, late.stderr).toBe(0)
  const l = JSON.parse(late.stdout)
  expect(l.summary.targets.count).toBe(1)
  expect(l.summary.text.count).toBeGreaterThanOrEqual(2)
  expect(l.warnings.join(' ')).not.toMatch(/nothing to measure/)
  // Nothing in it, and nothing coming: zeros, held for the grace, and a warning.
  const started = Date.now()
  const empty = await runCli(['audit', fixture('empty.html'), '--preset', 'android-65'])
  expect(empty.code, empty.stderr).toBe(0)
  const e = JSON.parse(empty.stdout)
  expect(e.summary.targets.count).toBe(0)
  expect(e.summary.text.count).toBe(0)
  expect(e.warnings[0]).toMatch(/^nothing to measure: the page had no visible text and no targets 3(\.\d)? s after it loaded/)
  expect(Date.now() - started).toBeGreaterThanOrEqual(3000)
})

test('a page that holds its main thread after load is answered within the budget, with nothing and a sentence', async () => {
  // The shape of stackoverflow.com's bot challenge: the audit sat behind it for
  // minutes and the MCP killed it. Now the page ask is within --timeout.
  const started = Date.now()
  const r = await runCli(['audit', fixture('blocks-after-load.html'), '--preset', '1080p-24', '--timeout', '3000'])
  expect(r.code, r.stderr).toBe(0)
  const m = JSON.parse(r.stdout)
  expect(Date.now() - started).toBeLessThan(25_000)
  expect(m.summary.targets.count).toBe(0)
  expect(m.summary.text.count).toBe(0)
  expect(m.warnings[0]).toMatch(/^the page did not answer the audit within 3 s of loading: its main thread was busy or blocked/)
})

test('a page that navigates itself after load is measured where it arrived, and the answer says so', async () => {
  // An interstitial with nothing in it that moves on to audit.html 400 ms after load.
  const r = await runCli(['audit', fixture('challenge.html'), '--preset', '1080p-24'])
  expect(r.code, r.stderr).toBe(0)
  const m = JSON.parse(r.stdout)
  expect(m.summary.targets.count).toBe(2)
  expect(m.warnings.join(' ')).toMatch(/the page navigated after it loaded, to file:.*audit\.html: a bot challenge, an interstitial or a redirect; the figures are of the page it arrived at/)
  expect(m.warnings.join(' ')).not.toMatch(/nothing to measure/)
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

  test('the audit measures the page as it stands, and its first warning names the cut load', async () => {
    const started = Date.now()
    const r = await runCli(['audit', url, '--preset', '1080p-24', '--timeout', '3000'])
    expect(r.code, r.stderr).toBe(0)
    expect(Date.now() - started).toBeLessThan(40_000)
    const m = JSON.parse(r.stdout)
    expect(m.summary.targets.count).toBeGreaterThanOrEqual(1)
    expect(m.summary.text.count).toBeGreaterThanOrEqual(2)
    expect(m.warnings[0]).toMatch(/^load did not finish within 3000 ms: http:\/\/127\.0\.0\.1:\d+\/ — measured the page as it stood/)
    expect(m.warnings.join(' ')).not.toMatch(/nothing to measure/)
  })
})

test('an empty document that is an iframe says so: a bot wall is not a blank page', async () => {
  // etsy.com's DataDome wall (2026-09-11): the snap shows a heading and a
  // slider, the audit found nothing, and its sentence did not say why.
  const r = await runCli(['audit', fixture('iframe-wall.html'), '--preset', 'android-65'])
  expect(r.code, r.stderr).toBe(0)
  const m = JSON.parse(r.stdout)
  expect(m.summary.targets.count).toBe(0)
  expect(m.warnings.join(' ')).toMatch(/nothing to measure: .*an <iframe> covers 100% of the viewport, which the measurement does not enter/)
})
