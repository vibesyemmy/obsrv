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
  const one = await runCli(['snap', fixture('viewport-units.html'), '--preset', 'laptop-768', '--full-page', '--single-surface', '--out', out])
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

test('an app shell is captured by scrolling the container the page actually scrolls', async () => {
  // `html, body { overflow: hidden }` with an inner scroller — dashboards,
  // editors, most web apps. The document is exactly as tall as the viewport
  // however much content it holds, so scrolling the window captures the first
  // screen and nothing else. --tiled scrolls the element instead, using the
  // same walk the live scroll uses.
  const out = join(outDir, 'shell.png')
  const r = await runCli(['snap', fixture('app-shell-findings.html'), '--preset', 'laptop-768', '--full-page', '--tiled', '--out', out])
  expect(r.code, r.stderr).toBe(0)
  const json = JSON.parse(r.stdout)
  expect(json).toMatchObject({ tiled: true, cssHeight: 768 })
  expect(json.bands, 'the scroller is taller than one screenful').toBeGreaterThan(1)
  expect(r.stderr).toMatch(/scrolls an inner container; captured in \d+ band\(s\)/)
  // The raster is the chrome plus the scroller's whole content, so it is
  // taller than the viewport and not a multiple of it.
  const png = readFileSync(out)
  expect(png.readUInt32BE(16)).toBe(1366)
  expect(png.readUInt32BE(20)).toBeGreaterThan(768 * 2)

  // The chrome above the scroller is captured once, not repeated per band:
  // the top rows are its dark fill and the rows below the first band are not.
  const height = png.readUInt32BE(20)
  expect(height).toBeGreaterThan(1000)
})

