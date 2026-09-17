import { test, expect, type ElectronApplication } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONTROL_FILE_NAME, isDisabledStance, parseControlFile, type ControlInfo } from '../../src/shared/control'
import { launchApp, rendererWindow } from './launch'

/**
 * `c5`'s unfired live-app sentences, seen to fire.
 *
 * They sit in the "live-app races" cluster (`chore-live-app-race-sentences`),
 * and **most of them are not races**. Each needs a STATE: a page that keeps
 * painting, the onion skin on, a throttle that turns the steady-painting exit
 * off, or a page holding its main thread. So each is an ordinary test rather
 * than a held window. The one that does need motion, a raster capture while
 * the pane keeps changing size, is gated like the other preset-cycling pair.
 *
 * **The two capture paths word the same conditions differently.**
 * `captureTarget` photographs the window and crops; `captureRaster` takes the
 * target's own frame. A fixture for one proves nothing for the other, which is
 * the inventory's "two wordings" read as two paths.
 */

let app: ElectronApplication
let info: ControlInfo
const ANIMATED = pathToFileURL(resolve(__dirname, '../fixtures/animated.html')).href
const BLOCKS = pathToFileURL(resolve(__dirname, '../fixtures/blocks-after-load.html')).href

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
  // The whole sentence, not a phrase of it: a phrase check stays green under a
  // rewording of the rest, and the rest is what the caller reads.
  expect(warningsOf(r), JSON.stringify(warningsOf(r))).toContain('the page keeps painting (animation or video); this is one frame of it')
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
  expect(warningsOf(r), JSON.stringify(warningsOf(r))).toContain(
    'the onion skin is blending two frames of a page that keeps painting: the ghosting is the animation, not the raster',
  )
})

test('a window capture of a page still painting when the budget runs out says so, and not that it paints steadily', async () => {
  // `ipc.ts:1755`. The settle loop leaves early for a page that paints
  // steadily, and names it that way. A throttle turns the early exit off,
  // because a page loading slowly paints steadily too (`quiesce`). So the same
  // animated page, throttled, runs the whole budget out and gets this wording.
  // `fast-4g` throttles only the network, and a file page makes no requests:
  // the only thing it changes here is which verdict the loop may reach.
  await call('setOnionSkin', { onionSkin: 0 })
  await call('navigate', { url: ANIMATED })

  // The lever, shown first: unthrottled, the same page gets the other wording.
  // Without this, a pane that stopped delivering frames would also run the
  // budget out, and the sentence below would fire for that reason instead.
  const steady = await call('captureTarget')
  expect(warningsOf(steady), JSON.stringify(warningsOf(steady))).toContain(
    'the page keeps painting steadily (animation or video); this is one frame of it, taken after two seconds rather than the full wait',
  )

  const set = await call('setThrottle', { throttle: 'fast-4g' })
  expect(set.applied, `the throttle was refused: ${JSON.stringify(set)}`).toBe(true)
  try {
    const r = await call('captureTarget')
    expect(r).toMatchObject({ settled: false, unsettledReason: 'timeout' })
    expect(warningsOf(r), JSON.stringify(warningsOf(r))).toContain(
      'the page was still painting when the capture budget ran out; the PNG may show a transitional frame — an animation, or a load that had not finished',
    )
    expect(warningsOf(r).join(' ')).not.toMatch(/keeps painting steadily/)
  } finally {
    await call('setThrottle', { throttle: 'none' })
  }
})

