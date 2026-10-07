import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { version as APP_VERSION } from '../../package.json'

/**
 * A stub Obsrv app for the MCP's control client: an HTTP server speaking the
 * control protocol and a discovery file the client is pointed at with
 * `OBSRV_CONTROL_FILE` (`src/mcp/control.ts`).
 *
 * **Why this exists.** The live surface used to be reachable only from the
 * Playwright e2e specs, which is why a reply that broke every validating client
 * cost `#592` 29 red e2e tests and nothing cheaper. Wren's probe showed the live
 * path can be driven from a unit test with no app and no window (room #4073),
 * and this is that probe made reusable.
 *
 * **It is a stub, not the app.** It answers the keys `parseControlStatus`
 * returns and applies the commands this helper implements; it is not a test of
 * the renderer, the window, or anything the app does with a command once it has
 * it. Those have their own e2e.
 *
 * **The trap, which cost Wren a first run:** the stub must report
 * `package.json`'s version. `minimumApp.ts` refuses to drive an app below
 * `MINIMUM_APP_VERSION`, so an invented version fails the call for that reason
 * instead of the one under test.
 */

export interface StubOptions {
  /**
   * Commands the stub does NOT know, answered `400 unknown command` exactly as
   * `controlServer.ts` words it. This is how an older app is modelled: the
   * version floor runs one way only, so a newer MCP has to cope with a DMG that
   * predates a command.
   */
  unknown?: readonly string[]
  /** Commands answered `400` with some other message, to prove a non-skew 400 is not retried. */
  badPayload?: readonly string[]
}

export interface StubApp {
  controlFile: string
  /** Every command the stub was asked for, in order. */
  seen: string[]
  /** The stub's current stored-form word, which `status` reports and the commands change. */
  orientation: () => 'portrait' | 'landscape'
  close: () => Promise<void>
}

export async function startStubApp(options: StubOptions = {}): Promise<StubApp> {
  const unknown = new Set(options.unknown ?? [])
  const badPayload = new Set(options.badPayload ?? [])
  const seen: string[] = []
  let orientation: 'portrait' | 'landscape' = 'portrait'

  const status = (): Record<string, unknown> => ({
    version: APP_VERSION,
    url: 'https://example.com/',
    presetId: '1080p-24',
    profileId: 'reference',
    viewMode: '1:1',
    mode: 'url',
    panes: 'both',
    tabId: 't1',
    tabIndex: 0,
    orientation,
    textScale: 1,
    throttle: 'none',
    onionSkin: 0,
    loading: false,
    error: null,
    cssWidth: orientation === 'landscape' ? 1080 : 1920,
    cssHeight: orientation === 'landscape' ? 1920 : 1080,
    deviceScaleFactor: 2,
    screenShape: 'landscape',
    visionType: 'none',
    visionSeverity: 1,
    tabs: [{ id: 't1', url: 'https://example.com/', title: 'Example', presetId: '1080p-24', active: true }],
  })

  const server: Server = createServer((req, res) => {
    let body = ''
    req.on('data', d => (body += String(d)))
    req.on('end', () => {
      const { command, payload } = JSON.parse(body || '{}') as { command?: string; payload?: Record<string, unknown> }
      seen.push(command ?? '?')
      const send = (code: number, value: unknown): void => {
        res.writeHead(code, { 'content-type': 'application/json' })
        res.end(JSON.stringify(value))
      }
      if (command !== undefined && unknown.has(command)) {
        // Worded as the real server words it, because the MCP's fallback keys
        // off this string and both sides of it live in this repository.
        return send(400, { error: `unknown command — allowed: status, navigate, setPreset, setProfile` })
      }
      if (command !== undefined && badPayload.has(command)) return send(400, { error: `${command} payload must be something else` })
      if (command === 'status') return send(200, status())
      if (command === 'setRotation') orientation = payload?.['rotate'] === true ? 'landscape' : 'portrait'
      if (command === 'setOrientation') orientation = payload?.['orientation'] === 'landscape' ? 'landscape' : 'portrait'
      return send(200, { ok: true, applied: true })
    })
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as { port: number }).port
  const dir = mkdtempSync(join(tmpdir(), 'stub-control-'))
  const controlFile = join(dir, 'control.json')
  // 0600: `controlFileModeOk` refuses group or other access, so a default-mode
  // file is rejected before any command is sent.
  writeFileSync(
    controlFile,
    JSON.stringify({ enabled: true, port, token: randomBytes(32).toString('hex'), pid: process.pid, startedAt: new Date().toISOString() }),
    { mode: 0o600 },
  )

  return {
    controlFile,
    seen,
    orientation: () => orientation,
    close: async () => {
      await new Promise<void>(done => server.close(() => done()))
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    },
  }
}
