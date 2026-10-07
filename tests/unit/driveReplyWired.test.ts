import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { version as APP_VERSION } from '../../package.json'

/**
 * **The live `obsrv_drive` reply, driven end to end against a stub app, with no
 * window and no Obsrv process.**
 *
 * `driveReplyDeclared.test.ts` checks the *set relation* — that
 * `driveReplyStatus`'s output is declared — and says in its own comment that it
 * cannot see the wiring: put `...status` back in the handler and it stays green.
 * **That comment used to say nothing short of the live e2e specs could see it,
 * and that was false.** Wren disproved it with exactly this harness while
 * `#592` was in flight (room #4073): the MCP's control client takes its
 * discovery file from `OBSRV_CONTROL_FILE` (`src/mcp/control.ts:30`), so a
 * plain HTTP stub answering `status` is enough to make the server build a real
 * live reply. Wren wrote the probe and handed the test to me so that the person
 * who wrote the fix is not the only one who checked it.
 *
 * **What this catches that nothing else at unit level does:** restore
 * `{ ...status, … }` and this goes red, because the reply then carries an
 * `orientation` the published schema refuses — the defect that cost `#592` 29
 * e2e failures and would have returned `-32602` to every validating client.
 *
 * **Limits, so a green is not read as more than it is.** The stub answers the
 * keys `parseControlStatus` returns, not whatever a real app might add; it
 * drives the bare call with no inputs, so the conditional branches of the reply
 * (capture, highlight, scroll, tabs) are untouched; and it is not a test of the
 * app, which has its own e2e. **Wren's trap, which cost a first run:** the stub
 * must report `package.json`'s version, or `minimumApp.ts` refuses to drive an
 * app below 0.58.0 and the call fails for that reason instead.
 */

const SERVER = resolve(__dirname, '../../out/mcp/server.js')

/** Every field `parseControlStatus` accepts, so the reply is built from a full status. */
const STATUS = {
  version: APP_VERSION,
  url: 'https://example.com/',
  presetId: '1080p-24',
  profileId: 'reference',
  viewMode: '1:1',
  mode: 'url',
  panes: 'both',
  tabId: 't1',
  tabIndex: 0,
  orientation: 'landscape',
  textScale: 1,
  throttle: 'none',
  onionSkin: 0,
  loading: false,
  error: null,
  cssWidth: 1920,
  cssHeight: 1080,
  deviceScaleFactor: 2,
  screenShape: 'landscape',
  visionType: 'none',
  visionSeverity: 1,
  tabs: [{ id: 't1', url: 'https://example.com/', title: 'Example', presetId: '1080p-24', active: true }],
}

let server: Server
let dir: string
let controlFile: string
const seen: string[] = []

beforeEach(async () => {
  const token = randomBytes(32).toString('hex')
  server = createServer((req, res) => {
    let body = ''
    req.on('data', d => (body += String(d)))
    req.on('end', () => {
      const { command } = JSON.parse(body || '{}') as { command?: string }
      seen.push(command ?? '?')
      res.writeHead(200, { 'content-type': 'application/json' })
      // `status` is the only command whose answer shapes the reply; the rest
      // are applied and acknowledged, as the real server does.
      res.end(JSON.stringify(command === 'status' ? STATUS : { ok: true, applied: true }))
    })
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as { port: number }).port
  dir = mkdtempSync(join(tmpdir(), 'drive-wired-'))
  controlFile = join(dir, 'control.json')
  // 0600: `controlFileModeOk` refuses group or other access, so a default-mode
  // file would be rejected before any command is sent.
  writeFileSync(controlFile, JSON.stringify({ enabled: true, port, token, pid: process.pid, startedAt: new Date().toISOString() }), { mode: 0o600 })
})

afterEach(async () => {
  await new Promise<void>(done => server.close(() => done()))
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  seen.length = 0
})

async function drive(): Promise<{ isError: boolean; structured: Record<string, unknown>; text: string }> {
  const client = new Client({ name: 'drive-reply-wired', version: '0' }, { capabilities: {} })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    // **`OBSRV_TEST=1` is the launch fence.** An earlier version of this file
    // left it out and argued for doing so — "nothing should be launched anyway"
    // — which is the reasoning inverted: refusing to launch is exactly what a
    // stub test wants. `ensureLive` uses a reachable app without consulting the
    // variable, but a discovery that comes back neither live nor declined asks
    // `cannotLaunchReason`, which returns null on a Mac without it, and the
    // server then **launches the installed Obsrv on the developer's real
    // profile** — on every `npm test`, and invisibly on CI where no app is
    // installed. Found by Idris (room #4205), who had made that exact accident
    // by hand the same day. `tests/unit/mcpStubFence.test.ts` now guards it.
    env: { ...process.env, OBSRV_TEST: '1', OBSRV_CONTROL_FILE: controlFile },
  })
  await client.connect(transport)
  try {
    const r = (await client.callTool({ name: 'obsrv_drive', arguments: {} })) as {
      isError?: boolean
      structuredContent?: Record<string, unknown>
      content?: { text?: string }[]
    }
    return {
      isError: r.isError === true,
      structured: r.structuredContent ?? {},
      text: (r.content ?? []).map(b => b.text ?? '').join(' '),
    }
  } finally {
    await client.close()
  }
}

describe('the live drive reply, against a stub control server', () => {
  it('builds before it can be read', () => {
    expect(existsSync(SERVER), `${SERVER} is missing — run npm run build`).toBe(true)
  })

  it('answers without error and asks the stub for its status, or the rest proves nothing', async () => {
    const r = await drive()
    expect(r.isError, r.text.slice(0, 300)).toBe(false)
    // The reply has to have come from the stub, not from a default: if the
    // server never called `status`, an empty reply would satisfy the key check
    // below for the wrong reason.
    expect(seen).toContain('status')
    expect(r.structured['presetId']).toBe('1080p-24')
  })

  it('carries no `orientation`, which is what a restored `...status` spread would break', async () => {
    const r = await drive()
    // **Asserted before the key check, and what it is for was measured rather
    // than assumed — my first version of this comment got it wrong.**
    // `OBSRV_TEST=1` also switches on the strict-output check, so under the
    // restored-`...status` mutant the call comes back as an ERROR with no
    // `structuredContent`: the key check below then passes over an empty list.
    // It is the `rotated` assertion that actually catches the mutant, not that
    // one. So this line is not what makes the test non-vacuous; it is what makes
    // the FAILURE say the call errored, instead of leaving a reader to work that
    // out from `rotated` being undefined. Measured both ways: with the mutant
    // and without this line the file is still 2 failed of 3.
    expect(r.isError, r.text.slice(0, 300)).toBe(false)
    expect(Object.keys(r.structured), 'the drive reply carries a key its published schema refuses').not.toContain('orientation')
    // The fact it replaces, so the removal did not take the information with it.
    expect(r.structured['rotated']).toBe(true)
  })
})
