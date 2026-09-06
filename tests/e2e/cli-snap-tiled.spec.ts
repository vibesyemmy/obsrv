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

test('a 9,000 px page comes back whole in three bands, and the JSON says so', async () => {
  const out = join(outDir, 'tall.png')
  const r = await runCli(['snap', fixture('tall-audit.html'), '--preset', 'laptop-768', '--full-page', '--tiled', '--out', out])
  expect(r.code, r.stderr).toBe(0)
  const json = JSON.parse(r.stdout)
  expect(json).toMatchObject({ preset: 'laptop-768', tiled: true, bands: 3 })
  expect(json.warnings.join(' ')).not.toMatch(/clamped/)
  expect(r.stderr).toMatch(/captured in 3 band\(s\) of 4096 CSS px/)
  // The PNG is taller than one surface could be.
  const png = readFileSync(out)
  expect(png.readUInt32BE(16)).toBe(1366)
  expect(png.readUInt32BE(20)).toBeGreaterThan(4096)
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
