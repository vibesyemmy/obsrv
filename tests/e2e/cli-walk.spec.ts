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

test('a page held by a consent layer: the walk sees no page to cross, and the measurement says so', async () => {
  // theguardian.com fixes its body under its consent layer: the walk answers
  // 0 screenfuls at the end, the audit measures 239 targets on a 20,596 px
  // page behind the layer, and nothing said a word.
  const r = await runCli(['audit', fixture('locked.html'), '--preset', 'laptop-768'])
  expect(r.code, r.stderr).toBe(0)
  const m = JSON.parse(r.stdout)
  expect(m.walked).toMatchObject({ screenfuls: 0, atEnd: true })
  expect(m.pageHeight).toBeGreaterThan(3000)
  expect(m.summary.targets.count).toBeGreaterThanOrEqual(3)
  expect(m.warnings.join(' ')).toMatch(/the walk saw the end after 0 screenfuls .* but the page measures \d+ CSS px .*modal or a locked scroll/)
  const l = await runCli(['lint', fixture('locked.html'), '--preset', 'laptop-768'])
  expect(l.code, l.stderr).toBe(0)
  expect(JSON.parse(l.stdout).warnings.join(' ')).toMatch(/modal or a locked scroll held the page/)
})

test('a page that hides its overflow with nothing to scroll says so, instead of reading as one screen', async () => {
  // spotify.com's web player on desktop (2026-09-11): the full-page capture
  // warned, the audit and lint answered `walked: { screenfuls: 0, atEnd: true }`
  // and nothing else. The walk carries the capture's sentence now.
  const r = await runCli(['audit', fixture('app-shell-unreachable.html'), '--preset', 'laptop-768'])
  expect(r.code, r.stderr).toBe(0)
  const m = JSON.parse(r.stdout)
  expect(m.walked).toMatchObject({ screenfuls: 0, atEnd: true })
  expect(m.warnings.join(' ')).toMatch(/hides the document's overflow and has no scrollable container in its light DOM, so the walk had nothing to scroll/)
})

test('a page locked behind a dialog says the walk scrolled the dialog, not the page', async () => {
  // The consent wall, the paywall, the onboarding modal: the body is fixed in
  // place, so the only scroller left in the light DOM is the dialog's own
  // panel. The walk scrolls that and used to report screenfuls and an end
  // that belonged to a 300 px panel, with nothing to say the page never
  // moved (measured 2026-09-12; airbnb.com's dialog is the same shape).
  const r = await runCli(['audit', fixture('dialog-locked.html'), '--preset', '1080p-24'])
  expect(r.code, r.stderr).toBe(0)
  const m = JSON.parse(r.stdout)
  expect(m.walked.screenfuls).toBeGreaterThan(0)
  expect(m.warnings.join(' ')).toMatch(/the walk scrolled a dialog, not the page/)
  expect(m.warnings.join(' ')).toMatch(/was not brought into view before measuring/)
})

test('the lint says it too, on the same page', async () => {
  const r = await runCli(['lint', fixture('dialog-locked.html'), '--preset', '1080p-24', '--groups-only'])
  expect(r.code, r.stderr).toBe(0)
  expect(JSON.parse(r.stdout).warnings.join(' ')).toMatch(/the walk scrolled a dialog, not the page/)
})

test('an app shell scrolling its own container is not called a dialog', async () => {
  // The neighbouring case must stay quiet: same locked document, no dialog.
  const r = await runCli(['audit', fixture('app-shell-unreachable.html'), '--preset', 'laptop-768'])
  expect(r.code, r.stderr).toBe(0)
  expect(JSON.parse(r.stdout).warnings.join(' ')).not.toMatch(/scrolled a dialog/)
})

test('a page that grew under the walk is told it grew, not offered a modal', async () => {
  // theguardian.com (9 screenfuls of 21,440 px), spiegel.de (10 of 34,582)
  // and nytimes.com (6 of 9,741) were each told "a modal or a locked scroll
  // held the page" about a page whose root the walk had just scrolled to its
  // end — a cause the walk had already ruled out (2026-09-12).
  const r = await runCli(['audit', fixture('grows-as-walked.html'), '--preset', '1080p-24'])
  expect(r.code, r.stderr).toBe(0)
  const m = JSON.parse(r.stdout)
  expect(m.walked).toMatchObject({ atEnd: true })
  const warnings = m.warnings.join(' ')
  expect(warnings).toMatch(/the page grew as it was walked/)
  expect(warnings).not.toMatch(/a modal or a locked scroll/)
})

test('a walk that went nowhere on a tall page still reads as held', async () => {
  // The other branch: zero screenfuls is the shape a lock makes, and the
  // cautious sentence is right there even when nothing says the document
  // was locked.
  const r = await runCli(['audit', fixture('app-shell-unreachable.html'), '--preset', 'laptop-768'])
  expect(r.code, r.stderr).toBe(0)
  const warnings = JSON.parse(r.stdout).warnings.join(' ')
  if (/the walk saw the end after/.test(warnings)) {
    expect(warnings).toMatch(/a modal or a locked scroll held the page/)
  }
})

/**
 * A page that replaces itself under the walk — HMR, an auth redirect, a
 * router — puts a new document at the top, and the walk kept counting across
 * both: driving the live app at such a page returned 10 screenfuls for a
 * 6.8-screenful page, and `atEnd` vouched for the end of a document that was
 * gone (measured 2026-09-13). The count must describe the page the figures
 * are of, which is the one it ended on.
 */
test('the walk counts screenfuls of the page it ended on, not of the one that was replaced', async () => {
  const r = await runCli(['audit', fixture('replaces-itself-on-scroll.html'), '--preset', '1080p-24', '--groups-only'])
  expect(r.code, r.stderr).toBe(0)
  const m = JSON.parse(r.stdout)
  // The figures are of the second document.
  expect(m.warnings.join(' ')).toContain('navigated after it loaded')
  // Its own height, in screenfuls of the 1080 px screen, is the ceiling the
  // count must respect: before the fix this was 4 on a 3-screenful page.
  const screenfulsOfPage = Math.ceil(m.pageHeight / 1080)
  expect(m.walked.screenfuls).toBeLessThanOrEqual(screenfulsOfPage)
  expect(m.walked.atEnd).toBe(true)
})
