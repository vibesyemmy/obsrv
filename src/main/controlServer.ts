import { randomBytes } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  CONTROL_COMMANDS,
  CONTROL_TOKEN_BYTES,
  isControlCommand,
  presetApplyError,
  profileApplyError,
  tokenEqual,
  viewModeApplyError,
  type AgentApplyPatch,
  type ControlStatus,
} from '../shared/control'
import { urlSchemeError } from '../shared/url'

/**
 * The agent-control server (spec §14 "Live drive"): a loopback-only HTTP
 * server that lets a local agent drive the *visible* app — navigate, flip
 * presets and panel profiles, capture the window as the user sees it — while
 * the user watches. Owned by the "Agent control" toolbar toggle (persisted as
 * `settings.agentControl`, default off) and force-enabled for a session by
 * `OBSRV_AGENT_CONTROL=1`.
 *
 * It exposes no new mutation surface of its own: every command re-enters the
 * exact paths the renderer already drives (`navigate` through the same
 * normalise/expect/load pipeline as `IPC.navigate`; preset/profile/view-mode
 * through an `IPC.agentApply` forward the renderer store applies with its own
 * toolbar actions), and every payload is validated by the shared table-driven
 * checks in `shared/control.ts` plus the MCP URL scheme allowlist. No command
 * accepts file paths, JavaScript, or IPC channel names.
 *
 * While running, `control.json` ({ port, token }, mode 0600) sits in the
 * app's userData dir for discovery; it is removed on stop and on quit. Every
 * request — `status` included — must carry the token; a wrong or missing one
 * gets a detail-free 403 (see the decision note in shared/control.ts).
 */

/** Largest request body accepted; commands are tiny JSON. */
const MAX_BODY_BYTES = 64 * 1024

/** How long an apply command waits for the renderer mirror to confirm. */
const APPLY_WAIT_MS = 2_000
const APPLY_POLL_MS = 25

export interface ControlDeps {
  /** Snapshot for `status`: app version, the target's URL, the UI mirror. */
  status(): ControlStatus
  /** The same both-panes load `IPC.navigate` performs; resolves with the applied URL. */
  navigate(url: string): Promise<string>
  /** Forwards a validated patch to the renderer store (toolbar-equivalent apply). */
  apply(patch: AgentApplyPatch): void
  /** The app window exactly as the user sees it, as a base64 PNG. */
  captureVisible(): Promise<{ data: string; width: number; height: number }>
  /** An authenticated command arrived — nudge the toolbar's AGENT indicator. */
  activity(): void
}

interface Reply {
  code: number
  body: Record<string, unknown>
}

const reply = (code: number, body: Record<string, unknown>): Reply => ({ code, body })

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

export class ControlServer {
  private server: Server | null = null
  private token = ''

  constructor(
    private readonly file: string,
    private readonly deps: ControlDeps,
  ) {}

  get running(): boolean {
    return this.server !== null
  }

  /** Starts the server on an ephemeral loopback port and writes the discovery file. */
  async start(): Promise<void> {
    if (this.server) return
    this.token = randomBytes(CONTROL_TOKEN_BYTES).toString('hex')
    const server = createServer((req, res) => void this.handle(req, res))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    this.server = server
    const { port } = server.address() as AddressInfo
    // `mode` only applies at creation, so a stale file (a crashed run) is
    // removed first — the fresh write must be 0600 from birth.
    rmSync(this.file, { force: true })
    writeFileSync(this.file, JSON.stringify({ port, token: this.token }), { mode: 0o600 })
  }

