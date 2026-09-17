import { test, expect, type ElectronApplication } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONTROL_FILE_NAME, isDisabledStance, parseControlFile, type ControlInfo } from '../../src/shared/control'
import { decodePng } from './helpers/decodePng'
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
/** A page that paints once and stops: the still case the resize gate must not hold up. */
const STILL = pathToFileURL(resolve(__dirname, '../fixtures/thin-text.html')).href

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

/**
 * The fully transparent pixels in a capture reply's PNG, and their bounding
 * box: what a never-painted region is, read from the image rather than from
 * the sentence about it. Decoded without Electron (`decodePng`), so a channel
 * swap in the encoder cannot hide.
 */
const transparencyOf = (reply: Record<string, unknown>): { width: number; height: number; transparent: number; box: string } => {
  const png = decodePng(Buffer.from(reply.data as string, 'base64'))
  let transparent = 0
  let x0 = png.width
  let y0 = png.height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (png.data[(y * png.width + x) * 4 + 3] !== 0) continue
      transparent++
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  const box = transparent === 0 ? 'none' : `${x1 - x0 + 1}x${y1 - y0 + 1} at ${x0},${y0}`
  return { width: png.width, height: png.height, transparent, box }
}

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

test('a raster capture of a page that has stopped still settles, at the size the pane is on', async () => {
  // The guard on `awaitExpectedSize` (`bug-live-raster-settled-while-resizing`).
  // The fix makes the capture refuse to settle until the frame is the size the
  // target says it is heading for — so if `expectedFrameSize()` ever disagreed
  // with the frames for an ordinary capture (a fractional density floors the
  // paint and ceils the bitmap, which is exactly where a size comparison goes
  // wrong), every live raster would run to its budget and come back `resizing`.
  // Nothing else in this file would notice: its other pages never settle on
  // purpose. This one is the still page.
  await call('navigate', { url: STILL })
  const status = await call('status')
  const r = await call('captureRaster')
  const margin = `${JSON.stringify({ settled: r.settled, reason: r.unsettledReason, size: `${String(r.width)}x${String(r.height)}` })} on ${String(status.presetId)}`
  expect(r.settled, margin).toBe(true)
  expect(r.unsettledReason, margin).toBeUndefined()
  expect(warningsOf(r).join(' '), margin).not.toContain('still resizing')
  // And the pixels are of that size, not of whatever the pane was on before.
  const png = decodePng(Buffer.from(r.data as string, 'base64'))
  expect([png.width, png.height], margin).toEqual([r.width, r.height])
})

test('and still settles at a fractional density, where the two ways of computing the size disagree', async () => {
  // The case the guard above is really about. `pixel-8` is 412 x 915 at
  // 2.625: the products are 1081.5 and 2401.875, Chromium paints the floor
  // (1081 x 2401) and Electron's bitmap is the round. `expectedFrameSize()`
  // takes the floor, so if it ever took the round instead, every capture on
  // this preset would run to its budget and answer `resizing` — and every
  // whole-number preset would stay green while it did.
  //
  // **A fractional `deviceScaleFactor` is not the hazard; a fractional PRODUCT
  // is.** Wren reached for `laptop-1080-150` on a cold read of this fix, which
  // is the obvious direction and proves nothing: 1280 x 1.5 is 1920 x 1080, and
  // so are `laptop-1080-125` and `4k-27-150` — whole, every one. Counted over
  // the table, 26 presets carry exactly one fractional product, and it is this
  // preset. Do not swap it for a different "fractional density" one.
  //
  // `presetId`, not `preset.id`: `status` has no `preset` object, and reading
  // one silently restored a preset nobody was on (the loops below open on
  // whatever the app started with, and would have inherited it).
  const before = (await call('status')).presetId as string
  try {
    await call('setPreset', { id: 'pixel-8' })
    await call('navigate', { url: STILL })
    const r = await call('captureRaster')
    const margin = JSON.stringify({ settled: r.settled, reason: r.unsettledReason, size: `${String(r.width)}x${String(r.height)}`, warnings: warningsOf(r) })
    expect(r.settled, margin).toBe(true)
    // The documented floor, not the round: 1082 x 2402 here would mean the
    // comment on `pixel-8` and `paintedExtent` disagree with the surface.
    expect([r.width, r.height], margin).toEqual([1081, 2401])
  } finally {
    await call('setPreset', { id: before })
  }
})

