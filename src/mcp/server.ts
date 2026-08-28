import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { DEFAULT_TIMEOUT_MS } from '../cli/args'
import { parseControlStatus } from '../shared/control'
import { PANEL_PROFILES, SCREEN_PRESETS } from '../shared/presets'
import { MAX_SCROLL_SELECTOR } from '../shared/types'
import { normalizeUrl } from '../shared/url'
import { controlCall, discoverControl, type LiveApp } from './control'
import {
  APP_NOT_REACHABLE,
  MAX_INLINE_IMAGE_BYTES,
  PANE_CAPTURE_HEADLESS_NOTE,
  UsageError,
  buildDiffArgs,
  buildSnapArgs,
  extractTrailingJson,
  killBudgetMs,
  listCatalog,
  planSnapPath,
  shouldInlineImage,
  stderrTail,
  urlSchemeError,
  type DiffToolInput,
  type SnapMode,
  type SnapToolInput,
} from './lib'

/**
 * Obsrv MCP server (stdio, stateless): three read-only tools wrapping the
 * headless CLI. Rendering stays in `bin/obsrv.js` — it already owns signals,
 * per-run user-data isolation, temp-dir cleanup and crash fast-fail — the
 * server only maps tool input to argv, spawns, and shapes the result.
 * Launched by `bin/obsrv-mcp.js` from the build at `out/mcp/server.js`.
 */

const REPO_ROOT = resolve(__dirname, '..', '..')
const CLI_BIN = join(REPO_ROOT, 'bin', 'obsrv.js')

const VERSION = ((): string => {
  try {
    return (JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
})()

// --- CLI process plumbing ----------------------------------------------------

interface CliRun {
  code: number | null
  stdout: string
  stderr: string
  killed: boolean
}

/** Grace between SIGTERM and SIGKILL for a run that ignores the former. */
const SIGKILL_GRACE_MS = 10_000

/**
 * Spawns `node bin/obsrv.js <args>`; SIGTERMs a wedged run after
 * `killAfterMs`, and SIGKILLs it if it still has not exited after
 * SIGKILL_GRACE_MS more.
 */
function runCli(args: string[], killAfterMs: number): Promise<CliRun> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [CLI_BIN, ...args], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let killed = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const timer = setTimeout(() => {
      killed = true
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), SIGKILL_GRACE_MS)
    }, killAfterMs)
    child.stdout.on('data', d => (stdout += String(d)))
    child.stderr.on('data', d => (stderr += String(d)))
    child.on('error', err => {
      clearTimeout(timer)
      clearTimeout(killTimer)
      fail(err)
    })
    child.on('close', code => {
      clearTimeout(timer)
      clearTimeout(killTimer)
      done({ code, stdout, stderr, killed })
    })
  })
}

const toolError = (text: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text }] })

function cliFailure(command: 'snap' | 'diff', run: CliRun, killAfterMs: number): CallToolResult {
  if (run.killed) {
    return toolError(
      `obsrv ${command} did not exit within ${killAfterMs} ms and was terminated. ` +
        `Raise timeoutMs, or try a smaller preset / non-full-page snap. ` +
        (run.stderr.trim() ? `stderr: ${stderrTail(run.stderr)}` : 'No stderr output.'),
    )
  }
  return toolError(`obsrv ${command} failed (exit ${run.code ?? 'unknown'}): ${stderrTail(run.stderr)}`)
}

/** An inline image block for a PNG within the cap, else a text block saying why not. */
async function imageOrNote(pngPath: string, label: string, suggestion: string): Promise<CallToolResult['content'][number]> {
  const png = await readFile(pngPath)
  if (shouldInlineImage(png.byteLength)) {
    return { type: 'image', data: png.toString('base64'), mimeType: 'image/png' }
  }
  return {
    type: 'text',
    text:
      `${label} is ${png.byteLength} bytes — over the ${MAX_INLINE_IMAGE_BYTES}-byte inline cap, so it is not ` +
      `inlined. Read the file at ${pngPath} instead${suggestion ? `, or ${suggestion}` : ''}.`,
  }
}

// --- schemas -----------------------------------------------------------------

const PRESET_IDS = SCREEN_PRESETS.map(p => p.id) as [string, ...string[]]
const PROFILE_IDS = PANEL_PROFILES.map(p => p.id) as [string, ...string[]]

const urlField = z
  .string()
  .min(1)
  .describe('Page to render: an http://, https:// or file:// URL (bare hosts also work). Other schemes are rejected.')
const profileField = z
  .enum(PROFILE_IDS)
  .optional()
  .describe('Panel simulation (contrast floor, gamut, bit depth, brightness). Default: reference (off).')

