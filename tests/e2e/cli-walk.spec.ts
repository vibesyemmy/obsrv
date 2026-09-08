import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * The headless walk: `obsrv audit`, `obsrv lint` and `obsrv report` scroll the
 * page a screenful at a time to the end and back before measuring, as the live
 * audit and lint have since 0.42.0, so lazy images load and late sections
 * mount. Measured on apple.com: 19 "upscaled" findings headless — every one a
 * 1×1 placeholder GIF judged against a 1250 px box — against 0 once the page
 * had been walked. The fixture stands in for that page: two images behind a
 * 1×1 GIF until an IntersectionObserver sees them (one fits its box, one is a
 * 100 px file drawn at 200), and a button that only exists once its section
 * has been seen.
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

const run = async (command: 'audit' | 'lint', ...args: string[]): Promise<any> => {
  const r = await runCli([command, fixture('lazy.html'), '--preset', '1080p-24', ...args])
  expect(r.code, r.stderr).toBe(0)
  return JSON.parse(r.stdout)
}
const byRule = (m: any, rule: string): string[] => m.findings.filter((f: any) => f.rule === rule).map((f: any) => f.element)

test('lint walks the page first: the lazy images are judged by the files that arrived, not their placeholders', async () => {
  const m = await run('lint')
  // Three screenfuls of 1080 on a ~2900 px page: two `next` scrolls reach the end.
  expect(m.walked).toMatchObject({ atEnd: true })
  expect(m.walked.screenfuls).toBeGreaterThanOrEqual(2)
  expect(m.walked.ms).toBeGreaterThan(0)
  // The 100 px file drawn at 200 is the one real upscale; the 200 px file fits.
  expect(m.summary['image-upscaled']).toBe(1)
  expect(byRule(m, 'image-upscaled')).toEqual(['img#lazy-up'])
  expect(m.findings.find((f: any) => f.element === 'img#lazy-up')).toMatchObject({ naturalWidth: 100, naturalHeight: 100, factor: 2 })
})

test('--no-walk measures the page as it first shows: both placeholders read as 1×1 files drawn over 200 px', async () => {
  const m = await run('lint', '--no-walk')
  expect(m.walked).toBeUndefined()
  expect(m.summary['image-upscaled']).toBe(2)
  expect(byRule(m, 'image-upscaled').sort()).toEqual(['img#lazy-fit', 'img#lazy-up'])
  for (const f of m.findings) expect(f.naturalWidth).toBe(1)
})

test('audit walks too: the button that mounts on scroll is a target, and is not without the walk', async () => {
  const walked = await run('audit')
  expect(walked.walked).toMatchObject({ atEnd: true })
  expect(walked.summary.targets.count).toBe(1)
  expect(walked.findings.map((f: any) => f.element)).toEqual(['button#late'])
  const still = await run('audit', '--no-walk')
  expect(still.walked).toBeUndefined()
  expect(still.summary.targets.count).toBe(0)
})

test('the report walks each screen before its audit and lint, and says so per screen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'obsrv-walk-'))
  try {
    const out = join(dir, 'report.html')
    const r = await runCli(['report', fixture('lazy.html'), '--preset', '1080p-24', '--out', out])
    expect(r.code, r.stderr).toBe(0)
    const summary = JSON.parse(r.stdout)
    const screen = summary.screens[0]
    expect(screen.walked).toMatchObject({ atEnd: true })
    expect(screen.lint.summary['image-upscaled']).toBe(1)
    expect(screen.audit.summary.targets.count).toBe(1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--no-walk belongs to audit, lint and report; snap refuses it by name', async () => {
  const r = await runCli(['snap', fixture('lazy.html'), '--no-walk', '--out', join(tmpdir(), 'never.png')])
  expect(r.code).toBe(2)
  expect(r.stderr).toContain('--no-walk is an audit flag')
})

test('the walk has no screenful cap: a lazy image fourteen screenfuls down is judged by the file that arrived', async () => {
  // bbc.com on a phone is twenty-two screenfuls; a walk capped at twelve
  // measured the rest as it first shipped, placeholders and all.
  const r = await runCli(['lint', fixture('lazy-tall.html'), '--preset', 'laptop-768'])
  expect(r.code, r.stderr).toBe(0)
  const m = JSON.parse(r.stdout)
  expect(m.walked).toMatchObject({ atEnd: true })
  expect(m.walked.screenfuls).toBeGreaterThanOrEqual(13)
  expect(m.summary['image-upscaled']).toBe(1)
  expect(byRule(m, 'image-upscaled')).toEqual(['img#lazy-up'])
  expect(m.warnings.join(' ')).not.toMatch(/screenfuls without reaching|may be placeholders/)
})