  /**
   * Stops the server and removes the discovery file. Synchronous on purpose:
   * the quit path must not race the process teardown, and the file — the
   * part that outlives the process — goes first.
   */
  stop(): void {
    const server = this.server
    this.server = null
    this.token = ''
    rmSync(this.file, { force: true })
    if (server) {
      server.closeAllConnections()
      server.close()
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let out: Reply
    try {
      out = await this.route(req)
    } catch (e) {
      out = reply(500, { error: e instanceof Error ? e.message : 'internal error' })
    }
    const payload = JSON.stringify(out.body)
    res.writeHead(out.code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
    res.end(payload)
  }

  private async route(req: IncomingMessage): Promise<Reply> {
    if (req.method !== 'POST' || req.url !== '/') return reply(404, { error: 'POST / only' })
    // Defence-in-depth against browser-launched requests (the token is the
    // real gate; these close the browser-shaped path outright): a browser's
    // cross-site POST always carries an Origin header — same-user node
    // clients never do — and a no-cors "simple request" cannot send an
    // application/json content type.
    if (req.headers.origin !== undefined) return reply(403, { error: 'cross-origin requests are refused' })
    const contentType = req.headers['content-type'] ?? ''
    if (!/^application\/json\b/i.test(contentType)) {
      return reply(415, { error: 'content-type must be application/json' })
    }
    const raw = await this.readBody(req)
    if (raw === null) return reply(413, { error: `body over ${MAX_BODY_BYTES} bytes` })
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return reply(400, { error: 'body must be JSON' })
    }
    if (typeof parsed !== 'object' || parsed === null) return reply(400, { error: 'body must be a JSON object' })
    const body = parsed as Record<string, unknown>

    // Token first, before the command is even looked at; the failure reveals
    // nothing — not whether the command exists, not what would be allowed.
    if (!tokenEqual(this.token, body.token)) return reply(403, { error: 'forbidden' })

    const command = body.command
    if (!isControlCommand(command)) {
      return reply(400, { error: `unknown command — allowed: ${CONTROL_COMMANDS.join(', ')}` })
    }
    this.deps.activity()
    const payload = typeof body.payload === 'object' && body.payload !== null ? (body.payload as Record<string, unknown>) : {}

    switch (command) {
      case 'status':
        return reply(200, { ok: true, ...this.deps.status() })

      case 'navigate': {
        const url = payload.url
        if (typeof url !== 'string' || url.trim() === '') return reply(400, { error: 'navigate payload must be { url: string }' })
        // The same allowlist the MCP tools apply: the app's own URL bar stays
        // the only surface that can reach another scheme.
        const bad = urlSchemeError(url)
        if (bad) return reply(400, { error: bad })
        const applied = await this.deps.navigate(url.trim())
        return reply(200, { ok: true, url: applied })
      }

      case 'setPreset': {
        const err = presetApplyError(payload.id)
        if (err) return reply(400, { error: err })
        return this.applyAndConfirm({ presetId: payload.id as string }, s => s.presetId === payload.id)
      }

      case 'setProfile': {
        const err = profileApplyError(payload.id)
        if (err) return reply(400, { error: err })
        return this.applyAndConfirm({ profileId: payload.id as string }, s => s.profileId === payload.id)
      }

      case 'setViewMode': {
        const err = viewModeApplyError(payload.mode)
        if (err) return reply(400, { error: err })
        const mode = payload.mode as '1:1' | 'fit'
        return this.applyAndConfirm({ viewMode: mode }, s => s.viewMode === mode)
      }

      case 'captureVisible': {
        const capture = await this.deps.captureVisible()
        return reply(200, { ok: true, ...capture })
      }
    }
  }

  /**
   * Forwards a patch to the renderer and waits (bounded) for the UI mirror to
   * reflect it, so a 200 means "applied", not "sent". `applied: false` after
   * the wait is not an error — the renderer may be busy — the caller can poll
   * `status`.
   */
  private async applyAndConfirm(patch: AgentApplyPatch, confirmed: (s: ControlStatus) => boolean): Promise<Reply> {
    this.deps.apply(patch)
    const deadline = Date.now() + APPLY_WAIT_MS
    let applied = confirmed(this.deps.status())
    while (!applied && Date.now() < deadline) {
      await sleep(APPLY_POLL_MS)
      applied = confirmed(this.deps.status())
    }
    return reply(200, { ok: true, applied, ...this.deps.status() })
  }

  /** The request body, or null when it exceeds the cap. */
  private readBody(req: IncomingMessage): Promise<string | null> {
    return new Promise((resolve, rejectOnError) => {
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (chunk: Buffer) => {
        size += chunk.byteLength
        if (size > MAX_BODY_BYTES) {
          req.removeAllListeners('data')
          req.removeAllListeners('end')
          resolve(null)
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', rejectOnError)
    })
  }
}
