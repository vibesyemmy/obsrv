import { randomBytes } from 'node:crypto'
import { parseAuditRequest, parseInspectRequest, parseLintRequest, type AuditRequest, type InspectRequest, type LintRequest } from '../shared/ipcPayloads'
import type { InspectReadout } from '../shared/inspectReadout'
import type { AuditResult } from '../cli/audit'
import type { LintGroupSummary, LintResult } from '../cli/lint'
import type { VisionType } from '../shared/vision'
import { rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  CONTROL_COMMANDS,
  CONTROL_TOKEN_BYTES,
  isControlCommand,
  parseClick,
  parseHighlight,
  parseOpenTab,
  parseTabId,
  pixelExactApplyError,
  presetApplyError,
  profileApplyError,
  tokenEqual,
  orientationApplyError,
  onionSkinApplyError,
  textScaleApplyError,
  throttleApplyError,
  panesApplyError,
  visionApplyError,
  viewModeApplyError,
  type AgentApplyPatch,
  type AgentClick,
  type ControlStatus,
  type ControlTab,
  pageRectToPane,
  type TargetView,
} from '../shared/control'
import { parseScrollPos, parseScrollRequest } from '../shared/ipcPayloads'
import type { Orientation, ScrollReport, ScrollRequest } from '../shared/types'
import { urlSchemeError } from '../shared/url'
import { unansweredMeasureMessage, type AskOutcome } from '../shared/measureBudget'

/**
 * The agent-control server (spec §14 "Live drive" / "Drive controls"): a
 * loopback-only HTTP server that lets a local agent drive the *visible* app —
 * navigate, flip presets and panel profiles, scroll, pan, click, highlight,
 * step history, capture the window or just the target pane — while the user
 * watches. Owned by the "Agent control" toolbar toggle (persisted as
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

/**
 * What `status` reports minus the tab list — `tabs()` below is that list's
 * one source of truth (the `tabs` command reuses it verbatim), so `status`'s
 * own dep does not build it a second time; `route` appends it when replying.
 */
type StatusReport = Omit<ControlStatus, 'tabs'>

