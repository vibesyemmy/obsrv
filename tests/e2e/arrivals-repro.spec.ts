import { test, expect, type ElectronApplication } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { createServer, request, type Server } from 'node:http'
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

/**
 * A SERVER redirect: 302 /redirect -> /landed. The fixture `redirect.html` is a
 * client-side `location.replace`, which is a different path — it makes a second
 * renderer-initiated navigation and fires no `did-redirect-navigation` at all.
 * Henry's syncBus fix keys on that event, so the two paths must be measured
 * apart or a change in one will be read as a change in the other.
 */
let server: Server
let origin = ''

test.describe.configure({ timeout: 300_000 })

test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/landed' })
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><html><head><title>landed</title></head><body><p>landed</p></body></html>')
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  origin = typeof addr === 'object' && addr !== null ? `http://127.0.0.1:${addr.port}` : ''
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
  await new Promise<void>(r => server.close(() => r()))
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

test('REPRO: the same question for a SERVER redirect (302), which is the path Henry\'s fix touches', async () => {
  let fired = 0
  let firstTrace = ''
  for (let i = 0; i < RUNS; i++) {
    await call('navigate', { url: `${origin}/landed` })
    await new Promise(r => setTimeout(r, 250))
    await call('navigate', { url: `${origin}/redirect` })
    await new Promise(r => setTimeout(r, 400))
    const r = await call('inspect', { selector: 'body' })
    const notes = ((r.body as { notes?: string[] }).notes ?? []).filter(n => n.includes('navigated after'))
    if (notes.length > 0) fired++
    if (i === 0) {
      const full = await app.evaluate(() => {
        const g = globalThis as any
        return g.__obsrv.target.commitTrace().slice(-4) as { at: number; url: string; mirroring?: boolean; said: boolean }[]
      })
      firstTrace = full.map(c => `    ${c.url.replace(/^https?:\/\/[^/]+/, '')} mirroring=${String(c.mirroring)} said=${c.said}`).join('\n')
    }
  }
  console.log(`[arrivals-repro] SERVER redirect (302): ${fired}/${RUNS} notes\n${firstTrace}`)
})

test('REPRO: the case the card actually claims — the NATIVE pane alone redirects, and the target only mirrors', async () => {
  // The claim in 7d811f8 is that OBSRV'S OWN PLUMBING gets counted. Driving
  // `navigate` moves both panes, so the target's second commit there is its own
  // redirect landing — a real movement, and a note about it is arguably true.
  // This arm removes that: only the native pane is told to go anywhere, so
  // every commit the TARGET makes is the bus's doing.
  let fired = 0
  let firstTrace = ''
  let exampleNote = ''
  for (let i = 0; i < RUNS; i++) {
    await call('navigate', { url: pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href })
    await new Promise(r => setTimeout(r, 300))
    await app.evaluate(async (_e, url: string) => {
      await (globalThis as any).__obsrv.native.load(url)
    }, REDIRECT)
    await new Promise(r => setTimeout(r, 600))
    const r = await call('inspect', { selector: 'body' })
    const notes = ((r.body as { notes?: string[] }).notes ?? []).filter(n => n.includes('navigated after'))
    if (notes.length > 0) {
      fired++
      exampleNote ||= notes[0]!
    }
    if (i === 0) {
      const full = await app.evaluate(() => {
        const g = globalThis as any
        return g.__obsrv.target.commitTrace().slice(-4) as { at: number; url: string; mirroring?: boolean; said: boolean }[]
      })
      firstTrace = full.map(c => `    commit ${String(c.at)} ${c.url.split('/').pop()} mirroring=${String(c.mirroring)}`).join('\n')
    }
  }
  console.log(`[arrivals-repro] NATIVE-ONLY redirect: ${fired}/${RUNS} notes\n${firstTrace}${exampleNote ? `\n    note: ${exampleNote}` : ''}`)
})

test('DISCRIMINATOR: native pane alone, but a SERVER redirect — the target never runs a redirecting page', async () => {
  // If the duplicate commit is the TARGET running redirect.html's own
  // `location.replace`, then a 302 must produce no duplicate and no note: the
  // native commits /landed directly, the bus mirrors /landed, and the target
  // never loads a page that redirects itself.
  let fired = 0
  let firstTrace = ''
  for (let i = 0; i < RUNS; i++) {
    await call('navigate', { url: `${origin}/landed` })
    await new Promise(r => setTimeout(r, 300))
    await app.evaluate(async (_e, url: string) => {
      await (globalThis as any).__obsrv.native.load(url)
    }, `${origin}/redirect`)
    await new Promise(r => setTimeout(r, 600))
    const r = await call('inspect', { selector: 'body' })
    const notes = ((r.body as { notes?: string[] }).notes ?? []).filter(n => n.includes('navigated after'))
    if (notes.length > 0) fired++
    if (i === 0) {
      const full = await app.evaluate(() => {
        const g = globalThis as any
        return g.__obsrv.target.commitTrace().slice(-4) as { at: number; url: string; mirroring?: boolean }[]
      })
      firstTrace = full.map(c => `    commit ${c.url.replace(/^https?:\/\/[^/]+/, '')} mirroring=${String(c.mirroring)}`).join('\n')
    }
  }
  console.log(`[arrivals-repro] NATIVE-ONLY + SERVER redirect: ${fired}/${RUNS} notes\n${firstTrace}`)
})

