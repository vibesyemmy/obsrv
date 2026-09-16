import { test, expect, type ElectronApplication } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONTROL_FILE_NAME, isDisabledStance, parseControlFile, type ControlInfo } from '../../src/shared/control'
import { launchApp, rendererWindow } from './launch'

/**
 * TEMPORARY, NOT FOR MERGE — the reproduction `bug-arrivals` asks for before
 * anything is fixed. It drives a client-side redirect repeatedly and counts how
 * often the reply carries "navigated after it loaded", a note that should never
 * appear for a page that redirected itself during the load.
 */

let app: ElectronApplication
let info: ControlInfo
const REDIRECT = pathToFileURL(resolve(__dirname, '../fixtures/redirect.html')).href
const RUNS = 20

interface Reply {
  status: number
  body: Record<string, unknown>
}

function call(command: string, payload?: Record<string, unknown>): Promise<Reply> {
  return new Promise((done, fail) => {
    const body: Record<string, unknown> = { command, token: info.token }
    if (payload) body.payload = payload
    const data = JSON.stringify(body)
    const req = request(
      { host: '127.0.0.1', port: info.port, method: 'POST', path: '/', headers: { 'content-type': 'application/json' } },
      res => {
        let text = ''
        res.on('data', d => (text += String(d)))
        res.on('end', () => {
          let parsed: Record<string, unknown> = {}
          try {
            parsed = JSON.parse(text) as Record<string, unknown>
          } catch {
            parsed = { raw: text }
          }
          done({ status: res.statusCode ?? 0, body: parsed })
        })
      },
    )
    req.on('error', fail)
    req.end(data)
  })
}

test.describe.configure({ timeout: 240_000 })

test.beforeAll(async () => {
  app = await launchApp([], { OBSRV_AGENT_CONTROL: '1' })
  await rendererWindow(app)
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'))
  const controlFile = join(userData, CONTROL_FILE_NAME)
  await expect.poll(() => existsSync(controlFile)).toBe(true)
  const parsed = parseControlFile(readFileSync(controlFile, 'utf8'))
  if (!parsed || isDisabledStance(parsed)) throw new Error('no control port')
  info = parsed
})
test.afterAll(async () => {
  await app.close()
})

test('REPRO: how often does a mirrored redirect fire "navigated after it loaded"', async () => {
  let spurious = 0
  let secondCommitUnmarked = 0
  const lines: string[] = []

  for (let i = 0; i < RUNS; i++) {
    // Away first, so each iteration is a fresh arrival at the redirect rather
    // than a no-op navigation to the page already shown.
    await call('navigate', { url: pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href })
    await new Promise(r => setTimeout(r, 250))

    const nav = await call('navigate', { url: REDIRECT })
    expect(nav.status, JSON.stringify(nav.body)).toBe(200)
    await new Promise(r => setTimeout(r, 400))

    // Any measurement call carries the notes; inspect is the cheapest.
    const r = await call('inspect', { selector: 'body' })
    const notes = ((r.body as { notes?: string[] }).notes ?? []).filter(n => n.includes('navigated after'))
    // What the target itself recorded for the redirect's two commits: the
    // second one's attribution is the race 7d811f8 left open.
    const commits = await app.evaluate(() => {
      const g = globalThis as any
      return g.__obsrv.target.commitTrace().slice(-2) as { url: string; mirroring?: boolean; said: boolean }[]
    })
    const second = commits.at(-1)
    if (i === 0) {
      const full = await app.evaluate(() => {
        const g = globalThis as any
        return g.__obsrv.target.commitTrace().slice(-5) as { url: string; kind: string; mirroring?: boolean; said: boolean; why?: string }[]
      })
      console.log(`[arrivals-repro] the target's last 5 commits:\n${full.map(c => `    ${c.url.split('/').pop()} kind=${c.kind} mirroring=${String(c.mirroring)} said=${c.said}${c.why ? ` why=${c.why}` : ''}`).join('\n')}`)
      const mirror = await app.evaluate(() => {
        const g = globalThis as any
        return g.__obsrv.sync.mirrorTrace().slice(-4) as { at: number; pane: string; url: string; decision: string }[]
      })
      console.log(`[arrivals-repro] the bus's last 4 decisions:\n${mirror.map(m => `    ${m.pane} ${m.url.split('/').pop()} ${m.decision}`).join('\n')}`)
    }
    if (notes.length > 0) {
      spurious++
      if (spurious === 1) console.log(`[arrivals-repro] the note reads: ${notes[0]}`)
    }
    if (second && second.mirroring !== true) secondCommitUnmarked++
    lines.push(
      `${String(i).padStart(2)}: note=${notes.length > 0 ? 'FIRED' : '-'} ` +
        `second=${second ? `${second.url.split('/').pop()} mirroring=${String(second.mirroring)} said=${second.said}` : 'none'}`,
    )
  }

  console.log(`[arrivals-repro]\n${lines.join('\n')}`)
  console.log(`[arrivals-repro] spurious notes: ${spurious}/${RUNS}; second commit unmarked: ${secondCommitUnmarked}/${RUNS}`)

  // THE CONTROL. A page that does not redirect must produce no note at all; if
  // it does, the note is not about redirects and this reproduction is measuring
  // something else entirely.
  const SOLID = pathToFileURL(resolve(__dirname, '../fixtures/solid-red.html')).href
  let plain = 0
  let exampleNote = ''
  for (let i = 0; i < RUNS; i++) {
    await call('navigate', { url: pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href })
    await new Promise(r => setTimeout(r, 250))
    await call('navigate', { url: SOLID })
    await new Promise(r => setTimeout(r, 400))
    const r = await call('inspect', { selector: 'body' })
    const notes = ((r.body as { notes?: string[] }).notes ?? []).filter(n => n.includes('navigated after'))
    if (notes.length > 0) {
      plain++
      exampleNote ||= notes[0]!
    }
  }
  console.log(`[arrivals-repro] CONTROL, a page that does not redirect: ${plain}/${RUNS} notes${exampleNote ? ` — e.g. ${exampleNote}` : ''}`)
})