test('a raster capture with the onion skin on says the skin is not in it', async () => {
  // `ipc.ts:1823`. The easiest sentence in the cluster: no race and no
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
  // `ipc.ts:1801`, the raster path's wording for a page that never settles.
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
  // `ipc.ts:1814`, the raster path's wording for a capture the budget cut
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
      // `uncovered` is recorded and retried; it is a defect with its own card
      // (`bug-live-raster-uncovered-said-as-painting`).
      //
      // `settled: true` is allowed here and is NOT a stray. With a 700 ms step
      // pause and a 400 ms settle window, a pane that reaches the newest
      // preset's size and goes quiet has genuinely settled. It used to be the
      // sighting for `bug-live-raster-settled-while-resizing`, and that card
      // turned out to be about settling at the size the pane had LEFT — which
      // this loop cannot tell apart from the good case without racing the
      // cycle it is measuring, and which `cliCapture.test.ts` now pins by
      // construction instead.
      //
      // Anything else on a pane that never stopped changing size (`animating`,
      // `blank`) is a finding, not a tolerance to widen.
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

test('a raster capture whose budget runs out before a resized frame is painted says those pixels are transparent (CI, or locally with OBSRV_E2E_FRONT=1)', async () => {
  // `bug-live-raster-uncovered-said-as-painting`. `uncovered` means the budget
  // ran out before every pixel of the frame had painted once since its last
  // size change. Those pixels are transparent BGRA, and an agent reading the
  // PNG can take them for a black or empty band of the page. The reply said
  // "still painting" there, which is about motion. It now carries the
  // capture's own sentence, the one the CLI prints.
  //
  // The WORDING is owned by `tests/unit/rasterWarnings.test.ts`, which goes
  // through the real `captureQuiescent` and needs no race. This test only has
  // to show the wiring fires once, on a real frame, and names that PNG.
  //
  // THE LEVER IS A RACE, AND THE BOUND WAS CHOSEN, NOT ASSUMED. No
  // deterministic lever was found: one preset change during the capture, with
  // a small or a large spinner, came back `animating` 16 of 16 times (probe
  // 35229835046), because a single resize gets fully painted within two
  // seconds. Back to back, the budget sometimes lands between a resize and that
  // size's first full frame. Measured rates for `uncovered`:
  //   - this cycle (dsf-1 presets only), on this code: 4 of 8 (35229152084),
  //     then 2 of 7 in this test's control run (35230323442);
  //   - all eight presets, same run: 3 of 8, and one `settled: true`;
  //   - all eight presets on earlier heads: 1 of 6, 3 of 3, 4 of 4.
  // dsf-1 only, because an apply that changes deviceScaleFactor takes ~150 ms
  // against ~30 ms, and the budget tends to run out covered in that dwell.
  // Chance that 8 tries all miss: 0.4% at 4 of 8, 6.8% at 2 of 7, 23% at the
  // worst head's 1 of 6, before the suite's one retry. A red run here that
  // says "no capture came back uncovered" is that miss. Read the tries it
  // prints before calling it a product failure.
  test.skip(
    !process.env['CI'] && !process.env['OBSRV_E2E_FRONT'],
    'cycles presets under a capture, the shape of a pair with recorded desk activations: runs on CI, or locally with OBSRV_E2E_FRONT=1',
  )
  test.setTimeout(180_000)
  const CYCLE = ['laptop-768', 'laptop-800-11', 'laptop-900-17', 'sxga-19', '1440x900-19', '1080p-24']
  const MAX_TRIES = 8
  const PAINTING = 'the page was still painting when the capture budget ran out; the PNG may show a transitional frame'
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
        }
      })()
      await new Promise(r => setTimeout(r, 400))
      const started = Date.now()
      const reply = await call('captureRaster')
      const finished = Date.now()
      cycling = false
      await spin

      const png = transparencyOf(reply)
      const margin = `try ${attempt}: settled=${String(reply.settled)} label=${String(reply.unsettledReason)} applied=${applied} capture=${finished - started}ms size=${String(reply.width)}x${String(reply.height)} png=${png.width}x${png.height} transparent=${png.transparent} (${png.box}) warnings=${JSON.stringify(warningsOf(reply))}`
      tries.push(margin)
      console.log(`raster under a back-to-back preset cycle: ${margin}`)
      // The state first: a stalled cycle would leave nothing below measuring
      // what its name says.
      expect(
        applied,
        `the preset cycle stalled (applied is the number of presets applied during the capture; a low one is a slow or loaded runner, not the product): ${margin}`,
      ).toBeGreaterThan(20)
      expect([png.width, png.height], margin).toEqual([reply.width, reply.height])
      if (reply.unsettledReason === 'uncovered') {
        shot = reply
        break
      }
      // The race's other side is `timeout`, the test above's sentence. A
      // settled capture is the pane having caught up between two applies, not
      // the defect `bug-live-raster-settled-while-resizing` named: that one was
      // settling at the size the pane had left, and it is pinned in
      // `cliCapture.test.ts`.
      //
      // `resizing` is allowed here too, and it is NOT a tolerance widened to
      // get a PR green. The enum gained the value after this loop was written
      // (`#314`): on a pane cycled back to back, a capture whose frame never
      // reached the size last asked for is genuinely still resizing, and that
      // is the most accurate of the unsettled answers it can give. Without it
      // this test fails for the product being right — measured, run
      // `35246279571`, attempt 1: `label=resizing`, covered, 0 transparent,
      // red at this line; the retry reached `uncovered` and passed. The
      // distinction worth keeping (Wren): widening a tolerance because the
      // enum grew is the opposite of silencing a finding, and the assertion
      // below that catches a real one is untouched.
      //
      // Anything else on a pane that never stopped changing size is a finding.
      expect(reply.unsettledReason === 'timeout' || reply.unsettledReason === 'resizing' || reply.settled === true, margin).toBe(true)
      // THE BASELINE for the count below, and a cross-check of the coverage
      // mask against the bytes. `timeout`, `resizing` and `settled` are only
      // reached with `covered` true (`captureQuiescent` branches on it at the
      // deadline — `resizing` at `capture.ts:404`), so
      // the mask says every pixel painted since the last resize, and this page
      // paints opaque white. A counter blind to alpha, or a PNG that dropped
      // it, fails here rather than agreeing with a sentence.
      expect(
        png.transparent,
        `NOT A FLAKY BASELINE: this capture's coverage mask said every pixel was painted, and its PNG has transparent ones, so the mask and the bytes disagree, and every uncovered percentage is computed from that mask (the one legitimate cause, a page painting its own alpha, does not apply to animated.html): ${margin}`,
      ).toBe(0)
    }
  } finally {
    await call('setPreset', { id: before })
  }
  test.info().annotations.push({ type: 'raster verdicts', description: tries.join(' | ') })
  expect(shot, `no capture came back uncovered in ${MAX_TRIES} tries: ${tries.join(' | ')}`).toBeDefined()
  const margin = tries.join(' | ')
  expect(shot!.settled, margin).toBe(false)
  const warnings = warningsOf(shot!)
  // The sentence names its own frame: this PNG's size, not one the cycle
  // passed through on the way.
  const own = new RegExp(`^\\d+\\.\\d% of the ${String(shot!.width)}x${String(shot!.height)} frame never painted within \\d+ ms`)
  expect(warnings.filter(w => own.test(w)), margin).toHaveLength(1)
  const sentence = warnings.find(w => own.test(w))!
  expect(sentence, margin).toContain('those pixels are transparent, not page content')
  expect(warnings, margin).not.toContain(PAINTING)

  // And the sentence is TRUE of this PNG, read from the image: the share it
  // states is the share of fully transparent pixels, within its one-decimal
  // rounding, and the region it names is their exact bounding box. The
  // defect this card fixes was a real sentence about the wrong thing, so a
  // sentence proved to fire but not to be true would leave the same gap.
  // Soft, so a red run shows both.
  const stated = /^(\d+\.\d)% of the \d+x\d+ frame never painted within \d+ ms \(uncovered region (\d+x\d+ at \d+,\d+)\)/.exec(sentence)
  expect(stated, `the sentence does not state a share and a region: ${sentence}`).not.toBeNull()
  const png = transparencyOf(shot!)
  const measured = (png.transparent / (png.width * png.height)) * 100
  expect.soft(Math.abs(measured - Number(stated![1])), `stated ${stated![1]}%, the PNG is ${measured.toFixed(3)}% transparent: ${margin}`).toBeLessThanOrEqual(0.051)
  expect.soft(png.box, `stated region ${stated![2]}, transparent pixels span ${png.box}: ${margin}`).toBe(stated![2])
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