test('--single-surface on the same page says the capture is one screen', async () => {
  const out = join(outDir, 'shell-flat.png')
  const r = await runCli(['snap', fixture('app-shell-findings.html'), '--preset', 'laptop-768', '--full-page', '--single-surface', '--out', out])
  expect(r.code, r.stderr).toBe(0)
  const warned = (JSON.parse(r.stdout).warnings as string[]).join(' ')
  expect(warned).toMatch(/the document itself does not scroll/)
  expect(warned).toMatch(/add --tiled to capture the scroller itself/)

  // A page the window can scroll is not accused of being an app shell.
  const plain = await runCli(['snap', fixture('tall-audit.html'), '--preset', 'laptop-768', '--full-page', '--single-surface', '--out', out])
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

test('an app shell whose content the walk cannot reach says so, and an ordinary page is not accused', async () => {
  // Measured on play.tailwindcss.com: root and body both `overflow: hidden`,
  // and not one light-DOM element with `overflow-y: auto` that overflows —
  // its editor scrolls by transform and its preview is an iframe. The walk
  // finds nothing, correctly, and the capture really is one screen. The
  // fixture has that exact shape.
  const out = join(outDir, 'unreachable.png')
  const r = await runCli(['snap', fixture('app-shell-unreachable.html'), '--preset', 'laptop-768', '--full-page', '--tiled', '--out', out])
  expect(r.code, r.stderr).toBe(0)
  const json = JSON.parse(r.stdout)
  expect(json.bands).toBe(1)
  const warned = (json.warnings as string[]).join(' ')
  expect(warned).toMatch(/hides the document's overflow and scrolls nothing the capture can reach/)
  expect(warned).toMatch(/iframe|shadow root|transform/)

  // An app shell that does have a scroller is captured, not warned about.
  const shell = await runCli(['snap', fixture('app-shell-findings.html'), '--preset', 'laptop-768', '--full-page', '--tiled', '--out', out])
  expect(shell.code, shell.stderr).toBe(0)
  expect((JSON.parse(shell.stdout).warnings as string[]).join(' ')).not.toMatch(/scrolls nothing the capture can reach/)

  // Nor is a short ordinary page, whose root simply has nothing to scroll.
  const short = await runCli(['snap', fixture('solid-red.html'), '--preset', 'laptop-768', '--full-page', '--tiled', '--out', out])
  expect(short.code, short.stderr).toBe(0)
  expect((JSON.parse(short.stdout).warnings as string[]).join(' ')).not.toMatch(/scrolls nothing the capture can reach/)
})

test('chrome stuck to the viewport is hidden for the bands after the first, and named in the JSON', async () => {
  const out = join(outDir, 'stuck.png')
  const r = await runCli(['snap', fixture('stuck-chrome.html'), '--preset', 'laptop-768', '--full-page', '--out', out])
  expect(r.code, r.stderr).toBe(0)
  const j = JSON.parse(r.stdout) as {
    bands: number
    stuckChrome: Array<{ element: string; position: string; top: number; height: number }>
  }
  expect(j.bands).toBeGreaterThan(1)
  // Both ways a page sticks chrome, found by measurement rather than by
  // reading `position` — which is why the fixture uses one of each.
  const found = j.stuckChrome.map(b => `${b.element}:${b.position}`).sort()
  expect(found).toEqual(['div#sticky-bar:sticky', 'header#fixed-bar:fixed'])
  // The rail is stuck too and stays: it covers no page content, and hiding it
  // would leave a blank column down every band after the first.
  expect(found.join(' ')).not.toContain('rail')
  expect(r.stderr).toContain('hid chrome stuck to the viewport')
})

test('--keep-stuck-chrome leaves every band as the capture used to take it', async () => {
  const out = join(outDir, 'stuck-kept.png')
  const r = await runCli(['snap', fixture('stuck-chrome.html'), '--preset', 'laptop-768', '--full-page', '--keep-stuck-chrome', '--out', out])
  expect(r.code, r.stderr).toBe(0)
  expect((JSON.parse(r.stdout) as { stuckChrome: unknown[] }).stuckChrome).toEqual([])
  expect(r.stderr).not.toContain('hid chrome stuck to the viewport')
})

test('the two captures are the same size and differ only where the chrome was', async () => {
  // The reason hiding is `visibility` and not `display: none`: the page must
  // be laid out identically, so the bands still stitch to the same raster.
  const hidden = join(outDir, 'cmp-hidden.png')
  const kept = join(outDir, 'cmp-kept.png')
  const a = await runCli(['snap', fixture('stuck-chrome.html'), '--preset', 'laptop-768', '--full-page', '--out', hidden])
  const b = await runCli(['snap', fixture('stuck-chrome.html'), '--preset', 'laptop-768', '--full-page', '--keep-stuck-chrome', '--out', kept])
  expect(a.code, a.stderr).toBe(0)
  expect(b.code, b.stderr).toBe(0)
  const dims = (out: string): { width: number; height: number } => {
    const { width, height } = JSON.parse(out) as { width: number; height: number }
    return { width, height }
  }
  expect(dims(a.stdout)).toEqual(dims(b.stdout))
  expect(readFileSync(hidden).equals(readFileSync(kept))).toBe(false)
})

test('a page with no stuck chrome hides nothing and says nothing', async () => {
  const out = join(outDir, 'plain.png')
  const r = await runCli(['snap', fixture('tall-audit.html'), '--preset', 'laptop-768', '--full-page', '--out', out])
  expect(r.code, r.stderr).toBe(0)
  expect((JSON.parse(r.stdout) as { stuckChrome: unknown[] }).stuckChrome).toEqual([])
  expect(r.stderr).not.toContain('hid chrome stuck to the viewport')
})

test('--keep-stuck-chrome without --full-page is a usage error saying what it goes with', async () => {
  const r = await runCli(['snap', fixture('stuck-chrome.html'), '--keep-stuck-chrome'])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toContain('--keep-stuck-chrome goes with --full-page')
})

test("an app shell's own sticky toolbar is hidden too, and its surrounding chrome is left alone", async () => {
  const out = join(outDir, 'shell-sticky.png')
  const r = await runCli(['snap', fixture('app-shell-sticky.html'), '--preset', 'laptop-768', '--full-page', '--out', out])
  expect(r.code, r.stderr).toBe(0)
  const j = JSON.parse(r.stdout) as { bands: number; stuckChrome: Array<{ element: string; position: string }> }
  expect(j.bands).toBeGreaterThan(1)
  // The toolbar spans the scroller (1,166 of 1,366 CSS px), so it is only
  // full-bleed once the frame is the scroller rather than the viewport.
  expect(j.stuckChrome.map(b => b.element)).toEqual(['div#toolbar'])
  expect(r.stderr).toContain('hid chrome stuck inside the scroller')
  // Everything else about that page must survive the mutation: the header and
  // the nav are outside the scroller and sliced out of these bands already,
  // the rail is a column, and #app is fixed, full-bleed and holds the
  // scroller — hiding it would blank the capture.
  const named = JSON.stringify(j.stuckChrome)
  for (const safe of ['app-header', 'app-nav', 'rail', 'div#app"']) expect(named).not.toContain(safe)
})

test('an app shell with no stuck chrome inside its scroller hides nothing', async () => {
  const out = join(outDir, 'shell-plain.png')
  const r = await runCli(['snap', fixture('app-shell-findings.html'), '--preset', 'laptop-768', '--full-page', '--out', out])
  expect(r.code, r.stderr).toBe(0)
  expect((JSON.parse(r.stdout) as { stuckChrome: unknown[] }).stuckChrome).toEqual([])
})

test("the shell's two captures are the same size and differ only where the toolbar was", async () => {
  const hidden = join(outDir, 'shell-cmp-hidden.png')
  const kept = join(outDir, 'shell-cmp-kept.png')
  const a = await runCli(['snap', fixture('app-shell-sticky.html'), '--preset', 'laptop-768', '--full-page', '--out', hidden])
  const b = await runCli(['snap', fixture('app-shell-sticky.html'), '--preset', 'laptop-768', '--full-page', '--keep-stuck-chrome', '--out', kept])
  expect(a.code, a.stderr).toBe(0)
  expect(b.code, b.stderr).toBe(0)
  const dims = (out: string): { width: number; height: number } => {
    const { width, height } = JSON.parse(out) as { width: number; height: number }
    return { width, height }
  }
  expect(dims(a.stdout)).toEqual(dims(b.stdout))
  expect(readFileSync(hidden).equals(readFileSync(kept))).toBe(false)
})
