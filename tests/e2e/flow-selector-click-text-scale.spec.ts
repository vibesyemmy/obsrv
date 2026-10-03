import { test, expect, type ElectronApplication } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runFlow } from '../../src/mcp/flowRunner'
import { CONTROL_FILE_NAME, isDisabledStance, parseControlFile, type ControlInfo } from '../../src/shared/control'
import { launchApp, rendererWindow } from './launch'

/**
 * `bug-selector-click-over-scrolls-under-text-scale`, on the real app.
 *
 * Under a text scale the page lays out `k` times smaller: `inspect`'s `rect` and the viewport are in
 * surface px, `scroll` takes page px. A selector click on an element below the fold used to aim the scroll
 * in the wrong unit and end past it (`"#below-cta" … after scrolling to 0,3040: its box reads 360x84 at
 * 30,-1236`, at scale 1.5, on `origin/main`). The fixture is `selector-click.html` as `feat-flow-selector-click`
 * left it: a fixed 120 px header, `#below-cta` 2216 px down.
 *
 * Desk-safe: the app is offscreen and nothing here shows or focuses a window.
 */
const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/selector-click.html')).href
const PHONE = 'iphone-61'

let app: ElectronApplication
let info: ControlInfo

function call(command: string, payload?: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((done, fail) => {
    const data = JSON.stringify({ command, token: info.token, ...(payload ? { payload } : {}) })
    const req = request(
      { host: '127.0.0.1', port: info.port, method: 'POST', path: '/', headers: { 'content-type': 'application/json' } },
      res => {
        let text = ''
        res.on('data', d => (text += String(d)))
        res.on('end', () => {
          const body = JSON.parse(text || '{}') as Record<string, unknown>
          // The runner's contract: a non-2xx is a rejection, which is how a step
          // records `failed`. Same shape `flowTool` builds in production.
          if ((res.statusCode ?? 0) >= 300) {
            fail(new Error(typeof body['error'] === 'string' ? body['error'] : `control ${command} answered ${res.statusCode}`))
            return
          }
          done(body)
        })
      },
    )
    req.on('error', fail)
    req.end(data)
  })
}

/** The fixture's own click log, read off the page rather than inferred from the
 *  reply: a `click` that answers `ok: true` and lands on nothing is exactly the
 *  failure this card is about, and only the page can say which happened. */
const clicksSoFar = (): Promise<string[]> =>
  app.evaluate(() => {
    const wc = (globalThis as { __obsrv?: { target: { webContents: { executeJavaScript: (c: string) => Promise<unknown> } } } }).__obsrv!.target.webContents
    return wc.executeJavaScript('(window.clicks || []).slice()') as Promise<string[]>
  })

const reset = (): Promise<unknown> =>
  app.evaluate(() => {
    const wc = (globalThis as { __obsrv?: { target: { webContents: { executeJavaScript: (c: string) => Promise<unknown> } } } }).__obsrv!.target.webContents
    return wc.executeJavaScript('window.clicks = []; window.scrollTo(0, 0); true')
  })

test.beforeAll(async () => {
  app = await launchApp([], { OBSRV_AGENT_CONTROL: '1' })
  await rendererWindow(app)
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'))
  const controlFile = join(userData, CONTROL_FILE_NAME)
  await expect.poll(() => existsSync(controlFile)).toBe(true)
  const parsed = parseControlFile(readFileSync(controlFile, 'utf8'))
  if (!parsed) throw new Error(`the control file at ${controlFile} did not parse`)
  if (isDisabledStance(parsed)) throw new Error(`the control file at ${controlFile} names no port: agent control is off`)
  info = parsed
  expect((await call('setPreset', { id: PHONE }))['applied']).toBe(true)
  await call('navigate', { url: FIXTURE })
})

test.afterAll(async () => {
  await app?.close()
})


/** Back to the top **through the app**, so the scroll it records (which `pageRect` adds to `rect`) agrees with the page. */
const toTop = async (): Promise<void> => {
  await call('scroll', { x: 0, y: 0 })
  await app.evaluate(() => {
    const wc = (globalThis as { __obsrv?: { target: { webContents: { executeJavaScript: (c: string) => Promise<unknown> } } } }).__obsrv!.target.webContents
    return wc.executeJavaScript('window.clicks = []; true')
  })
}

for (const scale of [1.5, 0.75, 1]) {
  test(`a block below the fold is reached and pressed at a text scale of ${scale}`, async () => {
    await toTop()
    expect((await call('setTextScale', { textScale: scale }))['applied']).toBe(true)
    try {
      const result = await runFlow({ steps: [{ action: 'click', target: '#below-cta' }] }, { call })
      expect(result.steps[0], JSON.stringify(result.steps[0]?.error)).toMatchObject({ status: 'ran' })
      const resolved = result.steps[0]!.resolved!
      expect(resolved.scrolledTo, 'an element 2216 px down was not scrolled to').toBeDefined()
      // The element landed a third of the way down the surface, clear of the 120 px fixed header — the placement
      // the scale-1 test asserts, and the number that was -1236 before the scale reached the scroll.
      expect(resolved.rect!.y, `landed at y=${resolved.rect!.y}`).toBeGreaterThan(120)
      expect(Math.abs(resolved.rect!.y - 852 / 3)).toBeLessThanOrEqual(scale + 1)
      await expect.poll(clicksSoFar, { timeout: 5_000 }).toEqual(['below'])
    } finally {
      expect((await call('setTextScale', { textScale: 1 }))['applied']).toBe(true)
      await toTop()
    }
  })
}

test('two selector clicks in one flow both land under a text scale of 1.5', async () => {
  await toTop()
  expect((await call('setTextScale', { textScale: 1.5 }))['applied']).toBe(true)
  try {
    const result = await runFlow({ steps: [{ action: 'click', target: '#top-cta' }, { action: 'click', target: '#below-cta' }] }, { call })
    expect(result.steps.map(s => s.status), JSON.stringify(result.steps.map(s => s.error))).toEqual(['ran', 'ran'])
    await expect.poll(clicksSoFar, { timeout: 5_000 }).toEqual(['top', 'below'])
  } finally {
    expect((await call('setTextScale', { textScale: 1 }))['applied']).toBe(true)
    await toTop()
  }
})
