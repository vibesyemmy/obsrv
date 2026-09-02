import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { launchApp, rendererWindow } from './launch'

/**
 * The native pane and the target are two Chromium documents of the same
 * page. If they did not share a session, a login made in one would not hold
 * in the other, and nothing behind authentication could be tested at all —
 * which outranks every feature the app has. Neither pane names a partition,
 * so both sit on the default session; this pins that, with a real cookie
 * over a real origin (`file:` and `data:` cannot carry one).
 */

let app: ElectronApplication
let page: Page
let server: Server
let url: string

test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader('Set-Cookie', 'obsrv=shared; Path=/')
    res.setHeader('Content-Type', 'text/html')
    res.end('<!doctype html><title>cookie</title><p>cookie page</p>')
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  app = await launchApp()
  page = await rendererWindow(app)
})
test.afterAll(async () => {
  await app.close()
  await new Promise<void>(r => server.close(() => r()))
})

test('the native pane and the target share one session', async () => {
  expect(
    await app.evaluate(() => {
      const ctx = (globalThis as any).__obsrv
      return ctx.native.webContents.session === ctx.target.webContents.session
    }),
  ).toBe(true)
})

test('a cookie set through one pane is the other pane\'s too', async () => {
  await page.fill('.url-form input', url)
  await page.press('.url-form input', 'Enter')
  const cookies = (): Promise<{ native: string; target: string }> =>
    app.evaluate(async () => {
      const ctx = (globalThis as any).__obsrv
      const read = (wc: any): Promise<string> =>
        wc.getURL().startsWith('http') ? wc.executeJavaScript('document.cookie') : Promise.resolve('')
      return { native: await read(ctx.native.webContents), target: await read(ctx.target.webContents) }
    })
  await expect.poll(cookies, { timeout: 10_000 }).toEqual({ native: 'obsrv=shared', target: 'obsrv=shared' })
})
