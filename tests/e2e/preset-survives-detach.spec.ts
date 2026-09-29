import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONTROL_FILE_NAME, isDisabledStance, parseControlFile, type ControlInfo } from '../../src/shared/control'
import { launchApp, rendererWindow } from './launch'

/**
 * **The measurement `feat-flow-report`'s last clause is gated on.**
 *
 * A per-step network record for `obsrv_flow` needs a `webContents.debugger`
 * session held for the flow's duration. `src/main/targetSource.ts:188` says, of
 * exactly that kind of session, that **"detaching it wipes Electron's own
 * emulation with it"** — and a flow runs under a preset, where device emulation
 * *is* the preset. So before building a record that attaches and detaches, the
 * question is whether a preset survives that cycle. `#490` recorded it as a
 * condition rather than a deferral, deliberately, so that nobody shipped the
 * record on a reading of that comment.
 *
 * **This measures the cycle that already happens.** `targetSource.ts:905` is
 * `if (off) dbg.detach()` — lifting a throttle detaches today, on every install,
 * whenever anyone turns one off. So this needs no new code to observe: set a
 * phone preset, apply a throttle, lift it, and read the target back.
 *
 * Which makes the outcome useful either way. **If the preset survives**, a
 * network record can hold a session and ship plainly. **If it does not**, this is
 * a live defect in the throttle path as well as the answer for the flow record —
 * a user who throttles and un-throttles silently loses the screen they were
 * reviewing at.
 *
 * **What it does not prove**, stated because "measured" should not imply more
 * than was run: this exercises the *throttle* attach/detach, not a flow's
 * hypothetical one. Same API on the same window, so the answer transfers — but
 * it is a transfer, and the card says so.
 *
 * Desk-safe: nothing here shows or focuses a window, and the target is
 * offscreen. It sets a preset through the control server and reads the target's
 * own geometry, exactly as `tab-switch-preset.spec.ts` does.
 */
const PHONE = { id: 'iphone-61', width: 393, height: 852 }

/**
 * A fixture with **no** `<meta name="viewport">`, and that absence is
 * load-bearing rather than incidental.
 *
 * `innerWidth` is the one field that detects a wiped emulation (see `inPage`),
 * and it does so because a meta-less page under `screenPosition: 'mobile'` gets
 * Chromium's 980 px default layout viewport, dropping to the window's real width
 * when emulation goes. On a page carrying `width=device-width` it would read 393
 * **both** before and after, and this test would detect nothing while still
 * passing. The first version inherited whatever page the app happened to open;
 * this one owns the precondition, and the premise below asserts the detector is
 * live before relying on it.
 */
const NO_META = pathToFileURL(resolve(__dirname, '../fixtures/button.html')).href
const MOBILE_DEFAULT_WIDTH = 980
const THROTTLE = '3g'
// The payload key is `throttle`, not `id` — `setPreset` takes `id` and the two sit
// two lines apart in this file. `{ id: '3g' }` answers 400, which is the control
// server refusing an unnamed throttle rather than anything about emulation.

let app: ElectronApplication
let page: Page
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

/**
 * What the **page** reports, not what main intends.
 *
 * The first version of this read `target.getViewport()` and
 * `target.getDeviceScaleFactor()` — main's own bookkeeping, which returns the
 * preset it means to be applying whether or not emulation is still in force. It
 * said the preset survived and it could not have said anything else. So this
 * reads what the page is told instead — and **the field that detects a wipe is
 * not the one the reasoning pointed at.**
 *
 * Measured by sabotage (`disableDeviceEmulation()` right after the detach):
 * `devicePixelRatio` stays 3 and `screen.width` stays 393 **even then**, because
 * both come from the offscreen window's own size and density rather than from
 * CDP. The one that moves is **`innerWidth`, 980 -> 393**: with
 * `screenPosition: 'mobile'` in force the page gets the mobile 980 px default
 * layout viewport, and losing emulation drops it to the window's real width.
 *
 * `innerWidth` was in this readout as a *control* — included to separate "the
 * window resized" from "the emulation was lost" — and it turned out to be the
 * only one of the three that can tell. Had this test carried only the two fields
 * the reasoning pointed at, **it would have passed on a build whose detach wiped
 * emulation.** All three stay, and so does this note, because the next person
 * will reason the way I did.
 */
