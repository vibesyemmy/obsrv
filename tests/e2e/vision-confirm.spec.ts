import { test, expect, type ElectronApplication } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { join } from 'node:path'
import { CONTROL_FILE_NAME, isDisabledStance, parseControlFile, type ControlInfo } from '../../src/shared/control'
import { launchApp, rendererWindow } from './launch'

/**
 * `setVision` answers whether it applied, like every other apply on this surface.
 *
 * **The defect this is bought by (`bug-vision-47-normal-not-red`, class 1).**
 * `setVision` was `apply(...)` followed immediately by `{ ok: true }` — fire and
 * answer, with no wait and **no `applied` field at all**. So a caller who asked
 * for `normal` got `ok: true` whether or not the deficiency shader had gone, and
 * the card's `[255,255,0]` case is exactly that: the control reads Normal while
 * the render is still filtered, and nothing in the reply says so. A silence
 * fitting "it applied" and "it did not" equally is class 1 by
 * `docs/release-gate.md`.
 *
 * The bug's only tell lived in a **test's print in a CI log**, which the gate
 * names as not a disclosure: *"An artifact is not a reply … The disclosure has to
 * arrive on the surface the answer is read from."* `applied` is that surface.
 *
 * **Its own file rather than a test inside `vision.spec.ts`**, for two reasons:
 * that spec launches without agent control and adding it would change every test
 * in it, and that spec is where the flake this card tracks actually fires — a
 * regression guard should not share a worker with the thing it guards against.
 */
let app: ElectronApplication
let info: ControlInfo

interface Reply {
  status: number
  body: Record<string, unknown>
}

function call(command: string, payload?: Record<string, unknown>): Promise<Reply> {
  return new Promise((done, fail) => {
    const data = JSON.stringify({ command, token: info.token, ...(payload ? { payload } : {}) })
    const req = request(
      { host: '127.0.0.1', port: info.port, method: 'POST', path: '/', headers: { 'content-type': 'application/json' } },
      res => {
        let text = ''
        res.on('data', d => (text += String(d)))
        res.on('end', () => done({ status: res.statusCode ?? 0, body: JSON.parse(text || '{}') as Record<string, unknown> }))
      },
    )
    req.on('error', fail)
    req.end(data)
  })
}

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
})

test.afterAll(async () => {
  await app?.close()
})

test('setVision says whether it applied, and names the mode the app actually holds', async () => {
  const on = await call('setVision', { type: 'deutan', severity: 1 })
  expect(on.status).toBe(200)
  // `applied` is the whole point: before the fix the reply had **no such field**,
  // so this reads `undefined` on the old build rather than merely disagreeing.
  expect(on.body, 'setVision did not say whether it applied').toMatchObject({
    ok: true,
    applied: true,
    visionType: 'deutan',
    visionSeverity: 1,
  })

  // And back. `none` is the direction the card is about: a caller asking for it
  // and being told `ok` while the shader is still on is the class-1 silence.
  const off = await call('setVision', { type: 'none' })
  expect(off.status).toBe(200)
  expect(off.body, 'returning to no filter did not say whether it applied').toMatchObject({
    ok: true,
    applied: true,
    visionType: 'none',
  })
})

test('a severity a caller omits is reported back as the strong form, not left for them to assume', async () => {
  const r = await call('setVision', { type: 'protan' })
  expect(r.status).toBe(200)
  // The server's own comment says an omitted severity means "the strong form".
  // That is a decision the caller cannot see unless the reply states it, and the
  // reply now does — the same class of gap as `applied`, one field over.
  expect(r.body).toMatchObject({ ok: true, applied: true, visionType: 'protan', visionSeverity: 1 })
})
