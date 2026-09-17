import { test, expect, type ElectronApplication } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONTROL_FILE_NAME, isDisabledStance, parseControlFile, type ControlInfo } from '../../src/shared/control'
import { launchApp, rendererWindow } from './launch'

/**
 * Three of `c5`'s unfired live-app sentences, seen to fire.
 *
 * They sit in the "live-app races" cluster and **none of the three is a race**
 * (`chore-live-app-race-sentences`): each needs a STATE — a page that keeps
 * painting, or the onion skin on — so each is an ordinary test rather than a
 * held window. That is why they come first: they move the count without any
 * new machinery.
 *
 * **The two capture paths word the same conditions differently.**
 * `captureTarget` photographs the window and crops; `captureRaster` takes the
 * target's own frame. A fixture for one proves nothing for the other, which is
 * the inventory's "two wordings" read as two paths.
 */

let app: ElectronApplication
let info: ControlInfo
const ANIMATED = pathToFileURL(resolve(__dirname, '../fixtures/animated.html')).href

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

const warningsOf = (reply: Record<string, unknown>): string[] => (reply.warnings as string[] | undefined) ?? []

test.describe.configure({ timeout: 180_000 })

test.beforeAll(async () => {
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
  await call('setOnionSkin', { onionSkin: 0 })
  await app.close()
})

test('a raster capture with the onion skin on says the skin is not in it', async () => {
  // `ipc.ts:1796`. The easiest sentence in the cluster: no race and no
  // animation — the raster is the target's own frame, so a skin blended in the
  // renderer cannot be in it, and the reply says so rather than letting a
  // caller compare a skinned screenshot with an unskinned raster.
  await call('navigate', { url: ANIMATED })
  const set = await call('setOnionSkin', { onionSkin: 0.5 })
  // The reply carries `error: null` rather than omitting it, and `applied`
  // is the field that says the skin actually took.
  expect(set.applied, `the skin was refused: ${JSON.stringify(set)}`).toBe(true)

  const r = await call('captureRaster')
  expect(warningsOf(r), JSON.stringify(warningsOf(r))).toContain(
    "the raster is the target's own frame; the onion skin is not blended into it",
  )
})

test('a raster capture of a page that keeps painting says it is one frame of it', async () => {
  // `ipc.ts:1790`, the raster path's wording for a page that never settles.
  await call('setOnionSkin', { onionSkin: 0 })
  await call('navigate', { url: ANIMATED })

  const r = await call('captureRaster')
  expect(
    warningsOf(r).some(w => w.includes('the page keeps painting')),
    `no painting note: ${JSON.stringify(warningsOf(r))}`,
  ).toBe(true)
})

test('a window capture of a painting page with the skin on says the ghosting is the animation', async () => {
  // `ipc.ts:1759`, and it needs BOTH: a page that keeps painting and the skin
  // on. The sentence exists so the ghosting in the PNG is not read as a raster
  // defect — two frames of a moving page, blended on purpose.
  await call('navigate', { url: ANIMATED })
  const set = await call('setOnionSkin', { onionSkin: 0.5 })
  // The reply carries `error: null` rather than omitting it, and `applied`
  // is the field that says the skin actually took.
  expect(set.applied, `the skin was refused: ${JSON.stringify(set)}`).toBe(true)

  const r = await call('captureTarget')
  const body = (r.body as Record<string, unknown> | undefined) ?? r
  const warnings = ((body.warnings as string[] | undefined) ?? []).concat(warningsOf(r))
  expect(
    warnings.some(w => w.includes('the onion skin is blending two frames')),
    `no blending note: ${JSON.stringify(warnings)}`,
  ).toBe(true)
})
