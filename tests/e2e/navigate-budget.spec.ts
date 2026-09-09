import { test, expect, type ElectronApplication } from '@playwright/test'
import { createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONTROL_FILE_NAME, parseControlFile, type ControlInfo } from '../../src/shared/control'
import { launchApp } from './launch'

/**
 * An agent's `navigate` (and `openTab` with a URL) waits for both panes to
 * finish loading, and a page that keeps loading ads never does: theguardian.com
 * in a new tab took the MCP's 40 s guard to a hard error blaming the app,
 * while the tab was open and the page there a moment later. The app now
 * answers within its own budget with the page as it stands — the URL and
 * `loading: true` — and the MCP turns that into a warning. The budget is 30 s
 * in production and overridable for this test, which serves a page whose
 * script never arrives.
 */

let app: ElectronApplication
let info: ControlInfo
let server: Server
let base: string

const HANGING = '<!doctype html><title>hanging</title><p>the page is here</p><script src="/never.js"></script>'

test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/never.js') return // never answered: the load never finishes
    res.setHeader('Content-Type', 'text/html')
    res.end(HANGING)
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  app = await launchApp([], { OBSRV_AGENT_CONTROL: '1', OBSRV_NAVIGATE_WAIT_MS: '1500' })
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'))
  const parsed = parseControlFile(readFileSync(join(userData, CONTROL_FILE_NAME), 'utf8'))
  if (!parsed || !('port' in parsed)) throw new Error('control file not readable')
  info = parsed as ControlInfo
})
test.afterAll(async () => {
  await app?.close()
  server?.closeAllConnections?.()
  await new Promise<void>(r => server.close(() => r()))
})

function call(command: string, payload?: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((done, fail) => {
    const data = JSON.stringify({ command, token: info.token, ...(payload ? { payload } : {}) })
    const req = request({ host: '127.0.0.1', port: info.port, method: 'POST', path: '/', headers: { 'content-type': 'application/json' } }, res => {
      let text = ''
      res.on('data', d => (text += String(d)))
      res.on('end', () => done({ status: res.statusCode ?? 0, body: JSON.parse(text) as Record<string, unknown> }))
    })
    req.on('error', fail)
    req.end(data)
  })
}

test('a navigate to a page that never finishes loading answers within the budget, as it stands', async () => {
  const started = Date.now()
  const r = await call('navigate', { url: `${base}/` })
  const ms = Date.now() - started
  expect(r.status).toBe(200)
  expect(r.body).toMatchObject({ ok: true, url: `${base}/`, loading: true })
  // The budget, plus the round trip — not the caller's 40 s guard.
  expect(ms).toBeLessThan(8000)
  const s = await call('status')
  expect(s.body).toMatchObject({ url: `${base}/`, loading: true })
})

test('a new tab with such a URL answers the same way', async () => {
  const r = await call('openTab', { url: `${base}/` })
  expect(r.status).toBe(200)
  expect(r.body).toMatchObject({ ok: true, loading: true })
  expect(typeof r.body.id).toBe('string')
})