const snapInputShape = {
  url: urlField,
  preset: z
    .enum(PRESET_IDS)
    .optional()
    .describe('Screen preset id (list them with obsrv_presets). Mutually exclusive with width/height. Default: 1080p-24.'),
  width: z.number().int().min(1).optional().describe('Custom CSS viewport width in px. Needs height; mutually exclusive with preset.'),
  height: z.number().int().min(1).optional().describe('Custom CSS viewport height in px. Needs width.'),
  deviceScaleFactor: z
    .number()
    .min(1)
    .optional()
    .describe('Raster density for custom dims (device px per CSS px, default 1). Device pixels are capped at 4096 per axis.'),
  diagonalInches: z.number().min(0.1).optional().describe('Simulated panel diagonal in inches, for custom dims.'),
  profile: profileField,
  fullPage: z.boolean().optional().describe('Capture the full page height (device px capped at 4096; a warning reports clamping).'),
  waitMs: z.number().int().min(0).optional().describe('Extra settle time after load, in ms, for late-settling content. Default 0.'),
  timeoutMs: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(`Per-render budget for load + paint quiescence, in ms. Default ${DEFAULT_TIMEOUT_MS}.`),
  mode: z
    .enum(['auto', 'headless', 'live'])
    .optional()
    .describe(
      'auto (default): drive the visible Obsrv app when it is open with Agent control on, else render headlessly. ' +
        'live: require the app (error if unreachable). headless: never touch the app.',
    ),
  capture: z
    .enum(['window', 'pane'])
    .optional()
    .describe(
      "Live mode only: what the returned PNG shows — 'window' (default) is the whole app window, 'pane' is the " +
        'rendered screen cropped to itself, so a minified mobile preset is phone-shaped rather than a small phone ' +
        'in a large rectangle. Ignored (with a note) when the render is headless.',
    ),
}

const snapOutputShape = {
  mode: z
    .enum(['headless', 'live'])
    .describe('How the snap was produced: a headless render, or a capture of the visible Obsrv app window (live drive).'),
  out: z.string().optional().describe('Headless only: PNG path the CLI wrote (same file as pngPath).'),
  preset: z.string().optional().describe('Headless only: preset id, or "custom" for width/height runs.'),
  cssWidth: z.number().optional().describe('Headless only: applied CSS viewport width.'),
  cssHeight: z.number().optional().describe('Headless only: applied CSS viewport height (grown under fullPage).'),
  deviceScaleFactor: z.number().optional().describe('Headless only.'),
  profile: z.string().optional().describe('Headless only: applied panel profile id.'),
  settled: z
    .boolean()
    .describe(
      'Headless: the page went paint-quiet and every pixel painted. False is still a usable capture — a page that ' +
        'kept animating, or one whose repaint never completed, is returned as-is with a warning saying what was ' +
        'missing. Live: the app confirmed the navigation before the capture (trivially true when the app was ' +
        'already showing the URL and nothing was navigated).',
    ),
  navigated: z
    .boolean()
    .optional()
    .describe(
      'Live only: false when the app was already showing this URL, so no reload was issued and the capture kept ' +
        'the current scroll position, pan and in-page state. True when the app was pointed somewhere new — that is ' +
        'a fresh load, which starts at the top of the page.',
    ),
  warnings: z.array(z.string()),
  pngPath: z.string().describe('Absolute path of the captured PNG (kept in a per-call temp dir).'),
  url: z.string().optional().describe('Live only: the URL the app reports showing.'),
  presetId: z.string().optional().describe('Live only: the screen preset selected in the app.'),
  profileId: z.string().optional().describe('Live only: the panel profile selected in the app.'),
  viewMode: z.string().optional().describe("Live only: the app's target-pane view (1:1 or fit)."),
  panes: z.string().optional().describe("Live only: 'both' (native pane beside the target) or 'target' (the target render has the whole window)."),
  tabId: z.string().optional().describe('Live only: which of the app\'s tabs was captured (the active one). Empty from an app older than tabs.'),
  tabIndex: z.number().optional().describe("Live only: that tab's 0-based position in the strip."),
  width: z
    .number()
    .optional()
    .describe(
      'Live only: captured width in device-independent px (the app window, or the target pane under capture: ' +
        '"pane"); the PNG raster is this times the display scale.',
    ),
  height: z
    .number()
    .optional()
    .describe(
      'Live only: captured height in device-independent px (the app window, or the target pane under capture: ' +
        '"pane"); the PNG raster is this times the display scale.',
    ),
}

const diffInputShape = {
  url: urlField,
  preset: z
    .enum(PRESET_IDS)
    .optional()
    .describe('Screen preset id — 1x presets only (e.g. laptop-768, 1080p-24); dense presets are refused. Default: 1080p-24.'),
  profile: profileField,
  includeImages: z
    .boolean()
    .optional()
    .describe('Also inline target.png and reference.png as images (each subject to the 1.5 MiB cap). Default: paths only.'),
  waitMs: z.number().int().min(0).optional().describe('Extra settle time after load, in ms, applied to both renders. Default 0.'),
  timeoutMs: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(`Per-render budget for load + paint quiescence, in ms. Default ${DEFAULT_TIMEOUT_MS}.`),
}

