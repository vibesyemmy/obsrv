import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * `--throttle`: the page under DevTools' network and CPU presets, and the
 * time to paint-quiet in the JSON. A page with a 250 KB script is
 * measured unthrottled and over 3G — at 400 Kbps the script alone is
 * five seconds — and a page that spins the CPU before it paints is
 * measured plain and at 6×. Timing margins are wide: the assertions are
 * about the order of magnitude a throttle adds, not the milliseconds.
 */

const BIN = resolve(__dirname, '../../bin/obsrv.js')

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

// 250 KB of comment: nothing to run, plenty to transfer.
const BIG_JS = `/* ${'x'.repeat(250 * 1024)} */\ndocument.title = 'loaded'\n`
const HEAVY = '<!doctype html><title>heavy</title><p>heavy</p><script src="/big.js"></script>'
// A fixed amount of work, not a fixed wall time: a throttled thread takes
// longer over the same loop, which is the whole point. ~400 ms on an M-series, so 6× adds a couple of seconds.
const WORK = 'let x=0;for(let i=0;i<120000000;i++){x=(x+i)%7}'
const SPIN = `<!doctype html><title>spin</title><p>spinning</p><script>addEventListener("load",()=>{${WORK};document.body.textContent="spun "+x})</script>`
const SPIN_HEAD = `<!doctype html><title>spin-head</title><script>${WORK}</script><p>spun</p>`

let server: Server
let base: string
let outDir: string

test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/big.js') {
      res.setHeader('Content-Type', 'text/javascript')
      res.end(BIG_JS)
      return
    }
    res.setHeader('Content-Type', 'text/html')
    res.end(req.url === '/spin' ? SPIN : req.url === '/spin-head' ? SPIN_HEAD : HEAVY)
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  outDir = mkdtempSync(join(tmpdir(), 'obsrv-throttle-spec-'))
})
test.afterAll(async () => {
  await new Promise<void>(r => server.close(() => r()))
  rmSync(outDir, { recursive: true, force: true })
})

test.describe.configure({ timeout: 120_000 })

test('without the flag the JSON is unchanged; --throttle none is a baseline with settledMs', async () => {
  const plain = await runCli(['snap', `${base}/`, '--preset', 'laptop-768', '--out', join(outDir, 'plain.png')])
  expect(plain.code, plain.stderr).toBe(0)
  const p = JSON.parse(plain.stdout)
  expect(p.throttle).toBeUndefined()
  expect(p.settledMs).toBeUndefined()

  const none = await runCli(['snap', `${base}/`, '--preset', 'laptop-768', '--throttle', 'none', '--out', join(outDir, 'none.png')])
  expect(none.code, none.stderr).toBe(0)
  const n = JSON.parse(none.stdout)
  expect(n.throttle).toBe('none')
  expect(typeof n.settledMs).toBe('number')
  expect(n.settledMs).toBeLessThan(3000)
  expect(none.stderr).toMatch(/throttle none, settled in \d+ ms/)
})

test('over 3G a 250 KB script takes seconds: settledMs says so', async () => {
  const r = await runCli(['snap', `${base}/`, '--preset', 'laptop-768', '--throttle', '3g', '--out', join(outDir, '3g.png')])
  expect(r.code, r.stderr).toBe(0)
  const m = JSON.parse(r.stdout)
  expect(m.throttle).toBe('3g')
  // 250 KB at 51 200 B/s is 5 s before latency; anything under 3.5 s would
  // mean the conditions were not applied.
  expect(m.settledMs).toBeGreaterThan(3500)
  expect(m.settled).toBe(true)
})

test('at CPU 6× a page that works before painting settles seconds later than the same page plain', async () => {
  const plain = await runCli(['snap', `${base}/spin`, '--preset', 'laptop-768', '--throttle', 'none', '--out', join(outDir, 'spin.png')])
  const slow = await runCli(['snap', `${base}/spin`, '--preset', 'laptop-768', '--throttle', 'cpu-6x', '--out', join(outDir, 'spin6.png')])
  expect(plain.code, plain.stderr).toBe(0)
  expect(slow.code, slow.stderr).toBe(0)
  const a = JSON.parse(plain.stdout).settledMs as number
  const b = JSON.parse(slow.stdout).settledMs as number
  // ~400 ms of work becomes ~2.4 s at 6×: at least a second more than plain.
  expect(b - a).toBeGreaterThan(1000)

  // The same work in the document head — the first script the page runs,
  // before Chromium has restored anything to a fresh renderer — is
  // throttled too: the rate is re-issued as the navigation commits.
  const headPlain = await runCli(['snap', `${base}/spin-head`, '--preset', 'laptop-768', '--throttle', 'none', '--out', join(outDir, 'h.png')])
  const headSlow = await runCli(['snap', `${base}/spin-head`, '--preset', 'laptop-768', '--throttle', 'cpu-6x', '--out', join(outDir, 'h6.png')])
  expect(headPlain.code, headPlain.stderr).toBe(0)
  expect(headSlow.code, headSlow.stderr).toBe(0)
  expect((JSON.parse(headSlow.stdout).settledMs as number) - (JSON.parse(headPlain.stdout).settledMs as number)).toBeGreaterThan(1000)
})

test('audit and report carry the throttle; an unknown id is a usage error naming the presets', async () => {
  const audit = await runCli(['audit', `${base}/`, '--preset', 'laptop-768', '--throttle', 'fast-4g'])
  expect(audit.code, audit.stderr).toBe(0)
  expect(JSON.parse(audit.stdout).throttle).toBe('fast-4g')

  const report = await runCli(['report', `${base}/`, '--preset', 'android-65', '--throttle', 'mid-phone', '--out', join(outDir, 'r.html')])
  expect(report.code, report.stderr).toBe(0)
  const summary = JSON.parse(report.stdout)
  expect(summary.throttle).toBe('mid-phone')
  expect(typeof summary.screens[0].settledMs).toBe('number')

  const bad = await runCli(['snap', `${base}/`, '--throttle', 'edge'])
  expect(bad.code).toBe(2)
  expect(bad.stderr).toMatch(/--throttle: expected one of none, fast-4g, slow-4g, 3g/)
})
