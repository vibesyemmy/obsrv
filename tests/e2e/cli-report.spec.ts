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
  expect(summary.htmlBytes).toBe(statSync(out).size)

  const html = readFileSync(out, 'utf8')
  expect(html.startsWith('<!doctype html>')).toBe(true)
  expect(html).toContain('1366×768 15.6&quot;')
  expect(html).toContain('Budget Android 6.5&quot; @2x')
  // Two renders plus the laptop's 2x reference.
  expect((html.match(/src="data:image\/png;base64,/g) ?? []).length).toBe(3)
  expect(html).toContain('button#tiny')
  expect(html).toContain('No comparison: a dense screen')
  expect(html).not.toMatch(/<script/i)
  expect(html).not.toMatch(/src="https?:/i)
  expect(r.stderr).toMatch(/report .* → .*report\.html \(2 screen\(s\)/)
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

test('--profile applies to the renders and the diff', async () => {
  const out = join(outDir, 'tn.html')
  const r = await runCli(['report', fixture('audit.html'), '--preset', 'laptop-768', '--profile', 'budget-tn', '--out', out])
  expect(r.code, r.stderr).toBe(0)
  expect(JSON.parse(r.stdout).profile).toBe('budget-tn')
  expect(readFileSync(out, 'utf8')).toContain('Panel profile <b>Budget TN</b>')
})