test('PROBE: every field Electron 43 puts on a navigation event, on both arms', async () => {
  const dump = async (label: string, drive: () => Promise<void>): Promise<void> => {
    await app.evaluate(() => {
      const g = globalThis as any
      const mod = g.__obsrvNavDetails
      if (mod) mod.length = 0
    })
    await drive()
    await new Promise(r => setTimeout(r, 700))
    const rows = await app.evaluate(() => {
      const g = globalThis as any
      return (g.__obsrvNavDetails ?? []) as Record<string, unknown>[]
    })
    const seen = rows.map(r => {
      const { pane, event, at, url, ...rest } = r as Record<string, unknown>
      void at
      return `  ${String(pane).padEnd(6)} ${String(event).padEnd(24)} ${String(url).split('/').pop()}  ${JSON.stringify(rest)}`
    })
    console.log(`[nav-details] ${label}\n${seen.join('\n')}`)
  }

  await dump('ARM 1: navigate(redirect.html) — both panes', async () => {
    await call('navigate', { url: pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href })
    await new Promise(r => setTimeout(r, 300))
    await call('navigate', { url: REDIRECT })
  })

  await dump('ARM 3: native pane alone loads redirect.html', async () => {
    await call('navigate', { url: pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href })
    await new Promise(r => setTimeout(r, 300))
    await app.evaluate(async (_e, url: string) => {
      await (globalThis as any).__obsrv.native.load(url)
    }, REDIRECT)
  })

  await dump('ARM 4: native pane alone, SERVER 302', async () => {
    await call('navigate', { url: `${origin}/landed` })
    await new Promise(r => setTimeout(r, 300))
    await app.evaluate(async (_e, url: string) => {
      await (globalThis as any).__obsrv.native.load(url)
    }, `${origin}/redirect`)
  })
})

test('PROBE: does a 302 really fire no did-start-navigation on the native pane?', async () => {
  // Listeners attached HERE, before the load, straight onto the webContents —
  // so this does not depend on any instrumentation in src/, and a capture
  // failure is ruled out by a positive control in the same run rather than
  // assumed away.
  const rows: { event: string; url: string; httpResponseCode?: number }[] = await app.evaluate(
    async (_e, urls: { redirect: string; plain: string }) => {
      const g = globalThis as any
      const wc = g.__obsrv.native.webContents
      const seen: { event: string; url: string; httpResponseCode?: number }[] = []
      const onStart = (_ev: unknown, ...a: unknown[]) => {
        const d = (typeof a[0] === 'object' ? a[0] : _ev) as { url?: string; isMainFrame?: boolean }
        seen.push({ event: 'did-start-navigation', url: String(d?.url) })
      }
      const onRedirect = (_ev: unknown, ...a: unknown[]) => {
        const d = (typeof a[0] === 'object' ? a[0] : _ev) as { url?: string }
        seen.push({ event: 'did-redirect-navigation', url: String(d?.url) })
      }
      const onNavigate = (_ev: unknown, url: string, httpResponseCode?: number) =>
        seen.push({ event: 'did-navigate', url, httpResponseCode })
      wc.on('did-start-navigation', onStart)
      wc.on('did-redirect-navigation', onRedirect)
      wc.on('did-navigate', onNavigate)
      try {
        // The case in question.
        await g.__obsrv.native.load(urls.redirect)
        await new Promise((r: (v?: unknown) => void) => setTimeout(r, 600))
        seen.push({ event: '--- positive control below ---', url: '' })
        // The control: the same listeners, a load with no redirect. If rows
        // appear here and not above, the capture works and the 302 path is
        // genuinely different.
        await g.__obsrv.native.load(urls.plain)
        await new Promise((r: (v?: unknown) => void) => setTimeout(r, 600))
      } finally {
        wc.off('did-start-navigation', onStart)
        wc.off('did-redirect-navigation', onRedirect)
        wc.off('did-navigate', onNavigate)
      }
      return seen
    },
    { redirect: `${origin}/redirect`, plain: `${origin}/landed` },
  )
  console.log(`[302-probe]\n${rows.map(r => `    ${r.event.padEnd(28)} ${r.url.replace(/^https?:\/\/[^/]+/, '')}${r.httpResponseCode !== undefined ? ` code=${r.httpResponseCode}` : ''}`).join('\n')}`)
})
