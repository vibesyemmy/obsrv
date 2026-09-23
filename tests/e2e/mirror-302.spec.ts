import { test, expect, type ElectronApplication } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONTROL_FILE_NAME, isDisabledStance, parseControlFile, type ControlInfo } from '../../src/shared/control'
import { launchApp, rendererWindow } from './launch'

/**
 * A **server** moving the bus's own mirrored load is still the bus, not the page
 * (`bug-redirect-note-missing-not-late`).
 *
 * `isMirrorCommit` treats a commit as the bus's when it reached the address the
 * bus asked for, **or** when it reached a different one with no document
 * initiator. That second arm is this file: the bus asks for `/from`, a 302 sends
 * Chromium to `/to`, and no page ran — so there is no initiator, and the address
 * is not the one requested.
 *
 * **Measured, and measured twice, because the first attempt lied.** Removing the
 * arm makes the target report the commit unmarked, and the reply then says *"the
 * page navigated after it loaded, to http://127.0.0.1:PORT/to"* about a pane
 * nobody asked to move — the shape `#431` shipped and `bug-arrivals` named.
 *
 * The first version of this control lived in `arrivals.spec.ts`, sharing that
 * file's app with two tests that drive several commits, and it **passed on the
 * sabotaged build** — it detected nothing, and I nearly recorded that as
 * evidence the case was unreachable. `arrivals.spec.ts`'s own header says why:
 * its tests perturb whoever runs next, and a control that needs a clean arrivals
 * record needs **its own file with its own app**, as `sync-mirror-mark.spec`
 * does. A control that cannot fail is worse than none, because it is read as a
 * pass.
 *
 * `file://` cannot express a server redirect, which is why this case went
 * untested long enough to be argued about: every other fixture on this path
 * redirects from inside the page, the one kind that carries an initiator.
 */
let app: ElectronApplication
let info: ControlInfo
let redirector: Server
let base: string
const HAIRLINE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href

const call = (command: string, payload?: Record<string, unknown>): Promise<Record<string, unknown>> =>
  new Promise((done, fail) => {
    const body: Record<string, unknown> = { command, token: info.token }
    if (payload) body.payload = payload
    const req = request(
      { host: '127.0.0.1', port: info.port, method: 'POST', path: '/', headers: { 'content-type': 'application/json' } },
      res => {
        let text = ''
        res.on('data', d => (text += String(d)))
        res.on('end', () => {
          try {
            done(JSON.parse(text) as Record<string, unknown>)
          } catch {
            done({ raw: text })
          }
        })
      },
    )
    req.on('error', fail)
    req.end(JSON.stringify(body))
  })

/** The note under test, from any measurement reply. */
const movedNote = async (): Promise<string | undefined> => {
  const r = await call('inspect', { selector: 'body' })
  return ((r.notes as string[] | undefined) ?? []).find(n => n.includes('navigated after it loaded'))
}

test.beforeAll(async () => {
  redirector = createServer((req, res) => {
    if (req.url === '/from') {
      res.statusCode = 302
      res.setHeader('Location', '/to')
      return res.end()
    }
    res.setHeader('Content-Type', 'text/html')
    res.end('<!doctype html><title>to</title><p>arrived')
  })
  await new Promise<void>(r => redirector.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(redirector.address() as AddressInfo).port}`
  app = await launchApp([], { OBSRV_AGENT_CONTROL: '1' })
  await rendererWindow(app)
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'))
  const controlFile = join(userData, CONTROL_FILE_NAME)
  await expect.poll(() => existsSync(controlFile)).toBe(true)
  const parsed = parseControlFile(readFileSync(controlFile, 'utf8'))
  if (!parsed || isDisabledStance(parsed)) throw new Error('agent control is off in this app')
  info = parsed
})
test.afterAll(async () => {
  await app?.close()
  redirector?.closeAllConnections?.()
  await new Promise<void>(r => redirector?.close(() => r()))
})

test('a server redirecting the bus own mirrored load is still the bus, not the page', async () => {
  await call('navigate', { url: HAIRLINE })
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__obsrv.target.webContents.getURL()), { timeout: 10_000 })
    .toBe(HAIRLINE)

  // Only the bus moves the target, through the call the sync bus itself makes.
  await app.evaluate(async (_e, url: string) => {
    await (globalThis as any).__obsrv.target.loadMirrored(url)
  }, `${base}/from`)
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__obsrv.target.webContents.getURL()), { timeout: 10_000 })
    .toBe(`${base}/to`)

  // The provenance first, because it is what the note is downstream of, and it
  // fails one step earlier with one fewer thing to explain.
  const commits = await app.evaluate(() => ((globalThis as any).__obsrv.target.commitTrace?.() ?? []).slice(-3))
  const landed = (commits as { url: string; mirroring?: boolean }[]).find(c => c.url === `${base}/to`)
  expect(landed, `no commit recorded for the redirected address: ${JSON.stringify(commits)}`).toBeDefined()
  expect(landed?.mirroring, `the bus asked for this load and a server moved it: ${JSON.stringify(landed)}`).toBe(true)

  const note = await movedNote()
  expect(note, `nobody asked this pane to move; a server redirected the bus's own load: ${note}`).toBeUndefined()
})
