import { test, expect, type ElectronApplication } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runFlow } from '../../src/mcp/flowRunner'
import { CONTROL_FILE_NAME, isDisabledStance, parseControlFile, type ControlInfo } from '../../src/shared/control'
import { launchApp, rendererWindow } from './launch'

/**
 * **The live clause of `feat-flow-type-text`'s own acceptance**, and the one
 * claim in Henry's merged design (`board/flow-type-design`, `#529`) he flagged
 * as unproven: *"real `keyDown`/`char`/`keyUp` events reach a page's own
 * handlers, where `Input.insertText` would not — that difference is the whole
 * reason this feature dispatches keys instead of setting a value."*
 *
 * `Input.insertText` fires `beforeinput`/`input` with **no `keydown` at all**.
 * `tests/fixtures/type-text.html` logs every event per field in order, so a
 * build that silently fell back to it reads as a missing first entry rather
 * than a silent pass — the same discriminator `flow-selector-click.spec.ts`
 * uses for clicks landing on the wrong element.
 *
 * The fixture's `#controlled` field goes one step further: it only adopts a
 * value that arrived via a `keydown`-led `input`, discarding any other change
 * exactly as an unwired React controlled component would. That is the React
 * shape without React — it does not prove a real `onChange` fires, which is a
 * claim about React's own synthetic event layer that only a real page can
 * answer, but it proves the mechanism the design rests on (real keys, in
 * order, before the value changes) is real on the surface every live path
 * already acts on.
 *
 * Desk-safe: nothing here shows or focuses a window (same offscreen app as
 * `flow-selector-click.spec.ts`).
 */
const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/type-text.html')).href

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

const eventsSoFar = (): Promise<string[]> =>
  app.evaluate(() => {
    const wc = (globalThis as { __obsrv?: { target: { webContents: { executeJavaScript: (c: string) => Promise<unknown> } } } }).__obsrv!.target.webContents
    return wc.executeJavaScript('(window.events || []).slice()') as Promise<string[]>
  })

const fieldValue = (selector: string): Promise<string> =>
  app.evaluate((_void, sel) => {
    const wc = (globalThis as { __obsrv?: { target: { webContents: { executeJavaScript: (c: string) => Promise<unknown> } } } }).__obsrv!.target.webContents
    return wc.executeJavaScript(`document.querySelector(${JSON.stringify(sel)}).value`) as Promise<string>
  }, selector)

const reset = (): Promise<unknown> =>
  app.evaluate(() => {
    const wc = (globalThis as { __obsrv?: { target: { webContents: { executeJavaScript: (c: string) => Promise<unknown> } } } }).__obsrv!.target.webContents
    return wc.executeJavaScript(
      `window.events = []; window.controlledValue = ''; document.getElementById('plain-text').value = ''; document.getElementById('a-password').value = ''; document.getElementById('controlled').value = ''; true`,
    )
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
  await call('navigate', { url: FIXTURE })
})

test.afterAll(async () => {
  await app?.close()
})

test('a flow types into a field by selector, and the page sees real keydown before input', async () => {
  await reset()
  const result = await runFlow({ steps: [{ action: 'type', target: '#plain-text', text: 'hi' }] }, { call })
  expect(result.steps[0], JSON.stringify(result.steps[0]?.error)).toMatchObject({ status: 'ran' })
  expect(result.steps[0]!.typed).toMatchObject({ length: 2, value: 'hi' })

  // The measurement the card asked for: `keydown` before `input`, per
  // character, on the real page — not inferred from the reply.
  const log = await eventsSoFar()
  expect(log, JSON.stringify(log)).toEqual([
    'plain:keydown:h',
    'plain:beforeinput',
    'plain:input:h',
    'plain:keydown:i',
    'plain:beforeinput',
    'plain:input:hi',
  ])
  expect(await fieldValue('#plain-text')).toBe('hi')
})

test('a flow types into a controlled input, and the controlled value ends up right — the React shape without React', async () => {
  await reset()
  const result = await runFlow({ steps: [{ action: 'type', target: '#controlled', text: 'ok' }] }, { call })
  expect(result.steps[0], JSON.stringify(result.steps[0]?.error)).toMatchObject({ status: 'ran' })

  // If the dispatch had silently been `insertText` instead of real keys, the
  // fixture's controlled field discards the whole change (no preceding
  // `keydown`) and this reads '' — the exact failure this card exists to rule
  // out, made visible rather than a passing assertion on the wrong thing.
  await expect.poll(() => fieldValue('#controlled')).toBe('ok')
})

test('a password field is masked in the report, and the report never carries the value', async () => {
  await reset()
  const result = await runFlow({ steps: [{ action: 'type', target: '#a-password', text: 'sekret1' }] }, { call })
  expect(result.steps[0], JSON.stringify(result.steps[0]?.error)).toMatchObject({ status: 'ran' })
  expect(result.steps[0]!.typed).toMatchObject({ length: 7, maskedBecause: 'password field' })
  expect(JSON.stringify(result.steps[0]!.typed)).not.toContain('sekret1')

  // And the real keys still reached the page — masking is a report-layer
  // decision, not a different, weaker dispatch for password fields.
  const log = await eventsSoFar()
  expect(log[0]).toBe('password:keydown:s')
  await expect.poll(() => fieldValue('#a-password')).toBe('sekret1')
})

test('a disabled field refuses by name, and nothing is typed', async () => {
  await reset()
  const result = await runFlow({ steps: [{ action: 'type', target: '#a-disabled', text: 'x' }] }, { call })
  expect(result.steps[0]).toMatchObject({ status: 'failed' })
  expect(result.steps[0]!.error).toContain('disabled')
  expect(await eventsSoFar()).toEqual([])
})

test('a read-only field refuses by name, and its existing value is untouched', async () => {
  await reset()
  const result = await runFlow({ steps: [{ action: 'type', target: '#a-readonly', text: 'x' }] }, { call })
  expect(result.steps[0]).toMatchObject({ status: 'failed' })
  expect(result.steps[0]!.error).toContain('read-only')
  expect(await fieldValue('#a-readonly')).toBe('already here')
})

test('a non-editable element refuses by name, naming that it takes no text', async () => {
  await reset()
  const result = await runFlow({ steps: [{ action: 'type', target: '#not-editable', text: 'x' }] }, { call })
  expect(result.steps[0]).toMatchObject({ status: 'failed' })
  expect(result.steps[0]!.error).toContain('does not accept typed text')
  expect(await eventsSoFar()).toEqual([])
})

test('append: true adds to the field instead of replacing it', async () => {
  await reset()
  const first = await runFlow({ steps: [{ action: 'type', target: '#plain-text', text: 'ab' }] }, { call })
  expect(first.steps[0]).toMatchObject({ status: 'ran' })
  const second = await runFlow({ steps: [{ action: 'type', target: '#plain-text', text: 'cd', append: true }] }, { call })
  expect(second.steps[0]).toMatchObject({ status: 'ran' })
  expect(await fieldValue('#plain-text')).toBe('abcd')
})

test('typing again without append replaces the field rather than adding to it', async () => {
  await reset()
  const first = await runFlow({ steps: [{ action: 'type', target: '#plain-text', text: 'ab' }] }, { call })
  expect(first.steps[0]).toMatchObject({ status: 'ran' })
  const second = await runFlow({ steps: [{ action: 'type', target: '#plain-text', text: 'zz' }] }, { call })
  expect(second.steps[0]).toMatchObject({ status: 'ran' })
  expect(await fieldValue('#plain-text')).toBe('zz')
})
