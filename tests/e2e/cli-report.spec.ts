import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * `obsrv report`: the three commands on one page. A 1x screen and a phone
 * over the audit fixture: the page must hold both renders, the audit
 * findings in millimetres, the diff for the 1x screen and the reason there
 * is none for the phone — self-contained, and with the page's own text
 * escaped. The JSON on stdout carries the summary an agent reads.
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

let outDir: string
test.beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'obsrv-report-spec-'))
})
test.afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
})

test('a laptop and a phone on one page: renders, audit, diff where it applies, and a JSON summary', async () => {
  const out = join(outDir, 'report.html')
  const r = await runCli(['report', fixture('audit.html'), '--matrix', 'laptop-768,android-65', '--out', out])
  expect(r.code, r.stderr).toBe(0)

  const summary = JSON.parse(r.stdout)
  expect(summary.out).toBe(out)
  expect(summary.profile).toBe('reference')
  expect(summary.thresholds).toEqual({ tapMm: 7, textMm: 2 })
  expect(summary.screens.map((s: any) => s.preset)).toEqual(['laptop-768', 'android-65'])
  const [laptop, phone] = summary.screens
  expect(laptop.diff).not.toBeNull()
  expect(laptop.diffSkipped).toBeNull()
  expect(laptop.diff.rows.ratio).toBeGreaterThan(0)
  expect(laptop.audit.summary.targets).toMatchObject({ count: 2, under: 1 })
  expect(phone.diff).toBeNull()
  expect(phone.diffSkipped).toMatch(/dense screen/)
  expect(phone.audit.findings).toBe(3)
  expect(phone.deviceScaleFactor).toBe(2)
  // Each screen with findings locates them on a full-page overview: the count
  // is in the JSON, the images in the HTML.
  expect(laptop.problems).toMatchObject({ featured: 1, belowCapture: 0 })
  expect(phone.problems).toMatchObject({ featured: 3, belowCapture: 0 })
  // The lint ran on the same loaded page; this fixture gives it nothing.
  expect(laptop.lint).toMatchObject({ findings: 0, groups: 0 })
  expect(phone.lint).toMatchObject({ findings: 0, groups: 0 })
  expect(summary.htmlBytes).toBe(statSync(out).size)

  const html = readFileSync(out, 'utf8')
  expect(html.startsWith('<!doctype html>')).toBe(true)
  expect(html).toContain('1366×768 15.6&quot;')
  expect(html).toContain('Budget Android 6.5&quot; @2x')
  // Two renders plus the laptop's 2x reference, plus the full-page overviews
  // and the crops of the located findings.
  expect((html.match(/src="data:image\/png;base64,/g) ?? []).length).toBeGreaterThanOrEqual(3)
  // The new "where" section: an overview with numbered pins and cropped findings.
  expect(html).toContain('Where the problems are')
  expect((html.match(/class="pin"/g) ?? []).length).toBe(4) // 1 on the laptop, 3 on the phone
  // The two overviews are JPEG maps; the renders, the reference and the crops stay PNG.
  expect((html.match(/src="data:image\/jpeg;base64,/g) ?? []).length).toBe(2)
  expect((html.match(/class="crop"><img src="data:image\/png;base64,/g) ?? []).length).toBe(4)
  expect(html).toContain('button#tiny')
  expect(html).toContain('No comparison: a dense screen')
  expect(html).not.toMatch(/<script/i)
  expect(html).not.toMatch(/src="https?:/i)
  expect(r.stderr).toMatch(/report .* → .*report\.html \(2 screen\(s\)/)
})

test('a page taller than the capture cap is captured in bands, so a finding at the bottom is located too', async () => {
  const out = join(outDir, 'tall.html')
  const r = await runCli(['report', fixture('tall-audit.html'), '--preset', 'laptop-768', '--out', out])
  expect(r.code, r.stderr).toBe(0)
  const summary = JSON.parse(r.stdout)
  const [laptop] = summary.screens
  // Two small buttons, one at the top and one ~8.7k px down: both are
  // findings, and with the page captured in bands neither is below the
  // captured height.
  expect(laptop.audit.summary.targets).toMatchObject({ count: 3, under: 2 })
  expect(laptop.problems).toMatchObject({ featured: 2, belowCapture: 0 })
  // The bands, not a clamp: the human line says so and no clamp warning is raised.
  expect(r.stderr).toMatch(/captured in 3 band\(s\) of 4096 CSS px/)
  expect(laptop.warnings.join(' ')).not.toMatch(/clamped to/)
  const html = readFileSync(out, 'utf8')
  expect((html.match(/class="pin"/g) ?? []).length).toBe(2)
  expect(html).toContain('button#bottom')
  // The bottom pin sits near the foot of the overview: its top fraction is
  // well past the point a single capped capture would have reached.
  const tops = [...html.matchAll(/class="pin" style="left:[\d.]+%;top:([\d.]+)%"/g)].map(m => Number(m[1]))
  expect(Math.max(...tops)).toBeGreaterThan(90)
})

test('the lint is on the page too: grouped rows, and its exemplars get pins and crops alongside the audit', async () => {
  const out = join(outDir, 'lint.html')
  const r = await runCli(['report', fixture('lint.html'), '--preset', '1080p-24', '--profile', 'budget-tn', '--out', out])
  expect(r.code, r.stderr).toBe(0)
  const summary = JSON.parse(r.stdout)
  const [screen] = summary.screens
  // The same numbers `obsrv lint --preset 1080p-24 --profile budget-tn` reports (cli-lint.spec): seven findings, each its own group.
  expect(screen.lint.summary).toEqual({ hairline: 2, 'thin-text': 1, contrast: 1, 'contrast-on-panel': 1, 'image-upscaled': 1, 'image-oversized': 1 })
  expect(screen.lint).toMatchObject({ findings: 7, groups: 7, skipped: { textOnImages: 1 } })
  // No audit findings on this fixture at 1080p, so the featured pins are lint exemplars: the per-source cap of six.
  expect(screen.audit.findings).toBe(0)
  expect(screen.problems).toMatchObject({ featured: 6, belowCapture: 0 })
  const html = readFileSync(out, 'utf8')
  expect(html).toContain('Lint — what this screen and its panel break')
  expect(html).toContain('p#grey')
  expect(html).toContain('#767676 on #ffffff')
  expect((html.match(/class="pin"/g) ?? []).length).toBe(6)
  expect(html).toContain('hairline height 0.5px = 0.5 device px')
})

test('the default matrix is four screens and the default file is obsrv-report.html', async () => {
  // Parsed, not rendered: six renders is more than a spec should spend on a filename.
  const r = await runCli(['report'])
  expect(r.code).toBe(2)
  expect(r.stderr).toMatch(/usage: obsrv report <url>/)
  const help = await runCli(['--help'])
  expect(help.stdout).toContain('laptop-768,1080p-24,android-65,iphone-61')
  expect(help.stdout).toContain('obsrv-report.html')
})

test('--profile applies to the render shown; the diff is measured without it', async () => {
  const out = join(outDir, 'tn.html')
  const r = await runCli(['report', fixture('audit.html'), '--preset', 'laptop-768', '--profile', 'budget-tn', '--out', out])
  expect(r.code, r.stderr).toBe(0)
  const summary = JSON.parse(r.stdout)
  expect(summary.profile).toBe('budget-tn')
  // The fixture is mostly white: a profile that darkened it into the ink
  // threshold would report near-100% coverage, which is the defect this
  // pins. Unprofiled, a page of a few lines of text is a few percent ink.
  expect(summary.screens[0].diff.inkCoverage.target).toBeLessThan(0.2)
  const html = readFileSync(out, 'utf8')
  expect(html).toContain('Panel profile <b>Budget TN</b>')
  // The profiled render, plus the unprofiled pair, plus the overview and crops.
  expect((html.match(/src="data:image\/png;base64,/g) ?? []).length).toBeGreaterThanOrEqual(3)
  expect(html).toContain('without the panel profile')
})