test('a raster capture while the pane is resized throughout says the page was still painting when the budget ran out (CI, or locally with OBSRV_E2E_FRONT=1)', async () => {
  // `ipc.ts:1793`, the raster path's wording for a capture the budget cut
  // short. A page cannot reach it alone. The raster loop leaves early for
  // steady painting, and it goes quiet otherwise. The only thing that restarts
  // its evidence is a frame of a new size, so the pane must keep changing size
  // for the whole 8 s budget. That is a preset cycle, the state
  // `live-drive.spec.ts` holds for the window capture.
  //
  // THE PAUSE IS THE LEVER, measured on CI. Cycled back to back, 13 captures
  // came back `timeout` 5 times and `uncovered` 8: the budget kept running out
  // between a resize and that size's first full frame. With a pause after each
  // apply, 12 of 12 came back `timeout` (probe 35217795705), because that gap
  // becomes a small part of each step, and each step stays well under the 2 s
  // after which a covered page painting steadily leaves as `animating`.
  //
  // `uncovered` is NOT asserted here. On that label this sentence is the wrong
  // one (part of the PNG is transparent, and it does not say so), and the
  // paused cycle does not reach it, so a pin of it would be dead code reading
  // as coverage (Wren's review of #292). It belongs to
  // `bug-live-raster-uncovered-said-as-painting`, with the back-to-back cycle as
  // its lever. A stray `uncovered` here is recorded and retried, within a bound,
  // and so is the rarer settled capture described in the loop.
  test.skip(
    !process.env['CI'] && !process.env['OBSRV_E2E_FRONT'],
    'cycles presets under a capture, the shape of a pair with recorded desk activations: runs on CI, or locally with OBSRV_E2E_FRONT=1',
  )
  test.setTimeout(120_000)
  const CYCLE = ['laptop-768', 'laptop-800-11', 'laptop-900-17', 'sxga-19', '1440x900-19', 'android-65', 'ipad-109', '1080p-24']
  const STEP_PAUSE_MS = 700
  const MAX_TRIES = 3
  await call('setOnionSkin', { onionSkin: 0 })
  await call('navigate', { url: ANIMATED })
  const before = (await call('status')).presetId as string

  const tries: string[] = []
  let shot: Record<string, unknown> | undefined
  try {
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      let cycling = true
      let applied = 0
      const spin = (async () => {
        for (let i = 0; cycling; i++) {
          const r = await call('setPreset', { id: CYCLE[i % CYCLE.length]! })
          if (r.ok === true) applied++
          await new Promise(r => setTimeout(r, STEP_PAUSE_MS))
        }
      })()
      // Let the cycle get going, so the capture starts mid-resize rather than
      // racing the first apply.
      await new Promise(r => setTimeout(r, 400))
      const started = Date.now()
      const reply = await call('captureRaster')
      const finished = Date.now()
      cycling = false
      await spin

      const margin = `try ${attempt}: settled=${String(reply.settled)} label=${String(reply.unsettledReason)} applied=${applied} capture=${finished - started}ms size=${String(reply.width)}x${String(reply.height)} warnings=${JSON.stringify(warningsOf(reply))}`
      tries.push(margin)
      console.log(`raster under a preset cycle: ${margin}`)
      // The state first: a stalled cycle would leave nothing below measuring
      // what its name says.
      expect(applied, margin).toBeGreaterThanOrEqual(5)
      if (reply.unsettledReason === 'timeout') {
        shot = reply
        break
      }
      // Two strays are recorded and retried, each a defect with its own card:
      // `uncovered` (`bug-live-raster-uncovered-said-as-painting`), and a
      // capture that came back SETTLED, with no warning, while the preset was
      // changing under it (`bug-live-raster-settled-while-resizing`, once in 28
      // paused captures: control run 35218471058). Anything else on a pane that
      // never stopped changing size (`animating`, `blank`) is a finding, not a
      // tolerance to widen.
      const stray = reply.unsettledReason === 'uncovered' || reply.settled === true
      expect(stray, margin).toBe(true)
    }
  } finally {
    await call('setPreset', { id: before })
  }
  test.info().annotations.push({ type: 'raster verdicts', description: tries.join(' | ') })
  expect(shot, `no capture reached its budget covered in ${MAX_TRIES} tries: ${tries.join(' | ')}`).toBeDefined()
  expect(shot!.settled, tries.join(' | ')).toBe(false)
  expect(warningsOf(shot!), tries.join(' | ')).toContain(
    'the page was still painting when the capture budget ran out; the PNG may show a transitional frame',
  )
})

test('a scroll the page cannot answer, because it holds its main thread, says the offset could not be confirmed', async () => {
  // `controlServer.ts:531`. The target's preload answers a scroll from the
  // page's own main thread. `blocks-after-load.html` holds that thread for 40 s
  // after it loads, the way a bot challenge does. The answer cannot arrive
  // inside the 1 s budget (`SCROLL_REPLY_TIMEOUT_MS`), so the reply says the
  // offset is unconfirmed instead of inventing one.
  //
  // LAST in the file: the page still holds its thread when this test ends, and
  // no test after it should have to wait that out.
  //
  // The lever, shown first: on a page whose thread is free, the same scroll is
  // answered with an offset. Without this, a scroll lost for any other reason
  // (the preload not listening, say) would fire the sentence too.
  await call('navigate', { url: ANIMATED })
  const free = await call('scroll', { x: 0, y: 200 })
  expect(free.scrolled, JSON.stringify(free)).not.toBeNull()

  // `navigate` answers `loading: true` for a page that has not loaded. Its
  // absence says `load` fired, and the page's hold starts on the task after it.
  const nav = await call('navigate', { url: BLOCKS })
  expect(nav, JSON.stringify(nav)).not.toHaveProperty('loading')
  const asked = Date.now()
  const r = await call('scroll', { x: 0, y: 200 })
  console.log(`scroll on a held main thread answered after ${Date.now() - asked} ms: ${JSON.stringify(r)}`)
  expect(r).toMatchObject({ ok: true, scrolled: null })
  expect(r.warnings).toEqual(['scroll offset could not be confirmed'])
})