export interface ControlDeps {
  /** Snapshot for `status`: app version, the target's URL, the UI mirror. */
  status(): StatusReport
  /**
   * The front tab's committed navigations so far, and where the last one
   * went. One increment site in main (ipc.ts), so the walk can know its
   * document was replaced under it without inferring a navigation from a URL
   * string — the same fact the measurement notes read directly.
   */
  arrivals?(): { count: number; url: string }
  /** The same both-panes load `IPC.navigate` performs; resolves with the applied URL. */
  /** Points both panes at the URL; `loaded: false` when the load outran the app's navigate budget and is still going. */
  navigate(url: string): Promise<{ url: string; loaded: boolean }>
  /** Forwards a validated patch to the renderer store (toolbar-equivalent apply). */
  apply(patch: AgentApplyPatch): void
  /** The app window exactly as the user sees it, as a base64 PNG. */
  captureVisible(): Promise<{ data: string; width: number; height: number }>
  /**
   * The window capture cropped to the target pane's reported bounds; the
   * full window (with a warning) when the renderer has not reported them.
   */
  captureTarget(): Promise<{ data: string; width: number; height: number; warnings: string[] }>
  /** The target's own frame at device pixels — the raster an agent judges type on — with the capture's settle verdict. */
  captureRaster(): Promise<{ data: string; width: number; height: number; settled: boolean; unsettledReason?: string; warnings: string[] }>
  /** The target's current CSS viewport, for `click` bounds validation. */
  viewport(): { width: number; height: number }
  /** The target's scroll, text scale, density and pane size: what a page-space rect is mapped through. */
  targetView(): Promise<TargetView>
  /**
   * Absolute page scroll of both panes over the pane-sync `applyScroll`
   * channel; resolves with the offset the target pane actually reached, or
   * null when it could not confirm within the budget.
   */
  scroll(req: ScrollRequest): Promise<ScrollReport | null>
  /** A validated click, delivered through the same `sendInput` path the canvas uses. */
  click(c: AgentClick): void
  /** The toolbar's history/reload actions, byte-for-byte (native-only history; reload reloads both). */
  back(): void
  forward(): void
  /** Reloads both panes and resolves once the target has loaded again, or after a bound. */
  reload(): Promise<void>
  /** Bring the app window to the front. */
  focusWindow(): void
  /**
   * The inspector, for agents: what is under a point of the target screen
   * or what a selector names, with millimetres and contrast on the panel in
   * force. Null when nothing is there.
   */
  inspect(req: InspectRequest): Promise<InspectReadout | null>
  /**
   * How the last page ask ended, when the caller can say: a report the
   * checks refused is not a page that never answered, and the reader is
   * told which it was. Absent from an older caller, which reads as the
   * cautious sentence.
   */
  askOutcome?(): AskOutcome
  /**
   * The physical-units audit on the page in front: every target and text
   * element in millimetres on the screen in force, density and text scale
   * included, as `obsrv audit` measures a headless load. Null when the page
   * did not answer, or answered a report the checks refused; `askOutcome`
   * says which.
   */
  audit(req: AuditRequest): Promise<LiveAudit | null>
  /**
   * The lint on the page in front: sub-pixel edges, light text, contrast
   * on the panel in force, image scale, judged on the screen in force as
   * `obsrv lint` judges a headless load. Null when the page did not answer.
   */
  lint(req: LintRequest): Promise<LiveLint | null>
  /** The strip as the user sees it, and the cap. */
  tabs(): { tabs: ControlTab[]; maxTabs: number }
  /** Opens a tab and brings it to the front; null at the cap. */
  openTab(): string | null
  /** Brings a tab to the front; false when no tab has that id. */
  activateTab(id: string): boolean
  /** Closes a tab; refuses the last one. */
  closeTab(id: string): { ok: true; activeId: string } | { ok: false; error: string }
  /** An authenticated command arrived — nudge the toolbar's AGENT indicator. */
  activity(): void
}

/** What a live audit answers: the screen it was measured on, then `obsrv audit`'s own result. */
export interface LiveAudit extends AuditResult {
  cssWidth: number
  cssHeight: number
  deviceScaleFactor: number
  textScale: number
  pageHeight: number
}

/** What a live lint answers: the screen it was judged on, then `obsrv lint`'s own result. */
export interface LiveLint extends Omit<LintResult, 'groups'> {
  /** Slimmed for the wire: the exemplar is where it is and what it says. */
  groups: LintGroupSummary[]
  cssWidth: number
  cssHeight: number
  deviceScaleFactor: number
  textScale: number
  pageHeight: number
}

