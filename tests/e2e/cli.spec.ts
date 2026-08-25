import { test, expect } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { decodePng, pixelAt } from './helpers/decodePng'

/**
 * Drives the real thing: `node bin/obsrv.js …` as a child process, the way an
 * agent or CI would. Each invocation boots its own Electron with a throwaway
 * user-data dir, so these specs coexist with the app instance the other e2e
 * files launch. PNGs are decoded by tests/e2e/helpers/decodePng (zlib + the
 * PNG spec, no nativeImage), so a swapped channel order in the CLI's encoder
 * cannot round-trip invisibly.
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
  outDir = mkdtempSync(join(tmpdir(), 'obsrv-cli-spec-'))
})
test.afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
})

// Each spawn boots a full Electron; give the slower ones headroom.
test.describe.configure({ timeout: 120_000 })

test('snap: solid red at laptop-768 — dims, JSON contract, true RGB red', async () => {
  const out = join(outDir, 'red.png')
  const r = await runCli(['snap', fixture('solid-red.html'), '--preset', 'laptop-768', '--out', out])
  expect(r.code).toBe(0)

  const json = JSON.parse(r.stdout)
  expect(json).toEqual({
    out,
    preset: 'laptop-768',
    cssWidth: 1366,
    cssHeight: 768,
    deviceScaleFactor: 1,
    profile: 'reference',
    settled: true,
    warnings: [],
  })
  expect(r.stderr).toContain('1366×768 device px')

  const png = decodePng(readFileSync(out))
  expect(png.width).toBe(1366)
  expect(png.height).toBe(768)
  // Channel-order ground truth: a swapped encoder would put blue here.
  const [red, green, blue, alpha] = pixelAt(png, 683, 384)
  expect(red).toBeGreaterThan(250)
  expect(green).toBeLessThan(10)
  expect(blue).toBeLessThan(10)
  expect(alpha).toBe(255)
})

test('snap: iphone-61 rasterises at the true 3x device resolution', async () => {
  const out = join(outDir, 'iphone.png')
  const r = await runCli(['snap', fixture('thin-text.html'), '--preset', 'iphone-61', '--out', out])
  expect(r.code).toBe(0)
  expect(JSON.parse(r.stdout)).toMatchObject({ cssWidth: 393, cssHeight: 852, deviceScaleFactor: 3 })
  const png = decodePng(readFileSync(out))
  expect(png.width).toBe(1179)
  expect(png.height).toBe(2556)
})

test('snap: a panel profile changes the pixels', async () => {
  const ref = join(outDir, 'profile-ref.png')
  const tn = join(outDir, 'profile-tn.png')
  const a = await runCli(['snap', fixture('hairline.html'), '--preset', 'laptop-768', '--out', ref])
  const b = await runCli(['snap', fixture('hairline.html'), '--preset', 'laptop-768', '--profile', 'budget-tn', '--out', tn])
  expect(a.code).toBe(0)
  expect(b.code).toBe(0)
  expect(JSON.parse(b.stdout).profile).toBe('budget-tn')
  const refPng = decodePng(readFileSync(ref))
  const tnPng = decodePng(readFileSync(tn))
  expect([tnPng.width, tnPng.height]).toEqual([refPng.width, refPng.height])
  expect(Buffer.compare(readFileSync(ref), readFileSync(tn))).not.toBe(0)
})

test('snap: --full-page grows to the page height and warns when clamped', async () => {
  // A 1366×4096 surface is a big ask of the software rasteriser on a loaded
  // machine: give both the CLI (--timeout) and the spec generous budgets.
  test.setTimeout(240_000)
  const out = join(outDir, 'tall.png')
  // tall.html is 5000 CSS px: taller than the 768 viewport AND past the 4096
  // device-px budget, so this exercises growth and the clamp warning at once.
  const r = await runCli(['snap', fixture('tall.html'), '--preset', 'laptop-768', '--full-page', '--timeout', '120000', '--out', out])
  expect(r.code).toBe(0)
  expect(r.stderr).toMatch(/clamped to 4096/)
  const json = JSON.parse(r.stdout)
  expect(json.cssHeight).toBe(4096)
  expect(json.settled).toBe(true)
  expect(json.warnings.join(' ')).toMatch(/clamped to 4096/)
  const png = decodePng(readFileSync(out))
  expect(png.width).toBe(1366)
  expect(png.height).toBe(4096)
  expect(png.height).toBeGreaterThan(768)
})

test('diff: thin text at laptop-768 — parseable JSON, the 2:1 row finding, band metrics', async () => {
  const dir = join(outDir, 'diff')
  const r = await runCli(['diff', fixture('thin-text.html'), '--preset', 'laptop-768', '--out-dir', dir])
  expect(r.code).toBe(0)

  const json = JSON.parse(r.stdout)
  expect(json.preset).toBe('laptop-768')
  expect(json.inkCoverage.target).toBeGreaterThan(0)
  expect(json.inkCoverage.reference).toBeGreaterThan(0)

  // rendering.spec.ts's proven finding, reproduced headlessly: the same
  // glyphs occupy ~half as many device rows at 1x as at 2x.
  expect(json.rows.target).toBeGreaterThan(3)
  expect(json.rows.reference).toBeGreaterThan(json.rows.target * 1.5)
  expect(json.rows.ratio).toBeGreaterThan(0.3)
  expect(json.rows.ratio).toBeLessThan(0.7)

  expect(json.bands).toHaveLength(8)
  expect(json.bands[0].y1).toBe(96)
  expect(Array.isArray(json.findings)).toBe(true)

  // --out-dir wrote both comparanda on the same 1x grid.
  const target = decodePng(readFileSync(join(dir, 'target.png')))
  const reference = decodePng(readFileSync(join(dir, 'reference.png')))
  expect([target.width, target.height]).toEqual([1366, 768])
  expect([reference.width, reference.height]).toEqual([1366, 768])
})

test('snap leaves no obsrv-cli-* user-data dirs behind in os.tmpdir', async () => {
  const staleDirs = (): Set<string> => new Set(readdirSync(tmpdir()).filter(n => n.startsWith('obsrv-cli-') && !n.startsWith('obsrv-cli-spec-')))
  const before = staleDirs()
  const r = await runCli(['snap', fixture('solid-red.html'), '--preset', 'laptop-768', '--out', join(outDir, 'leak.png')])
  expect(r.code).toBe(0)
  const leaked = [...staleDirs()].filter(n => !before.has(n))
  expect(leaked).toEqual([])
})

test('SIGTERM to the launcher takes the Electron child down, leak-free', async () => {
  const marker = `sigterm-probe-${Date.now()}`
  const before = new Set(readdirSync(tmpdir()).filter(n => n.startsWith('obsrv-cli-')))
  // --wait keeps the render alive long enough to signal it mid-flight.
  const child = spawn(process.execPath, [
    BIN, 'snap', fixture('solid-red.html'), '--preset', 'laptop-768', '--wait', '60000', '--out', join(outDir, `${marker}.png`),
  ], { cwd: resolve(__dirname, '../..') })
  const closed = new Promise<void>(done => child.on('close', () => done()))
  try {
    // The Electron child's argv carries both the built entry and our unique
    // marker; the node launcher carries only the marker, helpers neither.
    const findElectron = (): number | null => {
      for (const line of execFileSync('ps', ['-axo', 'pid=,command=']).toString().split('\n')) {
        if (line.includes('out/main/cli.js') && line.includes(marker)) return Number.parseInt(line.trim(), 10)
      }
      return null
    }
    let pid: number | null = null
    const bootDeadline = Date.now() + 30_000
    while (pid === null && Date.now() < bootDeadline) {
      pid = findElectron()
      if (pid === null) await new Promise(r => setTimeout(r, 200))
    }
    expect(pid).not.toBeNull()

    child.kill('SIGTERM')
    await closed

    let alive = true
    const exitDeadline = Date.now() + 10_000
    while (alive && Date.now() < exitDeadline) {
      try {
        process.kill(pid!, 0)
        await new Promise(r => setTimeout(r, 100))
      } catch {
        alive = false
      }
    }
    expect(alive).toBe(false)
    // The CLI's own SIGTERM handler cleaned its user-data dir on the way out.
    const leaked = readdirSync(tmpdir()).filter(n => n.startsWith('obsrv-cli-') && !before.has(n))
    expect(leaked).toEqual([])
  } finally {
    child.kill('SIGKILL')
  }
})

test('diff: refuses dsf>1 presets with a clear 1x-only error', async () => {
  const r = await runCli(['diff', fixture('thin-text.html'), '--preset', 'iphone-61'])
  expect(r.code).not.toBe(0)
  expect(r.stdout).toBe('')
  expect(r.stderr).toMatch(/1x/)
  expect(r.stderr).toMatch(/iphone-61/)
})
