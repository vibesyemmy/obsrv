import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * An animating page never goes paint-quiet. Until 0.28 every headless render
 * of one waited the whole budget (30 s by default) to say so — a report's
 * six renders, three minutes, every diff noise. Now a frame that is covered
 * and keeps painting steadily is captured after ~2 s and the JSON says why.
 */

const BIN = resolve(__dirname, '../../bin/obsrv.js')
const ANIMATED = pathToFileURL(resolve(__dirname, '../fixtures/animated.html')).href

function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string; ms: number }> {
  return new Promise(done => {
    const t0 = Date.now()
    const child = spawn(process.execPath, [BIN, ...args], { cwd: resolve(__dirname, '../..') })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => (stdout += d))
    child.stderr.on('data', d => (stderr += d))
    child.on('close', code => done({ code, stdout, stderr, ms: Date.now() - t0 }))
  })
}

let outDir: string
test.beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'obsrv-animating-'))
})
test.afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
})

test('a snap of an animating page returns in seconds, unsettled, and names the reason', async () => {
  const r = await runCli(['snap', ANIMATED, '--preset', 'laptop-768', '--out', join(outDir, 'a.png')])
  expect(r.code, r.stderr).toBe(0)
  const meta = JSON.parse(r.stdout)
  expect(meta.settled).toBe(false)
  expect(meta.unsettledReason).toBe('animating')
  expect(meta.warnings.join(' ')).toMatch(/painting steadily/)
  // Well under the 30 s budget: the page, the app's start and the encode.
  expect(r.ms).toBeLessThan(12_000)
})

test('under a throttle the early exit is off: settledMs is the measurement, and the budget is honoured', async () => {
  const r = await runCli(['snap', ANIMATED, '--preset', 'laptop-768', '--throttle', 'none', '--timeout', '4000', '--out', join(outDir, 'b.png')])
  expect(r.code, r.stderr).toBe(0)
  const meta = JSON.parse(r.stdout)
  expect(meta.settled).toBe(false)
  expect(meta.unsettledReason).toBe('timeout')
  expect(meta.settledMs).toBeNull()
})

test('a settled snap carries no reason: the flagless object is unchanged', async () => {
  const r = await runCli(['snap', pathToFileURL(resolve(__dirname, '../fixtures/fill.html')).href, '--preset', 'laptop-768', '--out', join(outDir, 'c.png')])
  expect(r.code, r.stderr).toBe(0)
  const meta = JSON.parse(r.stdout)
  expect(meta.settled).toBe(true)
  expect(meta).not.toHaveProperty('unsettledReason')
})

const ANIMATED_TALL = pathToFileURL(resolve(__dirname, '../fixtures/animated-tall.html')).href

test('a full-page capture of a tall animating page warns once, not once per band', async () => {
  const r = await runCli(['snap', ANIMATED_TALL, '--preset', 'laptop-768', '--full-page', '--out', join(outDir, 'tall.png')])
  expect(r.code, r.stderr).toBe(0)
  const meta = JSON.parse(r.stdout)
  expect(meta.bands).toBeGreaterThan(1)
  const painting = (meta.warnings as string[]).filter(w => /painting steadily/.test(w))
  expect(painting).toHaveLength(1)
  expect(new Set(meta.warnings).size).toBe(meta.warnings.length)
})

/**
 * A page that keeps painting and a page whose boxes move are different
 * things, and only the second makes a measurement unrepeatable. `snap` knew
 * about the first and said so; `audit` and `lint` knew about neither until
 * B5 measured stripe.com's finding boxes moving 438 CSS px between runs with
 * `warnings: []` on every one (docs/research/2026-09-14-b5-repeatability.md).
 */
const MOVES = pathToFileURL(resolve(__dirname, '../fixtures/moves-while-measured.html')).href
const STILL = pathToFileURL(resolve(__dirname, '../fixtures/audit.html')).href

test('an audit of a page whose elements move says so, with its own numbers', async () => {
  const r = await runCli(['audit', MOVES, '--preset', 'laptop-768'])
  expect(r.code, r.stderr).toBe(0)
  const meta = JSON.parse(r.stdout)
  const note = meta.warnings.find((w: string) => /still moving/.test(w))
  expect(note, `warnings were ${JSON.stringify(meta.warnings)}`).toBeTruthy()
  // The sentence carries what it measured, not an adjective: how many of how
  // many, how far, and over what interval.
  expect(note).toMatch(/\d+ of the \d+ elements re-measured had moved, by up to \d+ CSS px/)
  expect(note).toMatch(/in the \d+ ms after the figures were taken/)
  expect(note).toMatch(/a repeat run will not agree on them/)
  // The elements held still are in the denominator and not in the numerator:
  // a note claiming everything moved would be as useless as no note.
  const [, moved, compared] = /(\d+) of the (\d+) elements/.exec(note as string) as RegExpExecArray
  expect(Number(moved)).toBeGreaterThan(0)
  expect(Number(moved)).toBeLessThan(Number(compared))
})

test('a lint of the same page says it too, since both measure boxes', async () => {
  const r = await runCli(['lint', MOVES, '--preset', 'laptop-768'])
  expect(r.code, r.stderr).toBe(0)
  const meta = JSON.parse(r.stdout)
  expect(meta.warnings.join(' ')).toMatch(/still moving/)
})

test('a still page is not warned about, so the note keeps its meaning', async () => {
  // The cost of crying wolf is the whole value of the sentence: a page that
  // holds still has repeatable figures and earns no warning at all.
  for (const cmd of ['audit', 'lint']) {
    const r = await runCli([cmd, STILL, '--preset', 'laptop-768'])
    expect(r.code, r.stderr).toBe(0)
    expect(JSON.parse(r.stdout).warnings.join(' ')).not.toMatch(/still moving/)
  }
})

test('an animating page that moves nothing measurable is not warned about either', async () => {
  // animated.html spins a box: it never goes paint-quiet, so `snap` calls it
  // unsettled — but a transform on an element with no text and no targets in
  // it moves nothing an audit reports, and the audit is repeatable.
  const r = await runCli(['audit', ANIMATED, '--preset', 'laptop-768'])
  expect(r.code, r.stderr).toBe(0)
  expect(JSON.parse(r.stdout).warnings.join(' ')).not.toMatch(/still moving/)
})
