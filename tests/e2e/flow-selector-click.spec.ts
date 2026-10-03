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

/**
 * **The defect the first real drive of 0.63.0 found** (`bug-selector-click-presses-the-gap`), as the
 * e2e it should have had.
 *
 * A link whose text wraps has a border box that is the union of its line boxes **plus the leading
 * between them**, and that gap paints as the block around it. Pressing the box's centre therefore
 * reached an `<h3>` on a real page, the step reported `ran`, and the flow described a journey it never
 * made. The fixture's every other clickable is a **block** element, whose border box is its painted
 * area — a shape that cannot exhibit this, which is why eighteen green runs said nothing.
 *
 * `#wrap-host` logs its own hits, so a press landing in the gap is visible rather than silent — the
 * same trick as the fixed header two tests up.
 */
test('a click by selector presses a point the element paints, not the gap between its lines', async () => {
  await reset()
  const result = await runFlow({ steps: [{ action: 'click', target: '#wrapped-link' }] }, { call })
  expect(result.steps[0], JSON.stringify(result.steps[0]?.error)).toMatchObject({ status: 'ran' })

  // **The premise, asserted rather than assumed.** If the link did not wrap on this
  // screen there is no gap, and the assertion below would pass on the broken build
  // too — the shape this whole card is about.
  //
  // The floor is measured, not derived: a one-line inline box here is ~16.5 px
  // (font metrics, not `line-height`), and the wrapped union measures **47.5 px**
  // — the two line boxes plus the leading between them. My first version used
  // `2.2 × fontSize × 1.6` on the assumption that the union is two line-heights
  // tall, and it is not: `line-height` spaces the lines, while the union runs from
  // the first line box's top to the last one's bottom. 21 px cannot be one line
  // and is comfortably under two.
  const box = result.steps[0]!.resolved!.rect!
  expect(box.height, `the link did not wrap (${box.width}x${box.height}), so this test could not detect the defect`).toBeGreaterThan(21)

  // And the click reached the link, not the paragraph around it.
  //
  // **The paragraph logs too, and that is correct** — the event bubbles from the
  // link to its parent, so a hit reads `['wrapped', 'host']` in that order. My
  // first assertion demanded `['wrapped']` alone and failed on a working build,
  // which is the test being wrong about the DOM rather than the product being
  // wrong. What separates hit from miss is the **first** entry: a press landing in
  // the inter-line gap reaches only the paragraph and reads `['host']`.
  await expect.poll(clicksSoFar, { timeout: 5_000 }).toContain('wrapped')
  const log = await clicksSoFar()
  expect(log[0], `the paragraph received the click before the link: ${JSON.stringify(log)}`).toBe('wrapped')
})

/**
 * `feat-inspect-line-rects`, measured against a real page rather than a stub.
 *
 * The app now reports the element's own boxes (`readout.lineRects`), and the click aims at the largest
 * visible one. The claim that earns the field is that **the guessing disappears**: a wrapped link used
 * to cost several probes (the union's centre sits in the leading between its lines, so the first guess
 * missed and the heuristic walked on), and now costs one. A control arm removes the field from the
 * reply, which is what an app older than it sends, and shows the walk coming back — so the saving is
 * the field's, not the fixture's.
 */
type Probe = { x: number; y: number }

/** `call`, with every `inspect` at a point (the hit check) recorded, and optionally the line boxes removed from the reply. */
function instrumented(opts: { olderApp?: boolean } = {}): {
  call: (command: string, payload?: Record<string, unknown>) => Promise<Record<string, unknown>>
  probes: Probe[]
  answers: string[]
} {
  const probes: Probe[] = []
  const answers: string[] = []
  return {
    probes,
    answers,
    call: async (command, payload) => {
      const isProbe = command === 'inspect' && payload?.['x'] !== undefined
      if (isProbe) probes.push({ x: payload['x'] as number, y: payload['y'] as number })
      const reply = await call(command, payload)
      if (isProbe) answers.push(String((reply['readout'] as { element?: unknown } | null)?.['element'] ?? 'nothing'))
      if (opts.olderApp === true && command === 'inspect' && typeof reply['readout'] === 'object' && reply['readout'] !== null) {
        delete (reply['readout'] as Record<string, unknown>)['lineRects']
      }
      return reply
    },
  }
}

test('the live inspect reply carries the line boxes: one for a block, one per line for a wrapped link', async () => {
  const block = await call('inspect', { selector: '#top-cta' })
  const blockRects = (block['readout'] as { lineRects: Array<Record<string, number>>; rect: Record<string, number> }).lineRects
  expect(blockRects).toHaveLength(1)
  expect(blockRects[0]).toEqual((block['readout'] as { rect: Record<string, number> }).rect)

  const link = (await call('inspect', { selector: '#wrapped-link' }))['readout'] as { lineRects: Array<{ y: number; height: number }>; rect: { height: number } }
  expect(link.lineRects.length, 'the link did not wrap on this screen').toBeGreaterThanOrEqual(2)
  const [a, b] = link.lineRects as [{ y: number; height: number }, { y: number; height: number }]
  expect(b.y - (a.y + a.height), 'no leading between the lines, so the union has no gap to miss').toBeGreaterThan(1)
  expect(link.rect.height).toBeGreaterThan(a.height + b.height)
})

