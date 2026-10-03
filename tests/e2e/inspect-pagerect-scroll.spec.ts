import { test, expect, type ElectronApplication } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONTROL_FILE_NAME, isDisabledStance, parseControlFile, type ControlInfo } from '../../src/shared/control'
import { launchApp, rendererWindow } from './launch'

/**
 * `bug-recorded-scroll-lags-a-page-scroll`, on the real app.
 *
 * `inspect`'s `pageRect` was `rect` plus the app's RECORD of the target's scroll. The record is fed by reports the
 * preload defers for up to 120 ms after any scroll the app itself applied (the echo window), so a scroll the page
 * made inside that window was invisible to `pageRect`: after `scroll` then `window.scrollTo(0, 0)`, the next
 * `inspect` answered with the app's earlier position (400 of 400 reads, measured). A selector click aims from
 * `pageRect - rect`, so it over-scrolled and refused (`flow-selector-click.spec.ts:270`, `main`, first attempt).
 *
 * `pageRect` is now built from the scroll the page reports in the same call as the box. These tests are the sequence
 * that failed: scroll through the app, scroll at the page level, and read at once, with no wait.
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



const evalPage = (code: string): Promise<unknown> =>
  app.evaluate(({}, c: string) => (globalThis as any).__obsrv.target.webContents.executeJavaScript(c), code)

/** `pageRect - rect`: the scroll `inspect` says the page is at. */
const reportedScroll = async (selector: string): Promise<number> => {
  const ro = ((await call('inspect', { selector })) as { readout: { rect: { y: number }; pageRect: { y: number } } }).readout
  return Math.round((ro.pageRect.y - ro.rect.y) * 10) / 10
}

const ROUNDS = 60

for (const scale of [1, 1.5]) {
  test(`pageRect follows a page-level scroll made right after an agent scroll, ${ROUNDS} times, at a text scale of ${scale}`, async () => {
    test.setTimeout(120_000)
    await call('scroll', { x: 0, y: 0 })
    expect((await call('setTextScale', { textScale: scale }))['applied']).toBe(true)
    const stale: string[] = []
    try {
      for (let i = 0; i < ROUNDS; i++) {
        await call('scroll', { x: 0, y: 1200 + (i % 7) * 100 }) // the app scrolls: opens the preload's 120 ms window
        // The premise, checked every round so this cannot pass vacuously: the page really was scrolled away from 0
        // before the page-level reset, so a record left at the app's position is far from the truth.
        const moved = (await evalPage('window.scrollY')) as number
        if (moved < 500) stale.push(`round ${i}: the agent scroll left the page at ${moved}, so the test did not set up the case`)
        await evalPage('window.scrollTo(0, 0); true') // the page scrolls inside it
        const actual = (await evalPage('window.scrollY')) as number
        const reported = await reportedScroll('#wrapped-link')
        if (Math.abs(reported - actual) > 0.5) stale.push(`round ${i}: page at ${actual}, pageRect - rect says ${reported}`)
      }
    } finally {
      await call('setTextScale', { textScale: 1 })
      await call('scroll', { x: 0, y: 0 })
    }
    expect(stale, `${stale.length} of ${ROUNDS} reads disagreed with the page. ${stale.slice(0, 3).join(' | ')}`).toEqual([])
  })
}