const diffOutputShape = {
  settled: z
    .boolean()
    .describe(
      'False when either render was a best-effort capture of a page that never stopped painting. The two captures ' +
        'are then different frames, so the band deltas are frame-to-frame noise rather than rendering evidence — ' +
        '`findings` says so instead of interpreting them.',
    ),
  warnings: z.array(z.string()).describe('Anything either render warned about, prefixed target: / reference:.'),
  url: z.string(),
  preset: z.string(),
  profile: z.string(),
  // Always present: buildDiffArgs unconditionally passes --out-dir, and the
  // CLI writes both PNGs whenever it is given one.
  files: z
    .object({ target: z.string(), reference: z.string() })
    .describe('PNGs on the same 1x grid, kept in a per-call temp dir.'),
  inkCoverage: z
    .object({ target: z.number(), reference: z.number(), delta: z.number() })
    .describe('Fraction of pixels darker than the ink threshold; negative delta = the 1x render is losing ink.'),
  rows: z
    .object({ target: z.number(), reference: z.number(), ratio: z.number().nullable() })
    .describe('Ink rows: target on the 1x raster, reference on the raw 2x raster. Ratio ≈0.5 is normal glyph scaling.'),
  bands: z.array(
    z.object({ y0: z.number(), y1: z.number(), targetInk: z.number(), referenceInk: z.number(), delta: z.number() }),
  ),
  findings: z.array(z.string()).describe('Humanised per-band findings. Informational — thresholds are the caller\'s job.'),
}

const presetsOutputShape = {
  presets: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      group: z.string(),
      cssWidth: z.number(),
      cssHeight: z.number(),
      deviceScaleFactor: z.number(),
      diagonalInches: z.number(),
      ppi: z.number().describe('Physical pixel density of the simulated panel (device px per inch).'),
    }),
  ),
  profiles: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      contrastRatio: z.number().nullable(),
      gamutCoverage: z.number(),
      bits: z.number(),
      frc: z.boolean(),
      nits: z.number().nullable(),
      summary: z.string(),
    }),
  ),
}

const driveInputShape = {
  url: z
    .string()
    .min(1)
    .optional()
    .describe('Navigate the app (both panes) to this http://, https:// or file:// URL (bare hosts also work).'),
  preset: z.enum(PRESET_IDS).optional().describe('Apply this screen preset, exactly as clicking the toolbar would.'),
  profile: z.enum(PROFILE_IDS).optional().describe('Apply this panel profile in the app.'),
  viewMode: z.enum(['1:1', 'fit']).optional().describe("Switch the app's target pane between 1:1 (actual size) and fit."),
  panes: z
    .enum(['both', 'target'])
    .optional()
    .describe(
      "Show both panes, or give the target render the whole window ('target'). Solo target is usually what you want before a capture.",
    ),
  pixelExact: z.boolean().optional().describe("Toggle the toolbar's pixel-exact checkbox (pins the magnification to the host scale)."),
  focus: z.boolean().optional().describe('true: bring the Obsrv window to the front first, so the user sees what follows.'),
  reload: z.boolean().optional().describe('true: reload both panes (the same action as the toolbar reload).'),
  back: z.boolean().optional().describe('true: history back (native pane history; the target mirrors the committed page).'),
  forward: z.boolean().optional().describe('true: history forward (native pane history; the target mirrors it).'),
  scroll: z
    .object({
      x: z.number().min(0),
      y: z.number().min(0),
      scrollSelector: z
        .string()
        .min(1)
        .max(MAX_SCROLL_SELECTOR)
        .optional()
        .describe(
          'Escape hatch: a CSS selector naming the element to scroll, for pages whose scroll host the automatic ' +
            'detection misjudges (several large scrollers, a virtualised list that translates content). No fallback ' +
            'if it matches nothing — the result says so. Same reach as the detection: light DOM of the top-level ' +
            'document only, so a scroller inside a shadow root or an iframe cannot be targeted.',
        ),
    })
    .optional()
    .describe(
      'Scroll both panes to this absolute page offset in CSS px. Pages whose root cannot scroll (app shells with ' +
        '`html, body { overflow: hidden }` and an inner `overflow-y: auto` container) are handled: the largest ' +
        'visible inner scroller is found and scrolled instead. Check `scrolled` in the result for the offset ' +
        'actually reached — that is how you tell a real scroll from one that clamped.',
    ),
  panTo: z
    .object({ x: z.number().min(0), y: z.number().min(0) })
    .optional()
    .describe("Centre this target-pane pixel (device px of the render) in the pane's 1:1 view; from fit this jumps to 1:1 there."),
  click: z
    .object({ x: z.number().min(0), y: z.number().min(0) })
    .optional()
    .describe('Left-click the live page at these CSS-viewport coordinates (may navigate; refused outside the viewport).'),
  highlight: z
    .object({
      x: z.number().min(0),
      y: z.number().min(0),
      width: z.number().min(1),
      height: z.number().min(1),
      durationMs: z.number().optional(),
    })
    .optional()
    .describe(
      'Draw a temporary neutral marker over this target-pixel rect in the pane (durationMs default 2000, clamped ' +
        '250-10000). A new highlight replaces the previous one.',
    ),
  capture: z
    .enum(['window', 'pane'])
    .optional()
    .describe(
      "Capture the app after the commands run: 'pane' crops to the rendered screen itself (the render, not the " +
        "empty pane around it — a minified mobile preset comes back phone-shaped), 'window' takes the whole app " +
        'window. The capture waits for a preset resize to finish first, so the PNG matches the status beside it. ' +
        'This is how you see a scrolled or panned state — unlike obsrv_snap, nothing is navigated, so the scroll ' +
        'position survives. The PNG comes back inline when it is within the 1.5 MiB cap, and always as pngPath.',
    ),
}