test('a wrapped link costs one hit check, and without the field the old walk comes back', async () => {
  await reset()
  const withField = instrumented()
  const first = await runFlow({ steps: [{ action: 'click', target: '#wrapped-link' }] }, { call: withField.call })
  expect(first.steps[0], JSON.stringify(first.steps[0]?.error)).toMatchObject({ status: 'ran' })
  expect(withField.probes, JSON.stringify(withField.probes)).toHaveLength(1)
  await expect.poll(clicksSoFar, { timeout: 5_000 }).toContain('wrapped')
  expect((await clicksSoFar())[0], 'the press reached the paragraph, not the link').toBe('wrapped')

  await reset()
  const older = instrumented({ olderApp: true })
  const second = await runFlow({ steps: [{ action: 'click', target: '#wrapped-link' }] }, { call: older.call })
  expect(second.steps[0], JSON.stringify(second.steps[0]?.error)).toMatchObject({ status: 'ran' })
  // The control: the union's centre is in the gap, so the first guess misses and the heuristic walks on.
  expect(older.probes.length, JSON.stringify(older.probes)).toBeGreaterThan(1)
  console.log(`[flow-selector-click] wrapped link hit checks: with lineRects=${withField.probes.length}, without (an older app)=${older.probes.length}`)
  await expect.poll(clicksSoFar, { timeout: 5_000 }).toContain('wrapped')
  expect((await clicksSoFar())[0]).toBe('wrapped')
})

test('a link that wraps past two lines lands on the link, with one hit check', async () => {
  await reset()
  const probes = instrumented()
  const result = await runFlow({ steps: [{ action: 'click', target: '#wrapped-link-3' }] }, { call: probes.call })
  expect(result.steps[0], JSON.stringify(result.steps[0]?.error)).toMatchObject({ status: 'ran' })
  // The premise, asserted rather than assumed: this fixture really wraps past two lines on this screen.
  const lines = ((await call('inspect', { selector: '#wrapped-link-3' }))['readout'] as { lineRects: unknown[] }).lineRects
  expect(lines.length, 'the link did not wrap past two lines, so this test could not tell the cases apart').toBeGreaterThanOrEqual(3)
  expect(probes.probes, JSON.stringify(probes.probes)).toHaveLength(1)
  await expect.poll(clicksSoFar, { timeout: 5_000 }).toContain('wrapped3')
  expect((await clicksSoFar())[0], 'the press reached the paragraph, not the link').toBe('wrapped3')
})

test('a block element still costs one hit check, as it did before the field', async () => {
  await reset()
  const probes = instrumented()
  const result = await runFlow({ steps: [{ action: 'click', target: '#top-cta' }] }, { call: probes.call })
  expect(result.steps[0], JSON.stringify(result.steps[0]?.error)).toMatchObject({ status: 'ran' })
  expect(probes.probes).toHaveLength(1)
  await expect.poll(clicksSoFar, { timeout: 5_000 }).toEqual(['top'])
})

/**
 * **The regression a reviewer found in the first version of this change** (Idris's gate on `#543`): with
 * the element's boxes reported, the click probed only the centre of each box — one point for a block. A
 * button with a label over its centre resolves there to the `<span>`, not the button, so the step refused
 * what the five fixed fractions had always pressed. The fixture's other buttons are plain text, which is
 * why every earlier run was green. These two have a child on top of their own centre.
 */
for (const [id, log] of [
  ['#span-btn', 'spanbtn'],
  ['#icon-btn', 'iconbtn'],
] as const) {
  test(`${id}, with a child painted over its centre, is pressed with the line boxes reported and without them`, async () => {
    await reset()
    const withField = instrumented()
    const first = await runFlow({ steps: [{ action: 'click', target: id }] }, { call: withField.call })
    expect(first.steps[0], JSON.stringify(first.steps[0]?.error)).toMatchObject({ status: 'ran' })
    // The premise, read off the page: the first probe — the centre — resolved to the child and missed.
    expect(withField.answers[0], `the centre answered ${withField.answers[0]}, so this fixture does not cover the case`).not.toBe('button')
    expect(withField.probes.length).toBeGreaterThan(1)
    await expect.poll(clicksSoFar, { timeout: 5_000 }).toContain(log)

    await reset()
    const older = instrumented({ olderApp: true })
    const second = await runFlow({ steps: [{ action: 'click', target: id }] }, { call: older.call })
    expect(second.steps[0], JSON.stringify(second.steps[0]?.error)).toMatchObject({ status: 'ran' })
    // Parity with an app that reports no boxes: the same press, because the fixed points follow the boxes.
    expect(first.steps[0]!.resolved!.point).toEqual(second.steps[0]!.resolved!.point)
    await expect.poll(clicksSoFar, { timeout: 5_000 }).toContain(log)
  })
}
