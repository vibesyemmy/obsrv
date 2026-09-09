import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * A page with no viewport meta tag under a phone preset is laid out at
 * Chromium's 980 px fallback and drawn scaled to fit the 360 px screen. Every
 * length the page reports is in its own layout px, and the audit, lint and
 * inspect converted them to millimetres and device pixels as if they were the
 * screen's: berkshirehathaway.com's 10 px dates came back 1.88 mm (they are
 * 0.69), a 75 px logo drawn at 55 device px was called "upscaled 2×", and the
 * walk-coverage note said a one-screen page was three screenfuls, because its
 * height in layout px (2,178 = 800 × 980/360) was compared with the screen's
 * 800. The fixture is that page, twice: once without the meta tag and once
 * with it, so the twin says what the figures should have been all along.
 */

const BIN = resolve(__dirname, '../../bin/obsrv.js')
const fixture = (name: string): string => pathToFileURL(resolve(__dirname, `../fixtures/${name}`)).href
const NO_META = fixture('noviewport.html')
const WITH_META = fixture('noviewport-meta.html')
/** 360 / 980, as `layoutScale` rounds it. */
const SCALE = 0.3673

function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise(done => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd: resolve(__dirname, '../..') })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => (stdout += d))
    child.stderr.on('data', d => (stderr += d))
    child.on('close', code => done({ code, stdout, stderr }))
  })
}

const run = async (command: string, url: string, ...args: string[]): Promise<any> => {
  const r = await runCli([command, url, '--preset', 'android-65', ...args])
  expect(r.code, r.stderr).toBe(0)
  return JSON.parse(r.stdout)
}

test('audit: millimetres are of the page as drawn, and the coverage note is silent on a one-screen page', async () => {
  const m = await run('audit', NO_META)
  expect(m.layoutScale).toBeCloseTo(SCALE, 3)
  // The page's own coordinates are untouched: 980 wide, so its height is the
  // visual viewport's 800 in layout px.
  expect(m.pageHeight).toBeGreaterThan(2000)
  expect(m.walked).toMatchObject({ screenfuls: 0, atEnd: true })
  // 44 px drawn at 44 × 360/980 = 16.2 CSS px: 3.04 mm on this 269.9 ppi screen, under 7.
  // (Its 16 px label is a small-text finding of the same element, listed first.)
  const button = m.findings.find((f: any) => f.kind === 'small-target' && f.element === 'button#b')
  expect(button).toMatchObject({ kind: 'small-target', cssWidth: 44, cssHeight: 44 })
  expect(button.mm).toBeCloseTo(3.04, 1)
  // 12 px drawn at 4.4: 0.83 mm, and 16 px at 5.9: 1.11 mm — both under 2, both reported.
  const small = m.findings.find((f: any) => f.element === 'p#small')
  expect(small).toMatchObject({ kind: 'small-text', fontSizePx: 12 })
  expect(small.mm).toBeCloseTo(0.83, 1)
  expect(m.summary.text.under).toBeGreaterThanOrEqual(2)
  expect(m.summary.text.smallestMm).toBeCloseTo(0.83, 1)
  const warnings: string[] = m.warnings
  expect(warnings.join(' ')).toMatch(/lays out 980 CSS px wide where the screen gives it 360 and is drawn at 0\.37× to fit/)
  expect(warnings.join(' ')).toMatch(/no viewport meta tag/)
  expect(warnings.join(' ')).not.toMatch(/the walk saw the end/)
})

test('audit: the twin with the meta tag is the same page at scale 1, and says nothing about it', async () => {
  const m = await run('audit', WITH_META)
  expect(m.layoutScale).toBe(1)
  const button = m.findings.find((f: any) => f.kind === 'small-target' && f.element === 'button#b')
  // 44 px at 2x on 269.9 ppi is 8.28 mm: not a finding.
  expect(button).toBeUndefined()
  expect(m.summary.targets.smallestMm).toBeCloseTo(8.28, 1)
  expect(m.summary.text.smallestMm).toBeCloseTo(2.26, 1)
  expect(m.warnings.join(' ')).not.toMatch(/viewport meta/)
})

test('lint: device pixels are of the page as drawn, so the logo is not "upscaled" and the half-pixel rule is a hairline', async () => {
  const scaled = await run('lint', NO_META)
  expect(scaled.layoutScale).toBeCloseTo(SCALE, 3)
  // A 75 px file drawn at 75 layout px is 55 device px on this screen: downsampled a little, no finding.
  expect(scaled.summary['image-upscaled']).toBe(0)
  expect(scaled.summary['image-oversized']).toBe(0)
  // 0.5 px at 2x is a whole device pixel on the twin, and 0.37 of one here.
  expect(scaled.summary.hairline).toBe(1)
  expect(scaled.findings.find((f: any) => f.rule === 'hairline')).toMatchObject({ element: 'div#rule' })
  expect(scaled.warnings.join(' ')).toMatch(/no viewport meta tag/)
  expect(scaled.warnings.join(' ')).not.toMatch(/the walk saw the end/)

  const twin = await run('lint', WITH_META)
  expect(twin.layoutScale).toBe(1)
  expect(twin.summary.hairline).toBe(0)
  // The same file over 150 device px: the "upscaled 2×" the unscaled figures gave the real logo.
  expect(twin.summary['image-upscaled']).toBe(1)
  expect(twin.findings.find((f: any) => f.rule === 'image-upscaled')).toMatchObject({ element: 'img#logo', factor: 2 })
})

test('inspect: the box and the font in millimetres as drawn, the layout px as they are, and a note saying which is which', async () => {
  const r = await runCli(['inspect', NO_META, '--preset', 'android-65', '--selector', '#b'])
  expect(r.code, r.stderr).toBe(0)
  const m = JSON.parse(r.stdout)
  expect(m.readout.layoutScale).toBeCloseTo(SCALE, 3)
  expect(m.readout.rect).toMatchObject({ width: 44, height: 44 })
  expect(m.readout.rectMm.width).toBeCloseTo(3.04, 1)
  expect(m.readout.font.px).toBe(16)
  expect(m.readout.font.mm).toBeCloseTo(1.11, 1)
  expect(m.readout.notes.join(' ')).toMatch(/no viewport meta tag/)
  expect(m.notes.join(' ')).toMatch(/no viewport meta tag/)

  const twin = await runCli(['inspect', WITH_META, '--preset', 'android-65', '--selector', '#b'])
  expect(twin.code, twin.stderr).toBe(0)
  const t = JSON.parse(twin.stdout)
  expect(t.readout.layoutScale).toBe(1)
  expect(t.readout.rectMm.width).toBeCloseTo(8.28, 1)
  expect(t.readout.font.mm).toBeCloseTo(3.01, 1)
  expect(t.readout.notes).toEqual([])
})