const driveOutputShape = {
  version: z.string().describe('The running app version.'),
  url: z.string().describe('The URL the target pane reports showing.'),
  presetId: z.string(),
  profileId: z.string(),
  viewMode: z.string(),
  panes: z.string(),
  mode: z.string().describe("The app's pane mode: 'url' (live page) or 'image' (a dropped design export)."),
  tabId: z
    .string()
    .describe(
      'Which of the app\'s tabs this acted on. Every command resolves the active tab as it arrives, so a tabId ' +
        'that changed between two calls means the user switched tabs under you. Empty string from an app older ' +
        'than tabs, which has only one.',
    ),
  tabIndex: z.number().describe('That tab\'s 0-based position in the strip.'),
  scrolled: z
    .object({ x: z.number(), y: z.number() })
    .nullable()
    .optional()
    .describe(
      'Only when `scroll` was requested: the offset the target pane actually reached, read back after the write. ' +
        'Less than you asked for means the content clamped (short page, or the wrong scroller). Null means the ' +
        'pane did not confirm in time — the scroll may still have landed.',
    ),
  scroller: z
    .enum(['root', 'element'])
    .optional()
    .describe("Only when `scroll` was requested: 'root' if the document scrolled, 'element' if an inner scroll container did."),
  warnings: z.array(z.string()).optional().describe('Anything worth knowing about the commands that ran (e.g. a scrollSelector that matched nothing).'),
  pngPath: z.string().optional().describe('Only when `capture` was requested: absolute path of the PNG (kept in a per-call temp dir).'),
  width: z
    .number()
    .optional()
    .describe('Only when `capture` was requested: captured width in device-independent px; the raster is this times the display scale.'),
  height: z
    .number()
    .optional()
    .describe('Only when `capture` was requested: captured height in device-independent px.'),
}

// --- live drive --------------------------------------------------------------

/** Budget for one control `status` round-trip once the app is known live. */
const LIVE_STATUS_TIMEOUT_MS = 2_000
/** Budget for a preset/profile/view-mode apply (the server confirms, bounded). */
const LIVE_APPLY_TIMEOUT_MS = 5_000
/** Budget for `captureVisible` (a full-window PNG over loopback). */
const LIVE_CAPTURE_TIMEOUT_MS = 30_000
/** How long a live snap waits for `status.url` to reflect the navigation. */
const LIVE_SETTLE_MS = 5_000
/**
 * How long an `obsrv_drive` click waits for a navigation it may have caused,
 * so the returned status reflects it. Deliberately short: most clicks do not
 * navigate, and every non-navigating one pays this in full.
 */
const CLICK_SETTLE_MS = 2_000
const CLICK_SETTLE_POLL_MS = 250