/** When this process came up: stamped into the discovery file with the pid. */
const STARTED_AT = new Date().toISOString()

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
    // The owner is named, so a reader can tell a live file from a crashed
    // run's leftover, and two instances (now refused by the single-instance
    // lock, but a packaged app and a dev build once fought over this file)
    // can be told apart.
    writeFileSync(this.file, JSON.stringify({ port, token: this.token, pid: process.pid, startedAt: STARTED_AT }), { mode: 0o600 })
  }

  /**
   * The running app's stance while control is off and nobody has been asked
   * anything: discoverable, not callable. Written at boot (the default),
   * and by the chip's Stop and the settings toggle — all of them turn
   * control off without answering any consent bar, so a later launch
   * attempt must still be free to knock (§2c) rather than being silently
   * refused as though the user had said "Not now" (see `writeDeclined`).
   */
  writeDisabled(): void {
    rmSync(this.file, { force: true })
    writeFileSync(this.file, JSON.stringify({ enabled: false, pid: process.pid, startedAt: STARTED_AT }), { mode: 0o600 })
  }

  /**
   * The running app's stance once the user has actually answered a consent
   * bar with "Not now" (spec §2c/§2d). Distinct from `writeDisabled`: only
   * this stance tells `ensureLive` (src/mcp/control.ts) to stop launching
   * and stop re-asking until control is turned back on or the app quits.
   */
  writeDeclined(): void {
    rmSync(this.file, { force: true })
    writeFileSync(this.file, JSON.stringify({ enabled: false, pid: process.pid, startedAt: STARTED_AT, declined: true }), { mode: 0o600 })
  }

  /**
   * Stops the server. The file is not removed but rewritten as a disabled
   * stance: a client that finds it knows the app is up and the user turned
   * control off, and asks in the app rather than launching a second one.
   * Synchronous on purpose, like `shutdown`.
   */
  stop(): void {
    const server = this.server
    this.server = null
    this.token = ''
    if (server) {
      server.closeAllConnections()
      server.close()
    }
    this.writeDisabled()
  }

  /** Quit: the file must not outlive the process. */
  shutdown(): void {
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
        return reply(200, { ok: true, ...this.deps.status(), tabs: this.deps.tabs().tabs })

      case 'tabs':
        return reply(200, { ok: true, ...this.deps.tabs() })

      case 'openTab': {
        const req = parseOpenTab(payload)
        if (typeof req === 'string') return reply(400, { error: req })
        // The same allowlist `navigate` applies, checked the same way in the
        // same place: `navigate`'s scheme check already lives here, so
        // `openTab` reuses that pattern instead of a second one, applying it
        // here on the url `parseOpenTab` already validated for shape.
        if (req.url !== undefined) {
          const bad = urlSchemeError(req.url)
          if (bad) return reply(400, { error: bad })
        }
        const id = this.deps.openTab()
        if (id === null) return reply(409, { error: `the app is at its tab limit (${this.deps.tabs().maxTabs}); close one first` })
        // The new tab is in front now, so the ordinary apply/navigate paths
        // land on it exactly as they would for a command with no payload.
        if (req.preset !== undefined) this.deps.apply({ presetId: req.preset })
        let loading = false
        if (req.url !== undefined) loading = !(await this.deps.navigate(req.url)).loaded
        return reply(200, { ok: true, id, ...(loading ? { loading: true } : {}) })
      }

      case 'activateTab': {
        const req = parseTabId(payload)
        if (typeof req === 'string') return reply(400, { error: req })
        if (!this.deps.activateTab(req.id)) return reply(404, { error: `no tab ${req.id}; see \`tabs\`` })
        return reply(200, { ok: true, id: req.id })
      }

      case 'closeTab': {
        const req = parseTabId(payload)
        if (typeof req === 'string') return reply(400, { error: req })
        const r = this.deps.closeTab(req.id)
        if (!r.ok) return reply(409, { error: r.error })
        return reply(200, { ok: true, closed: req.id, active: r.activeId })
      }

      case 'navigate': {
        const url = payload.url
        if (typeof url !== 'string' || url.trim() === '') return reply(400, { error: 'navigate payload must be { url: string }' })
        // The same allowlist the MCP tools apply: the app's own URL bar stays
        // the only surface that can reach another scheme.
        const bad = urlSchemeError(url)
        if (bad) return reply(400, { error: bad })
        // A page that never finishes loading (ads) is answered as it stands:
        // the URL, and `loading: true`, rather than the caller's guard firing
        // and blaming the app.
        const nav = await this.deps.navigate(url.trim())
        return reply(200, { ok: true, url: nav.url, ...(nav.loaded ? {} : { loading: true }) })
      }

      case 'setPreset': {
        const err = presetApplyError(payload.id)
        if (err) return reply(400, { error: err })
        const pageBack = this.pageBack()
        return this.applyAndConfirm({ presetId: payload.id as string }, s => s.presetId === payload.id && pageBack(s))
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

      case 'setPanes': {
        const err = panesApplyError(payload.panes)
        if (err) return reply(400, { error: err })
        const panes = payload.panes as 'both' | 'target'
        return this.applyAndConfirm({ panes }, s => s.panes === panes)
      }

      case 'setOrientation': {
        const err = orientationApplyError(payload.orientation)
        if (err) return reply(400, { error: err })
        const orientation = payload.orientation as Orientation
        const pageBack = this.pageBack()
        return this.applyAndConfirm({ orientation }, s => s.orientation === orientation && pageBack(s))
      }

      case 'setTextScale': {
        const err = textScaleApplyError(payload.textScale)
        if (err) return reply(400, { error: err })
        const textScale = payload.textScale as number
        return this.applyAndConfirm({ textScale }, s => s.textScale === textScale)
      }

      case 'setThrottle': {
        const err = throttleApplyError(payload.throttle)
        if (err) return reply(400, { error: err })
        const throttle = payload.throttle as string
        return this.applyAndConfirm({ throttle }, s => s.throttle === throttle)
      }

      case 'setOnionSkin': {
        const err = onionSkinApplyError(payload.onionSkin)
        if (err) return reply(400, { error: err })
        const onionSkin = payload.onionSkin as number
        // The renderer turns the skin off again when main cannot render a
        // reference for the viewport, so the confirmation is the value or
        // off — and off is what the agent reads back.
        return this.applyAndConfirm({ onionSkin }, s => s.onionSkin === onionSkin || s.onionSkin === 0)
      }

      case 'captureVisible': {
        const capture = await this.deps.captureVisible()
        return reply(200, { ok: true, ...capture })
      }

      case 'captureTarget': {
        const capture = await this.deps.captureTarget()
        return reply(200, { ok: true, ...capture })
      }

      case 'captureRaster': {
        const capture = await this.deps.captureRaster()
        return reply(200, { ok: true, ...capture })
      }

      case 'inspect': {
        const req = parseInspectRequest(payload)
        if (typeof req === 'string') return reply(400, { error: req })
        const readout = await this.deps.inspect(req)
        return reply(200, { ok: true, found: readout !== null, readout })
      }

      case 'audit': {
        const req = parseAuditRequest(payload)
        if (typeof req === 'string') return reply(400, { error: req })
        const result = await this.deps.audit(req)
        if (!result) return reply(409, { error: unansweredMeasureMessage('audit', this.deps.askOutcome?.() ?? 'answered') })
        return reply(200, { ok: true, ...result })
      }

      case 'lint': {
        const req = parseLintRequest(payload)
        if (typeof req === 'string') return reply(400, { error: req })
        const result = await this.deps.lint(req)
        if (!result) return reply(409, { error: unansweredMeasureMessage('lint', this.deps.askOutcome?.() ?? 'answered') })
        return reply(200, { ok: true, ...result })
      }

      case 'scroll': {
        const req = parseScrollRequest(payload)
        if (typeof req === 'string') return reply(400, { error: req })
        // `scrolled` is the point of the round-trip: a page whose root cannot
        // scroll (an app shell with an inner scroller) used to answer a bare
        // `ok: true` while nothing moved, which no caller could tell from a
        // real scroll. Null means the pane did not confirm in time — honest,
        // and still not an error: the scroll may well have landed.
        const result = await this.deps.scroll(req)
        if (!result) return reply(200, { ok: true, scrolled: null, warnings: ['scroll offset could not be confirmed'] })
        return reply(200, {
          ok: true,
          scrolled: { x: result.x, y: result.y },
          scroller: result.scroller,
          atEnd: result.atEnd,
          // Only when true — the two cases the live walk acts on; an ordinary
          // page's reply keeps its shape, and an older preload sends neither.
          ...(result.hidden === true ? { hidden: true } : {}),
          ...(result.panel === true ? { panel: true } : {}),
          ...(result.dialog === true ? { dialog: true } : {}),
          ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
        })
      }

      case 'panTo': {
        // Same shape and rules as a scroll offset: finite, non-negative.
        const pos = parseScrollPos(payload)
        if (!pos) return reply(400, { error: 'panTo payload must be { x, y } with finite, non-negative target-pixel coordinates' })
        this.deps.apply({ panTo: pos })
        return reply(200, { ok: true })
      }

      case 'click': {
        const click = parseClick(payload, this.deps.viewport())
        if (typeof click === 'string') return reply(400, { error: click })
        // The click lands in the live page, so it can navigate — which then
        // mirrors between the panes exactly like a user click would.
        this.deps.click(click)
        return reply(200, { ok: true })
      }

      case 'highlight': {
        const parsed = parseHighlight(payload)
        if (typeof parsed === 'string') return reply(400, { error: parsed })
        const { space, ...highlight } = parsed
        if (space === 'page') {
          // An audit finding's rect: mapped through what the target shows
          // now, so the agent never reads the scroll back to do it.
          const view = await this.deps.targetView()
          const pane = pageRectToPane(highlight, view)
          if (!pane) {
            return reply(200, {
              ok: true,
              drawn: false,
              warnings: [
                `the page rect is off screen at the current scroll (${view.scrollX}, ${view.scrollY}); scroll it into view first`,
              ],
            })
          }
          this.deps.apply({ highlight: { ...pane, durationMs: highlight.durationMs } })
          return reply(200, { ok: true, drawn: true, pane })
        }
        this.deps.apply({ highlight })
        return reply(200, { ok: true, drawn: true, pane: { x: highlight.x, y: highlight.y, width: highlight.width, height: highlight.height } })
      }

      case 'back':
        this.deps.back()
        return reply(200, { ok: true })

      case 'forward':
        this.deps.forward()
        return reply(200, { ok: true })

      case 'reload':
        // Answered once the target has loaded again (bounded), so a capture
        // after it in the same drive shows the reloaded page.
        await this.deps.reload()
        return reply(200, { ok: true })

      case 'setPixelExact': {
        const err = pixelExactApplyError(payload.on)
        if (err) return reply(400, { error: err })
        this.deps.apply({ pixelExact: payload.on as boolean })
        return reply(200, { ok: true })
      }

      case 'setVision': {
        const err = visionApplyError(payload.type, payload.severity)
        if (err) return reply(400, { error: err })
        this.deps.apply({
          visionType: payload.type as VisionType,
          // Omitted means "the strong form", which is what a caller naming a
          // type and nothing else is asking to see.
          visionSeverity: typeof payload.severity === 'number' ? payload.severity : 1,
        })
        return reply(200, { ok: true })
      }

      case 'focusWindow':
        this.deps.focusWindow()
        return reply(200, { ok: true })
    }
  }

  /**
   * Forwards a patch to the renderer and waits (bounded) for the UI mirror to
   * reflect it, so a 200 means "applied", not "sent". `applied: false` after
   * the wait is not an error — the renderer may be busy — the caller can poll
   * `status`.
   */
  /**
   * A preset or a rotation recreates the offscreen target and reloads its
   * page, and the renderer confirms the change before the new target has a
   * page: a status read in that beat says `url: ''` — or `about:blank`, the
   * new target's own first page — with `loading: false`: no page and none
   * coming (measured on every preset change; the blank variant on a live
   * snap that flipped HN to a phone and reported `url: "about:blank"`). When
   * the tab had a page, confirm that it is back or on its way too; the apply
   * budget bounds the wait as before.
   */
  private pageBack(): (s: StatusReport) => boolean {
    const before = this.deps.status().url
    const had = before !== '' && before !== 'about:blank'
    return s => !had || (s.url !== '' && s.url !== 'about:blank') || s.loading
  }

  private async applyAndConfirm(patch: AgentApplyPatch, confirmed: (s: StatusReport) => boolean): Promise<Reply> {
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
