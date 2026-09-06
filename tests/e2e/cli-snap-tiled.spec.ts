import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * `snap --full-page --tiled`: a page taller than one surface is captured in
 * bands and stitched, where `--full-page` alone clamps at 4096 device px.
 * The flagless JSON is pinned by cli.spec; the tiled keys appear only when
 * the flag is given.
 */

const BIN = resolve(__dirname, '../../bin/obsrv.js')
const fixture = (name: string): string => pathToFileURL(resolve(__dirname, `../fixtures/${name}`)).href

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd: resolve(__dirname, '../..') })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => (stdout += d))
    child.stderr.on('data', d => (stderr += d))
    child.on('error', fail)
    child.on('close', code => done({ code: code ?? -1, stdout, stderr }))
  })
}

let outDir: string
test.beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'obsrv-tiled-spec-'))
})
test.afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
})

test('a 9,000 px page comes back whole in twelve screenfuls, and the JSON says so', async () => {
  const out = join(outDir, 'tall.png')
  const r = await runCli(['snap', fixture('tall-audit.html'), '--preset', 'laptop-768', '--full-page', '--tiled', '--out', out])
  expect(r.code, r.stderr).toBe(0)
  const json = JSON.parse(r.stdout)
  // One band per screenful of the preset's own 768 px viewport — not a
  // viewport held at the cap, which lays the page out differently.
  expect(json).toMatchObject({ preset: 'laptop-768', tiled: true, bands: 12, cssHeight: 768 })
  expect(json.warnings.join(' ')).not.toMatch(/clamped/)
  expect(r.stderr).toMatch(/captured in 12 band\(s\) of 768 CSS px/)
  // The PNG is taller than one surface could be.
  const png = readFileSync(out)
  expect(png.readUInt32BE(16)).toBe(1366)
  expect(png.readUInt32BE(20)).toBeGreaterThan(4096)
  expect(png.readUInt32BE(20)).toBeLessThanOrEqual(12 * 768)
})

test('a page that fits one surface is one band, and --tiled alone is refused', async () => {
  const out = join(outDir, 'short.png')
  const r = await runCli(['snap', fixture('audit.html'), '--preset', 'laptop-768', '--full-page', '--tiled', '--out', out])
  expect(r.code, r.stderr).toBe(0)
  expect(JSON.parse(r.stdout)).toMatchObject({ tiled: true, bands: 1 })
  const bad = await runCli(['snap', fixture('audit.html'), '--preset', 'laptop-768', '--tiled', '--out', out])
  expect(bad.code).toBe(2)
  expect(bad.stderr).toContain('--tiled goes with --full-page')
})

test('a page sized against the viewport is warned about on one surface, and not when tiled', async () => {
  // `--full-page` alone makes the viewport as tall as the page, so a 100vh
  // hero becomes the whole surface's height and the PNG is a layout the
  // screen never shows. Measured, not assumed: the page is asked again after
  // the surface grows, and only a page that actually moved is warned about.
  const out = join(outDir, 'vu.png')
  const one = await runCli(['snap', fixture('viewport-units.html'), '--preset', 'laptop-768', '--full-page', '--out', out])
  expect(one.code, one.stderr).toBe(0)
  const warned = (JSON.parse(one.stdout).warnings as string[]).join(' ')
  expect(warned).toMatch(/lays out against the viewport height/)
  expect(warned).toMatch(/Add --tiled/)

  const tiled = await runCli(['snap', fixture('viewport-units.html'), '--preset', 'laptop-768', '--full-page', '--tiled', '--out', out])
  expect(tiled.code, tiled.stderr).toBe(0)
  const tiledJson = JSON.parse(tiled.stdout)
  expect(tiledJson).toMatchObject({ tiled: true, cssHeight: 768 })
  expect((tiledJson.warnings as string[]).join(' ')).not.toMatch(/lays out against the viewport height/)

  // And a page that does not size itself against the viewport is not warned
  // about, so the warning stays worth reading.
  const plain = await runCli(['snap', fixture('tall-audit.html'), '--preset', 'laptop-768', '--full-page', '--out', out])
  expect(plain.code, plain.stderr).toBe(0)
  expect((JSON.parse(plain.stdout).warnings as string[]).join(' ')).not.toMatch(/lays out against the viewport height/)
})

test('an app shell says its content is out of reach rather than returning one screen quietly', async () => {
  // `html, body { overflow: hidden }` with an inner scroller — dashboards,
  // editors, most web apps. The document is exactly as tall as the viewport
  // however much content it holds, so a full-page capture that scrolls the
  // window gets the first screen and used to say nothing about it.
  const out = join(outDir, 'shell.png')
  const r = await runCli(['snap', fixture('app-shell-findings.html'), '--preset', 'laptop-768', '--full-page', '--tiled', '--out', out])
  expect(r.code, r.stderr).toBe(0)
  const json = JSON.parse(r.stdout)
  expect(json).toMatchObject({ tiled: true, bands: 1 })
  const warned = (json.warnings as string[]).join(' ')
  expect(warned).toMatch(/the document itself does not scroll/)
  expect(warned).toMatch(/app shell/)
  // It names the height it cannot reach, so the reader knows what is missing.
  expect(warned).toMatch(/inner scroller \d{3,} CSS px tall/)

  // A page the window can scroll is not accused of being one.
  const plain = await runCli(['snap', fixture('tall-audit.html'), '--preset', 'laptop-768', '--full-page', '--tiled', '--out', out])
  expect(plain.code, plain.stderr).toBe(0)
  expect((JSON.parse(plain.stdout).warnings as string[]).join(' ')).not.toMatch(/does not scroll/)
})

test('the walks measure an app shell whole, and pageHeight does not contradict the findings', async () => {
  // The DOM walks see the inner scroller's content, so findings sit far below
  // the document's own height. `pageHeight` used to report the document's,
  // which left an agent with a finding at y=1761 on a page it called 768 tall.
  for (const command of ['audit', 'lint']) {
    const r = await runCli([command, fixture('app-shell-findings.html'), '--preset', 'laptop-768'])
    expect(r.code, r.stderr).toBe(0)
    const m = JSON.parse(r.stdout) as { pageHeight: number; findings: Array<{ rect: { y: number; height: number } }> }
    expect(m.findings.length, `${command} should see below the fold`).toBeGreaterThan(0)
    const deepest = Math.max(...m.findings.map(f => f.rect.y + f.rect.height))
    expect(m.pageHeight, `${command}: pageHeight must cover its own findings`).toBeGreaterThanOrEqual(Math.floor(deepest))
    expect(m.pageHeight).toBeGreaterThan(768)
  }
})
