import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * `obsrv inspect`: the app's inspector for a script. The contrast fixture
 * the app's own inspect spec uses, read by selector and by point, on a
 * laptop and through a budget panel; nothing found is a `found: false`,
 * not a failure; the flags are one-of.
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

test('by selector on the laptop: element, font in mm, colours, contrast as stated and on the reference panel', async () => {
  const r = await runCli(['inspect', fixture('contrast.html'), '--preset', 'laptop-768', '--selector', '#grey'])
  expect(r.code, r.stderr).toBe(0)
  const m = JSON.parse(r.stdout)
  expect(m).toMatchObject({ preset: 'laptop-768', cssWidth: 1366, cssHeight: 768, profile: 'reference', found: true })
  expect(m.readout).toMatchObject({
    element: 'p#grey',
    tag: 'p',
    id: 'grey',
    text: 'Grey caption text on white',
    color: '#6b7280',
    background: '#ffffff',
    backgroundNote: 'computed',
    ppi: 100,
  })
  expect(m.readout.font.px).toBe(13)
  expect(m.readout.font.mm).toBeCloseTo(3.29, 1)
  expect(m.readout.contrast).toMatchObject({ largeText: false, aaThreshold: 4.5, passesAsIs: true, panel: 'reference' })
  expect(m.readout.contrast.asIs).toBeCloseTo(4.84, 1)
  expect(r.stderr).toMatch(/inspect .* p#grey · 13px = 3\.\d+ mm · #6b7280 on #ffffff · 4\.8\d?:1 here/)
})

test('by point, and through a budget panel: the second contrast figure drops', async () => {
  const r = await runCli(['inspect', fixture('contrast.html'), '--preset', 'laptop-768', '--at', '20,17', '--profile', 'budget-tn'])
  expect(r.code, r.stderr).toBe(0)
  const m = JSON.parse(r.stdout)
  expect(m.found).toBe(true)
  expect(m.readout.id).toBe('grey')
  expect(m.profile).toBe('budget-tn')
  expect(m.readout.contrast.panel).toBe('budget-tn')
  expect(m.readout.contrast.onPanel).toBeLessThan(m.readout.contrast.asIs)
})

test('text over an image has no contrast figure; nothing matched is found: false, exit 0', async () => {
  const photo = await runCli(['inspect', fixture('contrast.html'), '--preset', 'laptop-768', '--selector', '#photo-text'])
  expect(photo.code, photo.stderr).toBe(0)
  const p = JSON.parse(photo.stdout)
  expect(p.found).toBe(true)
  expect(p.readout.backgroundNote).toBe('image')
  expect(p.readout.background).toBeNull()
  expect(p.readout.contrast).toBeNull()

  const none = await runCli(['inspect', fixture('contrast.html'), '--preset', 'laptop-768', '--selector', '#no-such-thing'])
  expect(none.code, none.stderr).toBe(0)
  expect(JSON.parse(none.stdout)).toMatchObject({ found: false, readout: null })
  expect(none.stderr).toContain('nothing at selector "#no-such-thing"')
})

test('exactly one of --at / --selector, and --at is x,y', async () => {
  const neither = await runCli(['inspect', fixture('contrast.html')])
  expect(neither.code).toBe(2)
  expect(neither.stderr).toMatch(/exactly one of --at <x,y> or --selector <css>/)
  const both = await runCli(['inspect', fixture('contrast.html'), '--at', '1,1', '--selector', 'p'])
  expect(both.code).toBe(2)
  const bad = await runCli(['inspect', fixture('contrast.html'), '--at', 'twenty'])
  expect(bad.code).toBe(2)
  expect(bad.stderr).toMatch(/--at: expected x,y/)
  const help = await runCli(['--help'])
  expect(help.stdout).toContain('obsrv inspect <url>')
})
