import { test, expect, type ElectronApplication } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runFlow } from '../../src/mcp/flowRunner'
import { CONTROL_FILE_NAME, isDisabledStance, parseControlFile, type ControlInfo } from '../../src/shared/control'
import { launchApp, rendererWindow } from './launch'

/**
 * **The live clause of `feat-flow-selector-click`'s acceptance**, which the card
 * names as the one thing nobody had measured: *"the centre of an inspected rect
 * must be verified, against a live app, to be a coordinate `click` actually
 * accepts."*
 *
 * The runner is driven here exactly as `obsrv_flow` drives it — `runFlow` with a
 * `call` that posts to the control server of a real app — so `inspect`, `scroll`
 * and `click` are the real commands against a real page, and the two coordinate
 * spaces either agree or this fails.
 *
 * **Why an offscreen app is not a lesser measurement for this claim.** The card
 * filed the live clause behind a desk-safety boundary, and it is worth being
 * precise about what that boundary protects. The claim under test is about the
 * **target** surface: `parseClick` bounds-checks against
 * `tab().target.getViewport()`, and `InspectReadout.rect` is the element's border
 * box in CSS px of that same surface. The target is offscreen in every
 * configuration Obsrv runs, including a drive on a visible desktop — the visible
 * window is the *renderer*, which neither of these two facts is about. So this
 * measures the coordinate agreement on the surface that owns it, and what remains
 * unrun is a visible-desktop drive, which this claim does not depend on.
 *
 * Desk-safe: nothing here shows or focuses a window.
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

test('a flow clicks an element on screen by selector, and the page records the click', async () => {
  await reset()
  const result = await runFlow({ steps: [{ action: 'click', target: '#top-cta' }] }, { call })
  expect(result.steps[0], JSON.stringify(result.steps[0]?.error)).toMatchObject({ status: 'ran' })
  // **The measurement the card asked for.** The point came from `inspect`'s rect
  // and was accepted by `click`'s own bounds check — a disagreement between the
  // two spaces would have answered 400 and made this a rejection.
  expect(result.steps[0]!.resolved!.point).toBeDefined()
  // And it landed on the element, not merely inside the viewport.
  await expect.poll(clicksSoFar, { timeout: 5_000 }).toEqual(['top'])
})

test('a flow clicks an element below the fold, scrolling it into view first — and not into the fixed header', async () => {
  await reset()
  const result = await runFlow({ steps: [{ action: 'click', target: '#below-cta' }] }, { call })
  expect(result.steps[0], JSON.stringify(result.steps[0]?.error)).toMatchObject({ status: 'ran' })
  const resolved = result.steps[0]!.resolved!
  // The scroll happened, and the record says where it went.
  expect(resolved.scrolledTo, 'an element 2000px down was not scrolled to').toBeDefined()
  expect(resolved.scrolledTo!.y).toBeGreaterThan(0)

  // **The placement, measured rather than asserted from the constant.** The
  // element must land clear of the 120px fixed header, which is the whole reason
  // `SCROLL_PLACEMENT` is a third and not zero.
  expect(resolved.rect!.y, `the element landed at y=${resolved.rect!.y}, inside the 120px header`).toBeGreaterThan(120)

  // And the click reached the button. If the placement were flush with the top,
  // the fixed header would have taken it and this would read `['bar']` — a
  // failure the fixture makes visible instead of silent.
  await expect.poll(clicksSoFar, { timeout: 5_000 }).toEqual(['below'])
})

test('a selector matching nothing fails the step with a reason naming that, and presses nothing', async () => {
  await reset()
  const result = await runFlow({ steps: [{ action: 'click', target: '#no-such-thing' }] }, { call })
  expect(result.steps[0]).toMatchObject({ status: 'failed' })
  expect(result.steps[0]!.error).toContain('no element matches "#no-such-thing"')
  expect(await clicksSoFar()).toEqual([])
})

test('a hidden element fails with a reason naming its area and the rule hiding it', async () => {
  await reset()
  const result = await runFlow({ steps: [{ action: 'click', target: '#hidden-cta' }] }, { call })
  expect(result.steps[0]).toMatchObject({ status: 'failed' })
  // The pair the card asks for: which of the two it was, not "click failed".
  //
  // **This assertion failed on its first live run, and the product was wrong, not
  // the test.** The refusal read `no area (0x0 at 0,0)` and named no rule,
  // because the resolver was reading a `readout.hidden` field that does not
  // exist: `inspect` reports "not drawn" as a *sentence* in `notes`
  // (`inspectReadout.ts:148`). The fix carries the note, so the refusal now says
  // what the product already knew how to say.
  expect(result.steps[0]!.error).toContain('no area')
  expect(result.steps[0]!.error).toContain('display: none')
  expect(await clicksSoFar()).toEqual([])
})

test('a zero-height element fails as no-area, and is not confused with a hidden one', async () => {
  await reset()
  const result = await runFlow({ steps: [{ action: 'click', target: '#flat' }] }, { call })
  expect(result.steps[0]).toMatchObject({ status: 'failed' })
  expect(result.steps[0]!.error).toContain('no area')
  // It is `overflow: hidden` with a zero height, not `display: none` — the
  // refusal must not name a rule that is not there.
  expect(result.steps[0]!.error).not.toContain('hidden by')
  expect(await clicksSoFar()).toEqual([])
})

test('two selector clicks in one flow both land, over the same held session', async () => {
  await reset()
  const result = await runFlow({ steps: [{ action: 'click', target: '#top-cta' }, { action: 'click', target: '#below-cta' }] }, { call })
  expect(result.steps.map(s => s.status)).toEqual(['ran', 'ran'])
  // In order, and each on its own element: the second step's scroll must not
  // disturb the first step's result, and the log is the only thing that can say
  // so — a `ran` pair is satisfied by two clicks that both hit the header.
  await expect.poll(clicksSoFar, { timeout: 5_000 }).toEqual(['top', 'below'])
})
