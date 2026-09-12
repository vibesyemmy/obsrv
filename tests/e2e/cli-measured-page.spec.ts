import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The answer names the page it measured. Run 13 drove a dev server and found
 * two ways the answer described a page other than the one the figures came
 * from: a page that reloaded while the measurement waited was measured but
 * reported under the address that was asked for, with no note at all; and a
 * route the server answered 404 was measured as though it were the page.
 *
 * `url` still means the address that was asked for — every caller reads it,
 * and obsrv_report and anything scripted would break if it started meaning
 * something else. Where the figures came from is said in a warning instead.
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

let server: Server
let origin: string
test.beforeAll(async () => {
  const html = readFileSync(resolve(__dirname, '../fixtures/hmr-reload.html'), 'utf8')
  server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    if (path === '/hmr') {
      res.setHeader('Content-Type', 'text/html')
      res.end(html)
      return
    }
    res.writeHead(404, 'Not Found', { 'Content-Type': 'text/html' })
    res.end('<!doctype html><html lang="en"><body><h1>Cannot GET</h1><p>no such route</p></body></html>')
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(async () => {
  await new Promise<void>(r => server.close(() => r()))
})

test('a page that reloads while the measurement waits is named as the page the figures came from', async () => {
  // Two reloads 1.2 s apart under a 3 s wait: the audit measures revision 2,
  // which its 11 targets prove (5n + 1), and the answer must say so.
  const r = await runCli(['audit', `${origin}/hmr`, '--preset', '1080p-24', '--wait', '3000', '--timeout', '20000'])
  expect(r.code, r.stderr).toBe(0)
  const out = JSON.parse(r.stdout)
  expect(out.summary.targets.count).toBe(11)
  expect(out.url).toBe(`${origin}/hmr`)
  const warnings: string[] = out.warnings
  const named = warnings.find(w => w.includes('navigated'))
  expect(named, `warnings were ${JSON.stringify(warnings)}`).toBeTruthy()
  expect(named).toContain('?n=2')
})

test('a route the server answered with an error status says the figures are of the error page', async () => {
  const r = await runCli(['audit', `${origin}/missing`, '--preset', '1080p-24', '--timeout', '20000'])
  expect(r.code, r.stderr).toBe(0)
  const out = JSON.parse(r.stdout)
  const warnings: string[] = out.warnings
  const said = warnings.find(w => w.includes('the server answered 404'))
  expect(said, `warnings were ${JSON.stringify(warnings)}`).toBeTruthy()
  expect(said).toContain('the figures are of the error page it sent')
  // The error page is still measured, and its heading is still text.
  expect(out.summary.text.count).toBeGreaterThan(0)
})

test('the lint says the same two things, since it measures the same page', async () => {
  const reloaded = await runCli(['lint', `${origin}/hmr`, '--preset', '1080p-24', '--wait', '3000', '--timeout', '20000'])
  expect(reloaded.code, reloaded.stderr).toBe(0)
  const arrived: string[] = JSON.parse(reloaded.stdout).warnings
  expect(arrived.find(w => w.includes('navigated')), `warnings were ${JSON.stringify(arrived)}`).toContain('?n=2')

  const missing = await runCli(['lint', `${origin}/missing`, '--preset', '1080p-24', '--timeout', '20000'])
  expect(missing.code, missing.stderr).toBe(0)
  const status: string[] = JSON.parse(missing.stdout).warnings
  expect(status.find(w => w.includes('the server answered 404')), `warnings were ${JSON.stringify(status)}`).toBeTruthy()
})

test('an inspect of an element on an error page, or on a page that moved, says which page it read', async () => {
  const missing = await runCli(['inspect', `${origin}/missing`, '--preset', '1080p-24', '--selector', 'h1', '--timeout', '20000'])
  expect(missing.code, missing.stderr).toBe(0)
  const onError = JSON.parse(missing.stdout)
  // The element is found — it is the error page's heading, which is the point.
  expect(onError.found).toBe(true)
  expect(onError.notes.find((n: string) => n.includes('the server answered 404')), `notes were ${JSON.stringify(onError.notes)}`).toBeTruthy()

  const reloaded = await runCli(['inspect', `${origin}/hmr`, '--preset', '1080p-24', '--selector', 'h1', '--wait', '3000', '--timeout', '20000'])
  expect(reloaded.code, reloaded.stderr).toBe(0)
  const moved = JSON.parse(reloaded.stdout)
  expect(moved.notes.find((n: string) => n.includes('navigated')), `notes were ${JSON.stringify(moved.notes)}`).toContain('?n=2')
})