function liveFailure(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return (
    `${msg}. If the Obsrv app was closed or Agent control was toggled off mid-call, ` +
    `re-open the app and re-enable the toolbar toggle — or pass mode: "headless".`
  )
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/**
 * One short grace before a live capture: the renderer repaints the pane a
 * frame or two after the store confirms, and a capture racing that would show
 * a half-applied flip.
 */
const LIVE_CAPTURE_GRACE_MS = 300

/**
 * Is the app already showing this page? Compared as parsed URLs so a request
 * for `http://host:5173` matches the `http://host:5173/` the browser commits,
 * and through the same normaliser the URL bar uses so a bare host works too.
 * Anything unparseable falls back to a trimmed string compare.
 */
function sameUrl(a: string, b: string): boolean {
  const norm = (raw: string): string => {
    const t = raw.trim()
    if (t === '') return ''
    try {
      return new URL(normalizeUrl(t)).href
    } catch {
      return t
    }
  }
  const x = norm(a)
  const y = norm(b)
  return x !== '' && x === y
}

interface LiveCapture {
  pngPath: string
  width: number
  height: number
  warnings: string[]
}

/**
 * Capture the app window — or just the target pane — over the control server
 * and write it to a per-call temp PNG. Shared by the live `obsrv_snap` path
 * and `obsrv_drive`'s `capture`, so both produce byte-identical results.
 */
async function liveCapture(info: LiveApp['info'], what: 'window' | 'pane'): Promise<LiveCapture> {
  // `pane` crops to the target pane; both answer with the same
  // { data, width, height } shape plus their own warnings (e.g. the pre-mount
  // full-window fallback), which join the tool's.
  const command = what === 'pane' ? 'captureTarget' : 'captureVisible'
  const capture = await controlCall(info, command, {}, LIVE_CAPTURE_TIMEOUT_MS)
  const { data, width, height } = capture
  if (typeof data !== 'string' || typeof width !== 'number' || typeof height !== 'number') {
    throw new Error('the control server returned a malformed capture')
  }
  const warnings: string[] = []
  if (Array.isArray(capture['warnings'])) {
    for (const w of capture['warnings']) if (typeof w === 'string') warnings.push(w)
  }
  const dir = await mkdtemp(join(tmpdir(), 'obsrv-mcp-'))
  const pngPath = join(dir, 'live.png')
  await writeFile(pngPath, Buffer.from(data, 'base64'))
  return { pngPath, width, height, warnings }
}

/**
 * The live `obsrv_snap` path: point the visible app at the URL (plus
 * preset/profile when given), wait — bounded — for it to report the
 * navigation, then capture the window exactly as the user sees it.
 *
 * When the app is already showing that URL the navigation is skipped entirely.
 * A navigate is a fresh `loadURL`, which resets the scroll position, so
 * reloading here would make `obsrv_drive { scroll }` followed by a snap of the
 * same page always capture the top. `navigated: false` says which happened.
 */
async function liveSnap(app: LiveApp, input: SnapToolInput, notes: string[]): Promise<CallToolResult> {
  const { info } = app
  const warnings = [...notes]
  const before = app.status.url
  // Already there? Then leave the page alone — see the note above.
  const navigated = !sameUrl(before, input.url)
  let applied = before
  try {
    if (navigated) {
      // The navigate command answers once both panes finished loading, so it
      // carries the same per-render budget the headless path polices.
      const nav = await controlCall(info, 'navigate', { url: input.url.trim() }, (input.timeoutMs ?? DEFAULT_TIMEOUT_MS) + 10_000)
      applied = typeof nav['url'] === 'string' ? nav['url'] : ''
    }
    if (input.preset !== undefined) await controlCall(info, 'setPreset', { id: input.preset }, LIVE_APPLY_TIMEOUT_MS)
    if (input.profile !== undefined) await controlCall(info, 'setProfile', { id: input.profile }, LIVE_APPLY_TIMEOUT_MS)
  } catch (e) {
    return toolError(liveFailure(e))
  }

  // The app settles when it reports the applied URL — or, after a redirect,
  // any committed non-blank URL that is no longer the pre-navigation one.
  // Nothing to settle when no navigation was issued; one status read still
  // refreshes the preset/profile/view the result reports.
  let status = app.status
  let settled = !navigated
  const deadline = Date.now() + LIVE_SETTLE_MS
  for (;;) {
    try {
      const s = parseControlStatus(await controlCall(info, 'status', {}, LIVE_STATUS_TIMEOUT_MS))
      if (s) {
        status = s
        if (navigated) settled = s.url === applied || (applied !== '' && s.url !== before && s.url !== 'about:blank')
      }
    } catch (e) {
      return toolError(liveFailure(e))
    }
    if (settled || Date.now() >= deadline) break
    await sleep(250)
  }
  if (!settled) warnings.push('the app did not confirm the navigation before capture; the PNG may show the previous page.')

  await sleep(LIVE_CAPTURE_GRACE_MS)

  let capture: LiveCapture
  try {
    capture = await liveCapture(info, input.capture === 'pane' ? 'pane' : 'window')
  } catch (e) {
    return toolError(liveFailure(e))
  }
  warnings.push(...capture.warnings)
  const { pngPath, width, height } = capture

  const structured = {
    mode: 'live',
    url: status.url,
    presetId: status.presetId,
    profileId: status.profileId,
    viewMode: status.viewMode,
    panes: status.panes,
    tabId: status.tabId,
    tabIndex: status.tabIndex,
    width,
    height,
    settled,
    navigated,
    warnings,
    pngPath,
  }
  return {
    content: [
      { type: 'text', text: JSON.stringify(structured, null, 2) },
      await imageOrNote(pngPath, 'The captured app window', 'read the file at pngPath'),
    ],
    structuredContent: structured,
  }
}

// --- server ------------------------------------------------------------------

const server = new McpServer({ name: 'obsrv-mcp-server', version: VERSION })

server.registerTool(
  'obsrv_snap',
  {
    title: 'Render a URL on a target screen',
    description:
      `Render a URL headlessly at a target screen's true raster density — a real 1x raster for laptop/desktop ` +
      `presets, the device's 2x/3x DPR plus mobile UA and viewport semantics for phone presets — optionally ` +
      `through a cheap-panel simulation, and return the PNG. Use it to judge how a page actually looks on the ` +
      `screens users own (1366×768 laptops, 1080p desktops, budget Androids) before declaring frontend work done.\n\n` +
      `Pass either \`preset\` (list ids with obsrv_presets) or custom \`width\` + \`height\`, never both. ` +
      `Returns structured metadata (applied viewport, profile, \`settled\`, warnings, and \`pngPath\` — the PNG ` +
      `kept in a per-call temp dir) plus the PNG as an inline image when it is within the 1.5 MiB cap; larger ` +
      `captures (typically fullPage) stay on disk with a note.\n\n` +
      `Live drive: when the Obsrv desktop app is open with its "Agent control" toolbar toggle on, \`mode: "auto"\` ` +
      `(the default) drives the *visible* app instead — the user watches the URL load and the preset flip, and the ` +
      `returned PNG is the app window as they see it (\`mode: "live"\` in the result; \`mode: "headless"\` ` +
      `otherwise). \`capture: "pane"\` crops a live capture to just the target pane (headless renders ignore it ` +
      `with a note). Custom width/height and \`fullPage\` always render headlessly (with a note); \`waitMs\` is ` +
      `ignored in live mode. \`mode: "live"\` errors when the app is not reachable; \`mode: "headless"\` never ` +
      `touches it. Note: although this tool is annotated read-only (it renders and captures), a live snap steers ` +
      `the open app window — navigating it and flipping its preset in front of the user — as its means of ` +
      `capture; that visible steering is the point of live mode.\n\n` +
      `A live snap only navigates when the app is showing a different URL; the result's \`navigated\` says which ` +
      `happened. Navigating is a fresh load, so it starts at the top of the page — to photograph a scrolled or ` +
      `panned state, use obsrv_drive with \`capture\` instead, which never navigates unless you ask it to.`,
    inputSchema: snapInputShape,
    outputSchema: snapOutputShape,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  async (input: SnapToolInput & { mode?: SnapMode }): Promise<CallToolResult> => {
    const badScheme = urlSchemeError(input.url)
    if (badScheme) return toolError(badScheme)

    // The live path first (spec §14 "Live drive"): a reachable control-enabled
    // app wins under auto, is required under live, and is never probed under
    // headless. planSnapPath documents the fallback rules.
    const requestedMode = input.mode ?? 'auto'
    let liveNotes: string[] = []
    if (requestedMode !== 'headless') {
      const live = await discoverControl()
      const plan = planSnapPath(input, requestedMode, live !== null)
      if ('error' in plan) return toolError(plan.error)
      if (plan.path === 'live' && live) return liveSnap(live, input, plan.notes)
      liveNotes = plan.notes
    } else if (input.capture === 'pane') {
      liveNotes = [PANE_CAPTURE_HEADLESS_NOTE]
    }

    const dir = await mkdtemp(join(tmpdir(), 'obsrv-mcp-'))
    const pngPath = join(dir, 'snap.png')
    let args: string[]
    try {
      args = buildSnapArgs({ ...input, url: input.url.trim() }, pngPath)
    } catch (e) {
      await rm(dir, { recursive: true, force: true })
      if (e instanceof UsageError) return toolError(e.message)
      throw e
    }
    const killAfterMs = killBudgetMs(1, input.timeoutMs ?? DEFAULT_TIMEOUT_MS, input.waitMs ?? 0)
    const run = await runCli(args, killAfterMs)
    if (run.killed || run.code !== 0) return cliFailure('snap', run, killAfterMs)
    const meta = extractTrailingJson(run.stdout)
    if (!meta) return toolError(`obsrv snap exited 0 but printed unparseable JSON: ${stderrTail(run.stdout)}`)

    const cliWarnings = Array.isArray(meta['warnings']) ? (meta['warnings'] as string[]) : []
    const structured = { ...meta, mode: 'headless', warnings: [...cliWarnings, ...liveNotes], pngPath }
    return {
      content: [
        { type: 'text', text: JSON.stringify(structured, null, 2) },
        await imageOrNote(pngPath, 'The captured PNG', 'retry without fullPage / with a smaller preset for an inline image'),
      ],
      structuredContent: structured,
    }
  },
)

server.registerTool(
  'obsrv_diff',
  {
    title: 'Diff a 1x render against its 2x reference',
    description:
      `Numerically compare how a URL renders on a 1x screen against a 2x reference (the same CSS viewport at ` +
      `dsf 2 — what a HiDPI dev sees — box-downsampled onto the target's 1x grid). Use it to confirm suspected ` +
      `low-DPI legibility problems: thinning strokes, weakening hairlines, fading grey text.\n\n` +
      `Returns ink coverage for target and reference (negative delta = the 1x render is losing ink), ink-row ` +
      `counts and their ratio (≈0.5 is normal glyph scaling; a hairline contributes one row at any density), ` +
      `8 horizontal band deltas with humanised findings (informational — apply your own thresholds), and the ` +
      `paths of target.png / reference.png in a per-call temp dir. \`includeImages: true\` also inlines both ` +
      `PNGs (1.5 MiB cap each).\n\n` +
      `Check \`settled\` before believing the bands: a page that never stops painting (animation, video) yields ` +
      `two captures of *different frames*, so every delta is frame-to-frame noise. When it is false the numbers ` +
      `are still returned but \`findings\` says so instead of interpreting them.\n\n` +
      `1x presets only (e.g. laptop-768, 1080p-24): dense presets (phones) and CSS viewports over 2048px are ` +
      `refused with an explanatory error — use obsrv_snap for those.\n\n` +
      `Headless-only: a diff always performs its own two renders and never drives a running Obsrv app window ` +
      `(the comparison needs both rasters, which the visible app cannot show) — use obsrv_snap or obsrv_drive ` +
      `for live drive.`,
    inputSchema: diffInputShape,
    outputSchema: diffOutputShape,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  async (input: DiffToolInput & { includeImages?: boolean | undefined }): Promise<CallToolResult> => {
    const badScheme = urlSchemeError(input.url)
    if (badScheme) return toolError(badScheme)
    const dir = await mkdtemp(join(tmpdir(), 'obsrv-mcp-'))
    const args = buildDiffArgs(
      { url: input.url.trim(), preset: input.preset, profile: input.profile, waitMs: input.waitMs, timeoutMs: input.timeoutMs },
      dir,
    )
    // Two renders per diff: the target and its 2x reference.
    const killAfterMs = killBudgetMs(2, input.timeoutMs ?? DEFAULT_TIMEOUT_MS, input.waitMs ?? 0)
    const run = await runCli(args, killAfterMs)
    if (run.killed || run.code !== 0) return cliFailure('diff', run, killAfterMs)
    const metrics = extractTrailingJson(run.stdout)
    if (!metrics) return toolError(`obsrv diff exited 0 but printed unparseable JSON: ${stderrTail(run.stdout)}`)

    const content: CallToolResult['content'] = [{ type: 'text', text: JSON.stringify(metrics, null, 2) }]
    if (input.includeImages) {
      const files = metrics['files'] as { target: string; reference: string }
      content.push({ type: 'text', text: 'target.png (the 1x render, profile applied):' })
      content.push(await imageOrNote(files.target, 'target.png', ''))
      content.push({ type: 'text', text: 'reference.png (the 2x render downsampled onto the 1x grid):' })
      content.push(await imageOrNote(files.reference, 'reference.png', ''))
    }
    return { content, structuredContent: metrics }
  },
)

server.registerTool(
  'obsrv_drive',
  {
    title: 'Drive the visible Obsrv app',
    description:
      `Drive the Obsrv desktop app the user is looking at: navigate it to a URL, apply a screen preset, a panel ` +
      `profile, the target pane's 1:1/fit view or pixel-exact toggle — each exactly as clicking the toolbar would ` +
      `— and steer the session like a guided demo: focus the window, step history (back/forward/reload), scroll ` +
      `both panes, pan the target pane to a pixel, click the live page, and highlight a rect with a temporary ` +
      `neutral marker, all while the user watches.\n\n` +
      `Only the supplied inputs run (none = just read the current state), in this fixed order: focus → url → ` +
      `preset → profile → viewMode → panes → pixelExact → reload → back → forward → scroll → panTo → click → highlight → ` +
      `capture. ` +
      `The result is the final status: app version, the URL showing, and the selected preset/profile/view. A ` +
      `click that navigates is reflected in that status — the call waits briefly (up to 2 s) for the commit. A ` +
      `scroll adds \`scrolled\` (the offset actually reached) and \`scroller\` ('root' or 'element'): compare ` +
      `\`scrolled\` with what you asked for rather than trusting the call's success, and use \`scroll.scrollSelector\` ` +
      `when the automatic scroll-host detection picks the wrong container.\n\n` +
      `Coordinates: click takes CSS-viewport px of the page (the valid range is 0 up to but not including the ` +
      `viewport size); panTo and highlight take target-pane pixels (device px of the render — identical to CSS px ` +
      `on 1x presets); scroll takes page CSS px.\n\n` +
      `Pass \`capture\` to get a PNG back once the commands have run. Nothing in this tool navigates unless you ` +
      `pass \`url\`, so this is how you photograph a scrolled or panned state: scroll, then capture, in one call. ` +
      `obsrv_snap is the other way round — it points the app at a URL first, and pointing it somewhere new is a ` +
      `fresh load that starts at the top.\n\n` +
      `Requires the app to be open with its "Agent control" toolbar toggle on; errors otherwise. This tool ` +
      `mutates visible app state (it changes what the user's window shows, and a click can act on the live page).`,
    inputSchema: driveInputShape,
    outputSchema: driveOutputShape,
    // Honest annotation: this changes what the user's window is showing.
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (input: {
    url?: string
    preset?: string
    profile?: string
    viewMode?: '1:1' | 'fit'
    panes?: 'both' | 'target'
    pixelExact?: boolean
    focus?: boolean
    reload?: boolean
    back?: boolean
    forward?: boolean
    scroll?: { x: number; y: number; scrollSelector?: string }
    panTo?: { x: number; y: number }
    click?: { x: number; y: number }
    highlight?: { x: number; y: number; width: number; height: number; durationMs?: number }
    capture?: 'window' | 'pane'
  }): Promise<CallToolResult> => {
    if (input.url !== undefined) {
      const badScheme = urlSchemeError(input.url)
      if (badScheme) return toolError(badScheme)
    }
    const live = await discoverControl()
    if (!live) return toolError(APP_NOT_REACHABLE)
    try {
      // The documented execution order: window attention first, then what is
      // showing, then how it is shown, then the in-page steering.
      if (input.focus) await controlCall(live.info, 'focusWindow', {}, LIVE_APPLY_TIMEOUT_MS)
      if (input.url !== undefined) {
        await controlCall(live.info, 'navigate', { url: input.url.trim() }, DEFAULT_TIMEOUT_MS + 10_000)
      }
      if (input.preset !== undefined) await controlCall(live.info, 'setPreset', { id: input.preset }, LIVE_APPLY_TIMEOUT_MS)
      if (input.profile !== undefined) await controlCall(live.info, 'setProfile', { id: input.profile }, LIVE_APPLY_TIMEOUT_MS)
      if (input.viewMode !== undefined) {
        await controlCall(live.info, 'setViewMode', { mode: input.viewMode }, LIVE_APPLY_TIMEOUT_MS)
      }
      if (input.panes !== undefined) {
        await controlCall(live.info, 'setPanes', { panes: input.panes }, LIVE_APPLY_TIMEOUT_MS)
      }
      if (input.pixelExact !== undefined) {
        await controlCall(live.info, 'setPixelExact', { on: input.pixelExact }, LIVE_APPLY_TIMEOUT_MS)
      }
      if (input.reload) await controlCall(live.info, 'reload', {}, LIVE_APPLY_TIMEOUT_MS)
      if (input.back) await controlCall(live.info, 'back', {}, LIVE_APPLY_TIMEOUT_MS)
      if (input.forward) await controlCall(live.info, 'forward', {}, LIVE_APPLY_TIMEOUT_MS)
      // The scroll answer is the interesting half: it reports the offset the
      // pane reached, which is the only way to tell a scroll from a clamp.
      let scrolled: { x: number; y: number } | null | undefined
      let scroller: 'root' | 'element' | undefined
      const warnings: string[] = []
      if (input.scroll !== undefined) {
        const r = await controlCall(live.info, 'scroll', input.scroll, LIVE_APPLY_TIMEOUT_MS)
        const at = r['scrolled']
        scrolled =
          at !== null && typeof at === 'object' && typeof (at as { x?: unknown }).x === 'number' && typeof (at as { y?: unknown }).y === 'number'
            ? { x: (at as { x: number }).x, y: (at as { y: number }).y }
            : null
        if (r['scroller'] === 'root' || r['scroller'] === 'element') scroller = r['scroller']
        if (Array.isArray(r['warnings'])) for (const w of r['warnings'] as unknown[]) if (typeof w === 'string') warnings.push(w)
      }
      if (input.panTo !== undefined) await controlCall(live.info, 'panTo', input.panTo, LIVE_APPLY_TIMEOUT_MS)
      if (input.click !== undefined) {
        // A click may navigate. Note the URL first, then wait — bounded and
        // short, the same settle idea as a live snap — for the status to move
        // off it, so the returned status reflects what the click did. A click
        // that navigates nowhere simply rides out the short deadline.
        const before = parseControlStatus(await controlCall(live.info, 'status', {}, LIVE_STATUS_TIMEOUT_MS))?.url ?? ''
        await controlCall(live.info, 'click', input.click, LIVE_APPLY_TIMEOUT_MS)
        const deadline = Date.now() + CLICK_SETTLE_MS
        for (;;) {
          const s = parseControlStatus(await controlCall(live.info, 'status', {}, LIVE_STATUS_TIMEOUT_MS))
          if (s && s.url !== before && s.url !== 'about:blank') break
          if (Date.now() >= deadline) break
          await sleep(CLICK_SETTLE_POLL_MS)
        }
      }
      if (input.highlight !== undefined) await controlCall(live.info, 'highlight', input.highlight, LIVE_APPLY_TIMEOUT_MS)

      // Capture last, so the PNG shows everything the commands above did.
      // Nothing here navigates, so a scroll or pan applied in this same call
      // is still in place when the shutter fires.
      let capture: LiveCapture | null = null
      if (input.capture !== undefined) {
        await sleep(LIVE_CAPTURE_GRACE_MS)
        capture = await liveCapture(live.info, input.capture)
        warnings.push(...capture.warnings)
      }

      const status = parseControlStatus(await controlCall(live.info, 'status', {}, LIVE_STATUS_TIMEOUT_MS))
      if (!status) return toolError('the control server returned a malformed status')
      const structured = {
        ...status,
        ...(input.scroll !== undefined ? { scrolled: scrolled ?? null } : {}),
        ...(scroller !== undefined ? { scroller } : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
        ...(capture !== null ? { pngPath: capture.pngPath, width: capture.width, height: capture.height } : {}),
      }
      const content: CallToolResult['content'] = [{ type: 'text', text: JSON.stringify(structured, null, 2) }]
      if (capture !== null) {
        const label = input.capture === 'pane' ? 'The captured target pane' : 'The captured app window'
        content.push(await imageOrNote(capture.pngPath, label, 'read the file at pngPath'))
      }
      return { content, structuredContent: structured }
    } catch (e) {
      return toolError(liveFailure(e))
    }
  },
)

server.registerTool(
  'obsrv_presets',
  {
    title: 'List screen presets and panel profiles',
    description:
      `List every screen preset (id, label, group, CSS dims, deviceScaleFactor, panel diagonal, derived physical ` +
      `ppi) and panel profile (id, label, simulation params) accepted by obsrv_snap and obsrv_diff. Read straight ` +
      `from the app's preset table — nothing is rendered.`,
    inputSchema: {},
    outputSchema: presetsOutputShape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (): Promise<CallToolResult> => {
    const catalog = listCatalog()
    return {
      content: [{ type: 'text', text: JSON.stringify(catalog, null, 2) }],
      structuredContent: { ...catalog },
    }
  },
)

// --- boot --------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // stdout is the protocol channel; the one boot line goes to stderr.
  process.stderr.write(`obsrv-mcp-server ${VERSION} running on stdio\n`)
}

main().catch((e: unknown) => {
  process.stderr.write(`obsrv-mcp: fatal: ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