const inPage = (): Promise<{ dpr: number; screenW: number; innerW: number }> =>
  app.evaluate(() => {
    const wc = (globalThis as { __obsrv?: { target: { webContents: { executeJavaScript: (c: string) => Promise<unknown> } } } }).__obsrv!.target.webContents
    return wc.executeJavaScript(
      '({ dpr: window.devicePixelRatio, screenW: window.screen.width, innerW: window.innerWidth })',
    ) as Promise<{ dpr: number; screenW: number; innerW: number }>
  })

/** Main's intent, kept only to prove the preset was asked for at all. */
const intended = (): Promise<{ width: number; height: number; dsf: number }> =>
  app.evaluate(() => {
    const t = (globalThis as { __obsrv?: { target: { getViewport: () => { width: number; height: number }; getDeviceScaleFactor: () => number } } }).__obsrv!.target
    const vp = t.getViewport()
    return { width: vp.width, height: vp.height, dsf: t.getDeviceScaleFactor() }
  })

test.beforeAll(async () => {
  app = await launchApp([], { OBSRV_AGENT_CONTROL: '1' })
  page = await rendererWindow(app)
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

test('a preset survives a throttle being applied and lifted — the debugger detach does not wipe it', async () => {
  expect((await call('navigate', { url: NO_META })).status).toBe(200)
  expect((await call('setPreset', { id: PHONE.id })).body.applied).toBe(true)
  const asked = await intended()
  const before = await inPage()
  // The preset is the premise. If this fails the rest of the test proves
  // nothing, so it asserts rather than assumes — a 1920-wide "phone" would make
  // every later comparison trivially equal.
  expect(asked, 'the phone preset did not take, so there is no emulation to lose').toMatchObject({
    width: PHONE.width,
    height: PHONE.height,
  })
  // And the page was actually told about it. A `dpr` of 1 here would mean the
  // emulation never applied, which would make every comparison below vacuous —
  // the shape of guard this repo keeps learning it needs.
  expect(before.dpr, 'the page was never told the preset density, so nothing below could detect losing it').toBeGreaterThan(1)
  // **The detector's own floor.** `innerWidth` is the only field that moves when
  // emulation is lost, and it moves only on a page without a viewport meta. If
  // it already reads the window's real width, mobile emulation is not in force
  // for layout and the comparison below would pass on a wiped build. Fail here
  // instead, loudly, naming why — a guard that cannot refuse is not a guard.
  expect(before.innerW, `the layout viewport is not the mobile default, so a lost emulation would be undetectable`).toBe(MOBILE_DEFAULT_WIDTH)

  expect((await call('setThrottle', { throttle: THROTTLE })).status).toBe(200)
  const throttled = await inPage()

  // Lifting it is the detach: `targetSource.ts:905`, `if (off) dbg.detach()`.
  expect((await call('setThrottle', { throttle: 'none' })).status).toBe(200)
  const after = await inPage()

  const show = (g: { dpr: number; screenW: number; innerW: number }): string => `dpr=${g.dpr} screen=${g.screenW} inner=${g.innerW}`
  console.log(
    `[preset-survives-detach] asked=${asked.width}x${asked.height}@${asked.dsf} | ` +
      `before: ${show(before)} | throttled: ${show(throttled)} | afterDetach: ${show(after)}`,
  )

  // Applying a throttle attaches; that alone must not move anything either.
  expect(throttled, 'attaching the debugger changed the target geometry').toEqual(before)
  expect(after, 'detaching the debugger wiped the preset — targetSource.ts:188 warned of exactly this').toEqual(before)
})
