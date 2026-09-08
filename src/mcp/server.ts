import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { THROTTLE_IDS, THROTTLE_PROFILES } from '../shared/throttle'
import { MAX_TEXT_SCALE, MIN_TEXT_SCALE } from '../shared/textScale'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { DEFAULT_REPORT_MATRIX, DEFAULT_TAP_MM, DEFAULT_TEXT_MM, DEFAULT_TIMEOUT_MS } from '../cli/args'
import { parseControlStatus, HIGHLIGHT_DURATION_DEFAULT_MS, HIGHLIGHT_DURATION_MAX_MS} from '../shared/control'
import { PANEL_PROFILES, SCREEN_PRESETS } from '../shared/presets'
import { MAX_SCROLL_SELECTOR } from '../shared/types'
import { normalizeUrl } from '../shared/url'
import { controlCall, ensureLive, type LiveApp } from './control'
import { walkPage, type WalkDeps, type Walked } from './walk'
import {
  inlineNote,
  concurrencyLimit,
  createGate,
  queueNote,
  UsageError,
  buildAuditArgs,
  buildLintArgs,
  buildInspectArgs,
  inspectWhereError,
  type InspectToolInput,
  buildDiffArgs,
  buildReportArgs,
  buildSnapArgs,
  extractTrailingJson,
  killBudgetMs,
  listCatalog,
  liveModeError,
  planLive,
  planSnapPath,
  shouldInlineImage,
  stderrTail,
  urlSchemeError,
  type AuditToolInput,
  type LintToolInput,
  type DiffToolInput,
  type ReportToolInput,
  type SnapMode,
  type SnapToolInput,
} from './lib'
import { DEFAULT_THIN_PX, LINT_RULES, listTruncationNote, unwalkedImageNote, type LintFinding } from '../cli/lint'

/**
 * Obsrv MCP server (stdio, stateless): read-only tools wrapping the headless
 * CLI (snap, diff, audit, presets), plus `obsrv_drive` for the visible app. Rendering stays in `bin/obsrv.js` — it already owns signals,
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
  /** How long the run waited for a render slot before it was spawned. */
  queuedMs: number
}

/**
 * At most this many CLI runs at once (see `concurrencyLimit`): each is its
 * own Electron, and nine in parallel starved two of them past their load
 * budget. The rest wait in order; the kill budget starts when a run spawns,
 * not when it was asked for.
 */
const RENDER_LIMIT = concurrencyLimit()
const renderGate = createGate(RENDER_LIMIT)

/** The queue's sentence for a run that waited, for the result's warnings or notes; nothing under a second. */
const queued = (run: CliRun): string[] => {
  const note = queueNote(run.queuedMs, RENDER_LIMIT)
  return note === null ? [] : [note]
}

/** Grace between SIGTERM and SIGKILL for a run that ignores the former. */
const SIGKILL_GRACE_MS = 10_000

/**
 * Spawns `node bin/obsrv.js <args>`; SIGTERMs a wedged run after
 * `killAfterMs`, and SIGKILLs it if it still has not exited after
 * SIGKILL_GRACE_MS more.
 */
function runCli(args: string[], killAfterMs: number): Promise<CliRun> {
  return renderGate.run(
    () =>
      new Promise((done, fail) => {
        const queuedMs = renderGate.lastQueuedMs
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
          done({ code, stdout, stderr, killed, queuedMs })
        })
      }),
  )
}

const toolError = (text: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text }] })

function cliFailure(command: 'snap' | 'diff' | 'audit' | 'report' | 'inspect' | 'lint', run: CliRun, killAfterMs: number): CallToolResult {
  if (run.killed) {
    return toolError(
      `obsrv ${command} did not exit within ${killAfterMs} ms and was terminated. ` +
        `Raise timeoutMs, or try a smaller preset / non-full-page snap. ` +
        (run.stderr.trim() ? `stderr: ${stderrTail(run.stderr)}` : 'No stderr output.'),
    )
  }
  return toolError(`obsrv ${command} failed (exit ${run.code ?? 'unknown'}): ${stderrTail(run.stderr)}`)
}

/**
 * The PNG as an inline image block when it is within the cap; past it, a text
 * block saying why not — and the same sentence as `note`, for the caller to
 * put in the JSON's warnings beside `inlined: false`, so a reader of the
 * structured result alone is told too.
 */
async function inlineImage(
  pngPath: string,
  label: string,
  suggestion: string,
): Promise<{ block: CallToolResult['content'][number]; inlined: boolean; note: string | null }> {
  const png = await readFile(pngPath)
  const note = inlineNote(png.byteLength, pngPath, suggestion)
  if (note === null) return { block: { type: 'image', data: png.toString('base64'), mimeType: 'image/png' }, inlined: true, note }
  return { block: { type: 'text', text: `${label}: ${note}.` }, inlined: false, note }
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

const orientationField = z
  .enum(['portrait', 'landscape'])
  .optional()
  .describe(
    'Rotate the screen a quarter turn (default portrait). Presets store their natural orientation — ' +
      'portrait for every mobile preset, landscape for the monitors and laptops — and this swaps the CSS ' +
      "viewport's two axes on top of that. Nothing else changes: the diagonal, raster density and physical " +
      'size are orientation-independent, so it is the same panel turned sideways. Use it to check a ' +
      'landscape phone layout, or a monitor stood on end.',
  )

const throttleField = z
  .enum(THROTTLE_IDS)
  .optional()
  .describe(
    'Network and CPU conditions for the render, as Chrome DevTools presets them: ' +
      THROTTLE_PROFILES.map(t => `${t.id} (${t.summary})`).join('; ') +
      '. Default: none. Given, the result carries `settledMs` — the time from navigation to the page going ' +
      'paint-quiet — which is how the page feels on that screen; ask for `none` too for a baseline to compare against.',
  )

const snapInputShape = {
  url: urlField,
  preset: z
    .enum(PRESET_IDS)
    .optional()
    .describe('Screen preset id (list them with obsrv_presets). Mutually exclusive with width/height. Default: 1080p-24.'),
  orientation: orientationField,
  width: z.number().int().min(1).optional().describe('Custom CSS viewport width in px. Needs height; mutually exclusive with preset.'),
  height: z.number().int().min(1).optional().describe('Custom CSS viewport height in px. Needs width.'),
  deviceScaleFactor: z
    .number()
    .min(1)
    .optional()
    .describe('Raster density for custom dims (device px per CSS px, default 1). Device pixels are capped at 4096 per axis.'),
  diagonalInches: z.number().min(0.1).optional().describe('Simulated panel diagonal in inches, for custom dims.'),
  textScale: z
    .number()
    .min(MIN_TEXT_SCALE)
    .max(MAX_TEXT_SCALE)
    .optional()
    .describe(
      'Browser zoom as reflow, e.g. 1.5 for a user at 150% (default 1). The page lays out in 1/textScale of the CSS ' +
        'viewport at textScale times the density — what a larger-text setting or a Windows panel at 150% does — ' +
        'and the PNG stays the screen\'s size.',
    ),
  throttle: throttleField,
  profile: profileField,
  fullPage: z
    .boolean()
    .optional()
    .describe(
      'Capture the whole page: the viewport stays the screen\'s and the page is captured a screenful at a time (up to twelve) and stitched, including a page that scrolls an inner container rather than the window. Chrome stuck to the viewport (a fixed or sticky header, a cookie bar) is hidden for the bands after the first, so it appears once and the page rows behind it are not lost; on a page that scrolls an inner container the same is done for chrome stuck inside that container. Headless only.',
    ),
  singleSurface: z
    .boolean()
    .optional()
    .describe(
      'With fullPage: one viewport as tall as the page instead (device px capped at 4096). Faster and never repeats a sticky header, but a page sized against the viewport lays out differently on a surface that tall, and a page that scrolls an inner container comes back as one screen.',
    ),
  keepStuckChrome: z
    .boolean()
    .optional()
    .describe(
      'With fullPage: leave chrome stuck to the viewport in every band, as the capture used to. Use it to see what a scroller sees at every depth; the default hides it, which shows the page once and recovers the rows behind it.',
    ),
  tiled: z.boolean().optional().describe('Accepted and ignored: banding is what fullPage does now.'),
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
      'auto (default): drive the visible Obsrv app, launching it if it is not running; headless only when asked, ' +
        'when the operation needs it (fullPage, custom dims), when there is no display, or when the user has turned ' +
        'agent control off in the app — the result says which (`why`). live: require the app (error naming the reason). ' +
        'headless: never touch the app.',
    ),
  capture: z
    .enum(['window', 'pane', 'raster'])
    .optional()
    .describe(
      "Live mode only: what the returned PNG shows — 'window' (default) is the whole app window, 'pane' is the " +
        'rendered screen cropped to itself, so a minified mobile preset is phone-shaped rather than a small phone ' +
        'in a large rectangle. Ignored (with a note) when the render is headless.',
    ),
}

const snapOutputShape = {
  tiled: z.boolean().optional().describe('Only with `fullPage`: whether the page was captured in bands (false only under `singleSurface`).'),
  bands: z.number().optional().describe('Only with `fullPage`: how many bands the page was captured in.'),
  stuckChrome: z
    .array(z.object({ element: z.string(), position: z.string(), top: z.number(), height: z.number() }))
    .optional()
    .describe('Only with `fullPage`: chrome hidden for the bands after the first, each with the selector, its `position` and its box. Empty when the page has none, or under `keepStuckChrome`.'),
  mode: z
    .enum(['headless', 'live'])
    .describe('How the snap was produced: a headless render, or a capture of the visible Obsrv app window (live drive).'),
  why: z
    .enum(['requested', 'headless-only', 'no-display', 'declined', 'launch-timeout'])
    .optional()
    .describe(
      'Only when mode is headless: why. requested (you asked), headless-only (fullPage / custom dims), no-display ' +
        '(nowhere for a window), declined (the user turned agent control off in the app — ask them), launch-timeout ' +
        '(the app was launched but did not answer in time; the next call will likely find it).',
    ),
  launched: z.boolean().optional().describe('True on the one call that launched the Obsrv app. Tell the user once: a window has opened.'),
  out: z.string().optional().describe('Headless only: PNG path the CLI wrote (same file as pngPath).'),
  preset: z.string().optional().describe('Headless only: preset id, or "custom" for width/height runs.'),
  cssWidth: z
    .number()
    .optional()
    .describe('Applied CSS viewport width, already rotated. Headless: grown under fullPage. Live: what the app is rendering.'),
  cssHeight: z
    .number()
    .optional()
    .describe('Applied CSS viewport height, already rotated. Headless: grown under fullPage. Live: what the app is rendering.'),
  orientation: z
    .string()
    .optional()
    .describe(
      "Live only: the app's rotation flag — 'portrait' (the preset as its table stores it) or 'landscape' " +
        '(rotated a quarter turn). See `screenShape` for the shape that produced. Headless runs report the ' +
        'applied `cssWidth`/`cssHeight` instead, which say the same thing exactly.',
    ),
  screenShape: z.string().optional().describe('Live only. ' + "The shape the screen actually has: 'portrait' or 'landscape'. Derived from the CSS dimensions, not from " +
        "the `orientation` flag beside it — the flag means 'the preset as its table stores it' vs 'rotated a " +
        "quarter turn', so for a landscape-natural monitor preset the two diverge (a fresh 1080p-24 tab is " +
        "orientation 'portrait' on a 1920x1080 landscape screen). Report this word to the user, not the flag."),
  deviceScaleFactor: z.number().optional().describe('Headless only.'),
  textScale: z.number().optional().describe('Browser zoom as reflow the page was rendered at. Present only when a scale other than 1 was applied.'),
  throttle: z.string().optional().describe('Headless only, and only when `throttle` was given: the conditions applied.'),
  settledMs: z
    .number()
    .nullable()
    .optional()
    .describe(
      'Headless only, and only when `throttle` was given: ms from navigation to the page going paint-quiet (waitMs taken out). ' +
        'Null when it never settled within timeoutMs. Compare against a `none` run of the same page.',
    ),
  profile: z.string().optional().describe('Headless only: applied panel profile id.'),
  settled: z
    .boolean()
    .describe(
      'Headless: the page went paint-quiet and every pixel painted. False is still a usable capture — a page that ' +
        'kept animating, or one whose repaint never completed, is returned as-is with a warning saying what was ' +
        'missing. Live: the app confirmed the navigation before the capture — or, with nothing navigated, that ' +
        'the tab was neither blank nor loading (a preset flip reloads the page).',
    ),
  navigated: z
    .boolean()
    .optional()
    .describe(
      'Live only: false when the app was already showing this URL, so no reload was issued and the capture kept ' +
        'the current scroll position, pan and in-page state. True when the app was pointed somewhere new — that is ' +
        'a fresh load, which starts at the top of the page.',
    ),
  unsettledReason: z
    .enum(['animating', 'timeout', 'uncovered', 'loading'])
    .optional()
    .describe(
      "Only when settled is false: 'animating' — the page kept painting steadily after its first full frame, so the capture was taken " +
        "early (~2 s) rather than at the budget and waiting longer would not have helped; 'timeout' — still painting at the budget; " +
        "'uncovered' — part of the frame never painted within the budget; 'loading' — the load outran timeoutMs (under a " +
        "throttle a slow load is the point) and the PNG is what had painted, settledMs null: raise timeoutMs for the full load.",
    ),
  warnings: z.array(z.string()),
  pngPath: z.string().describe('Absolute path of the captured PNG (kept in a per-call temp dir).'),
  inlined: z
    .boolean()
    .describe('Whether the PNG came back as an inline image block. False past the 1.5 MiB cap (typically fullPage); a warning says so and names the path.'),
  url: z.string().optional().describe('Live only: the URL the app reports showing, read after the capture.'),
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
  throttle: throttleField,
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
  notes: z.array(z.string()).optional().describe('Only when there is something to say about the call itself, such as a wait for a render slot.'),
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

const PRESET_GROUP_ALIASES: Record<string, 'laptop' | 'desktop' | 'mobile'> = {
  laptop: 'laptop',
  laptops: 'laptop',
  desktop: 'desktop',
  desktops: 'desktop',
  mobile: 'mobile',
  phones: 'mobile',
  phone: 'mobile',
}

const presetsOutputShape = {
  throttles: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        network: z.object({ downloadBps: z.number(), uploadBps: z.number(), latencyMs: z.number() }).nullable(),
        cpuRate: z.number(),
        summary: z.string(),
      }),
    )
    .describe("The `throttle` values obsrv_snap, obsrv_diff, obsrv_audit and obsrv_report take: Chrome DevTools' presets.").optional(),
  orientation: z
    .string()
    .describe('How the cssWidth/cssHeight below relate to rotation, and how to ask for the other orientation.').optional(),
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
  ).optional(),
}

const driveInputShape = {
  tab: z
    .string()
    .optional()
    .describe(
      'Runs first. "new" opens a tab (with `url` and `preset` from this call, if given) and brings it to the front; a tab id ' +
        'from `tabs` brings that tab to the front. Either way the user is looking at the tab everything else in this call acts on.',
    ),
  url: z
    .string()
    .min(1)
    .optional()
    .describe('Navigate the app (both panes) to this http://, https:// or file:// URL (bare hosts also work).'),
  preset: z.enum(PRESET_IDS).optional().describe('Apply this screen preset, exactly as clicking the toolbar would.'),
  orientation: orientationField,
  textScale: z
    .number()
    .min(MIN_TEXT_SCALE)
    .max(MAX_TEXT_SCALE)
    .optional()
    .describe(
      "Set the target's text scale — browser zoom as reflow, 1 = none. The native pane and the other tabs " +
        'are untouched. An app older than text scale rejects the command.',
    ),
  throttle: z
    .enum(THROTTLE_IDS)
    .optional()
    .describe(
      "Set the target's network and CPU conditions in the app: " +
        THROTTLE_PROFILES.map(t => t.id).join(', ') +
        ' (see obsrv_presets → throttles). The user sees it in the footer and can turn it off from the side panel; ' +
        'it is not remembered across launches. An app older than the field rejects the command.',
    ),
  onionSkin: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      "The onion skin's opacity, 0 to 1 (0 = off): the same page rendered at HiDPI and blended over the target's raster " +
        "in the app, for seeing what the target screen's raster moved — a line wrapped differently, a hairline gone. " +
        'Read back in status; 0 when the app could not render a reference for the viewport (4K and ultrawide at 1x). ' +
        'Not remembered across launches. An app older than the field rejects the command.',
    ),
  profile: z.enum(PROFILE_IDS).optional().describe('Apply this panel profile in the app.'),
  viewMode: z.enum(['1:1', 'fit']).optional().describe("Switch the app's target pane between 1:1 (actual size) and fit."),
  panes: z
    .enum(['both', 'target'])
    .optional()
    .describe(
      "Show both panes, or give the target render the whole window ('target'). Solo target is usually what you want before a capture.",
    ),
  pixelExact: z.boolean().optional().describe("Toggle the toolbar's pixel-exact checkbox (pins the magnification to the host scale)."),
  vision: z
    .enum(['none', 'protan', 'deutan', 'tritan', 'achromat'])
    .optional()
    .describe(
      "Simulate a colour-vision deficiency on the target render: 'deutan' (green-weak, the most common), " +
        "'protan' (red-weak), 'tritan' (blue-yellow, rare), 'achromat' (no hue at all — the strongest test of " +
        "whether a UI relies on colour alone), or 'none' to turn it off. Applied after the panel simulation, " +
        'because the screen emits light and then the eye receives it. The target pane\'s footer names it while ' +
        'it is on, so a capture is never silently colour-shifted.',
    ),
  visionSeverity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      'How complete the deficiency is, 0..1 (default 1). This matters: full dichromacy is the rare end, and ' +
        'partial anomalous trichromacy — roughly 0.4-0.6 — is what most people with a colour deficiency have. ' +
        'Intermediate values are interpolated, so treat them as indicative rather than measured.',
    ),
  focus: z.boolean().optional().describe('true: bring the Obsrv window to the front first, so the user sees what follows.'),
  reload: z.boolean().optional().describe('true: reload both panes (the same action as the toolbar reload).'),
  back: z.boolean().optional().describe('true: history back (native pane history; the target mirrors the committed page).'),
  forward: z.boolean().optional().describe('true: history forward (native pane history; the target mirrors it).'),
  scroll: z
    .object({
      x: z.number().min(0).optional(),
      y: z.number().min(0).optional(),
      page: z.enum(['next', 'prev', 'top', 'bottom']).optional(),
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
      'Either { x, y } (absolute page CSS px) or { page: "next" | "prev" | "top" | "bottom" } (one screenful of ' +
        'the scroller, or an end) — not both. Pages whose root cannot scroll (app shells with ' +
        '`html, body { overflow: hidden }` and an inner `overflow-y: auto` container) are handled: the largest ' +
        'visible inner scroller is found and scrolled instead. Check `scrolled` and `atEnd` in the result: ' +
        '`scrolled` is the offset actually reached — that is how you tell a real scroll from one that clamped — ' +
        'and `atEnd` true is where a screenful-by-screenful review stops.',
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
      space: z
        .enum(['pane', 'page'])
        .optional()
        .describe(
          "The rect's space. 'pane' (default): target-pane device pixels of what is showing. 'page': the page's own CSS px with " +
            "scroll included — an obsrv_audit finding's rect or obsrv_inspect's pageRect, passed as they came; the app maps it " +
            'through the current scroll, text scale and density. The result says whether it was on screen (drawn) and the pane rect used.',
        ),
    })
    .optional()
    .describe(
      'Draw a temporary neutral marker over this target-pixel rect in the pane (durationMs default 2000, clamped ' +
        '250-10000). A new highlight replaces the previous one.',
    ),
  capture: z
    .enum(['window', 'pane', 'raster'])
    .optional()
    .describe(
      "Capture the app after the commands run: 'pane' crops to the rendered screen itself (the render, not the " +
        "empty pane around it — a minified mobile preset comes back phone-shaped), 'window' takes the whole app " +
        'window. The capture waits for a preset resize to finish first, so the PNG matches the status beside it. ' +
        'This is how you see a scrolled or panned state — unlike obsrv_snap, nothing is navigated, so the scroll ' +
        'position survives. The PNG comes back inline when it is within the 1.5 MiB cap, and always as pngPath.',
    ),
  closeTab: z
    .string()
    .optional()
    .describe(
      'Runs last, after `capture`: "current" closes the tab in front, an id closes that one. The last tab is refused. ' +
        'Photograph and close in one call.',
    ),
}

const driveOutputShape = {
  version: z.string().describe('The running app version.'),
  url: z.string().describe('The URL the target pane reports showing.'),
  presetId: z.string(),
  profileId: z.string(),
  textScale: z.number().describe('Browser zoom as reflow on the target, 1 = none. Reported as 1 by an app older than text scale.'),
  throttle: z.string().describe("The target's network and CPU conditions, a preset id; 'none' as the host. Reported as 'none' by an app older than the field."),
  onionSkin: z.number().describe("The onion skin's opacity, 0 = off. Reported as 0 by an app older than the field."),
  loading: z.boolean().describe('Whether the target is loading a document. Reported as false by an app older than the field.'),
  orientation: z
    .string()
    .describe(
      "The rotation flag: 'portrait' (the preset as its table stores it) or 'landscape' (rotated a quarter " +
        "turn). This is what to pass back to change it — for the shape the screen actually has, read " +
        '`screenShape`. Reported as \'portrait\' by an app older than rotation, which is what such an app shows.',
    ),
  screenShape: z.string().describe("The shape the screen actually has: 'portrait' or 'landscape'. Derived from the CSS dimensions, not from " +
        "the `orientation` flag beside it — the flag means 'the preset as its table stores it' vs 'rotated a " +
        "quarter turn', so for a landscape-natural monitor preset the two diverge (a fresh 1080p-24 tab is " +
        "orientation 'portrait' on a 1920x1080 landscape screen). Report this word to the user, not the flag."),
  cssWidth: z
    .number()
    .describe('The CSS viewport the target is rendering at, already rotated. 0 from an app that predates the field.'),
  cssHeight: z.number().describe('The CSS viewport height, already rotated. 0 from an app that predates the field.'),
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
  atEnd: z.boolean().optional().describe('Only when `scroll` was requested: the scroller can go no further down.'),
  highlight: z
    .object({ drawn: z.boolean(), pane: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional() })
    .optional()
    .describe('When a highlight was asked for: whether it was drawn, and the pane rect it landed on. With a capture in the same call it stays up until the shutter has fired.'),
  settled: z.boolean().optional().describe("With capture: 'raster', whether the target went paint-quiet for it."),
  unsettledReason: z.string().optional().describe("With capture: 'raster' and settled false: why (animating, timeout, uncovered)."),
  warnings: z.array(z.string()).optional().describe('Anything worth knowing about the commands that ran (e.g. a scrollSelector that matched nothing).'),
  pngPath: z.string().optional().describe('Only when `capture` was requested: absolute path of the PNG (kept in a per-call temp dir).'),
  inlined: z.boolean().optional().describe('Only when `capture` was requested: whether the PNG came back inline; false past the 1.5 MiB cap, with a warning naming the path.'),
  width: z
    .number()
    .optional()
    .describe('Only when `capture` was requested: captured width in device-independent px; the raster is this times the display scale.'),
  height: z
    .number()
    .optional()
    .describe('Only when `capture` was requested: captured height in device-independent px.'),
  tabs: z
    .array(z.object({ id: z.string(), url: z.string(), title: z.string(), presetId: z.string(), active: z.boolean() }))
    .describe('Every open tab, and which is in front. Empty from an app older than tabs.'),
  launched: z.boolean().optional().describe('True on the one call that launched the Obsrv app.'),
}

// --- live drive --------------------------------------------------------------

/** Budget for one control `status` round-trip once the app is known live. */
const LIVE_STATUS_TIMEOUT_MS = 2_000
/** Budget for a preset/profile/view-mode apply (the server confirms, bounded). */
const LIVE_APPLY_TIMEOUT_MS = 5_000
/** Budget for `captureVisible` (a full-window PNG over loopback). */
const LIVE_CAPTURE_TIMEOUT_MS = 30_000
/** A live audit walks the whole DOM of the page in front: bounded like a capture, not like an apply. */
const LIVE_AUDIT_TIMEOUT_MS = 20_000
/** The lint walks the whole DOM too. */
const LIVE_LINT_TIMEOUT_MS = 20_000
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

/** The walk's control calls, bound to the live app: every scroll gets the apply budget. */
const walkDeps = (info: LiveApp['info']): WalkDeps => ({
  call: (command, payload) => controlCall(info, command, payload, LIVE_APPLY_TIMEOUT_MS),
  sleep,
  now: Date.now,
})

const walkField = z
  .boolean()
  .optional()
  .describe(
    'Default true: before measuring, the page is scrolled a screenful at a time to the end and back to the top — ' +
      'live, so the user watching the window sees the whole page pass; live and headless alike, so lazy images ' +
      'load and late sections mount before they are judged. false: measure the page as it stands — for ' +
      're-measuring after a fix, or (live) a driven state: a scroll position, an open menu.',
  )

const walkedField = z
  .object({ screenfuls: z.number(), atEnd: z.boolean(), ms: z.number() })
  .optional()
  .describe(
    'When the page was walked before measuring: screenfuls scrolled, whether the end was reached (false when ' +
      'the 15 s budget ran out, or the page would not move — a warning says which, and lint counts the image ' +
      'findings below the height reached) and the time it took. Absent when the walk did not run — walk: false, ' +
      'or (live) an app older than 0.41.0 (a note says which). Two runs that disagree on a lazy-loading page ' +
      'differ here.',
  )

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
  /** The capture's own settle verdict, when the command reports one (raster does). */
  settled?: boolean
  unsettledReason?: string
}

/**
 * Capture the app window — or just the target pane — over the control server
 * and write it to a per-call temp PNG. Shared by the live `obsrv_snap` path
 * and `obsrv_drive`'s `capture`, so both produce byte-identical results.
 */
async function liveCapture(info: LiveApp['info'], what: 'window' | 'pane' | 'raster'): Promise<LiveCapture> {
  // `pane` crops to the target pane; both answer with the same
  // { data, width, height } shape plus their own warnings (e.g. the pre-mount
  // full-window fallback), which join the tool's.
  // `raster` is the target's own frame at device pixels, the view untouched.
  const command = what === 'pane' ? 'captureTarget' : what === 'raster' ? 'captureRaster' : 'captureVisible'
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
  const settled = typeof capture['settled'] === 'boolean' ? capture['settled'] : undefined
  const unsettledReason = typeof capture['unsettledReason'] === 'string' ? capture['unsettledReason'] : undefined
  return {
    pngPath,
    width,
    height,
    warnings,
    ...(settled !== undefined ? { settled } : {}),
    ...(unsettledReason !== undefined ? { unsettledReason } : {}),
  }
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
async function liveSnap(app: LiveApp, input: SnapToolInput, notes: string[], launched: boolean): Promise<CallToolResult> {
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
    if (input.orientation !== undefined) {
      await controlCall(info, 'setOrientation', { orientation: input.orientation }, LIVE_APPLY_TIMEOUT_MS)
    }
    if (input.textScale !== undefined) {
      await controlCall(info, 'setTextScale', { textScale: input.textScale }, LIVE_APPLY_TIMEOUT_MS)
    }
    if (input.throttle !== undefined) {
      await controlCall(info, 'setThrottle', { throttle: input.throttle }, LIVE_APPLY_TIMEOUT_MS)
    }
    if (input.profile !== undefined) await controlCall(info, 'setProfile', { id: input.profile }, LIVE_APPLY_TIMEOUT_MS)
  } catch (e) {
    return toolError(liveFailure(e))
  }

  // The app settles when it reports the applied URL — or, after a redirect,
  // any committed non-blank URL that is no longer the pre-navigation one.
  // With nothing navigated, a preset or rotation may still have recreated
  // the target and reloaded its page (the control confirms once that is
  // under way, not done): settle when the tab is neither blank nor loading.
  let status = app.status
  let settled = false
  const deadline = Date.now() + LIVE_SETTLE_MS
  for (;;) {
    try {
      const s = parseControlStatus(await controlCall(info, 'status', {}, LIVE_STATUS_TIMEOUT_MS))
      if (s) {
        status = s
        settled = navigated
          ? s.url === applied || (applied !== '' && s.url !== before && s.url !== 'about:blank')
          : !s.loading && s.url !== 'about:blank'
      }
    } catch (e) {
      return toolError(liveFailure(e))
    }
    if (settled || Date.now() >= deadline) break
    await sleep(250)
  }
  if (!settled) {
    warnings.push(
      navigated
        ? 'the app did not confirm the navigation before capture; the PNG may show the previous page.'
        : 'the app was still loading the page when the settle budget ran out; the PNG may show a transitional frame.',
    )
  }

  await sleep(LIVE_CAPTURE_GRACE_MS)

  let capture: LiveCapture
  try {
    capture = await liveCapture(info, input.capture ?? 'window')
  } catch (e) {
    return toolError(liveFailure(e))
  }
  warnings.push(...capture.warnings)
  const { pngPath, width, height } = capture

  // The status the PNG is reported with is read after the capture, which
  // waited for the page: read before it, between about:blank and the commit
  // of a preset flip's reload, `url` said about:blank while the PNG showed
  // the page (measured on HN, android-65).
  try {
    const after = parseControlStatus(await controlCall(info, 'status', {}, LIVE_STATUS_TIMEOUT_MS))
    if (after) status = after
  } catch (e) {
    return toolError(liveFailure(e))
  }
  const image = await inlineImage(pngPath, 'The captured app window', '')
  if (image.note !== null) warnings.push(image.note)

  const structured = {
    mode: 'live',
    url: status.url,
    presetId: status.presetId,
    profileId: status.profileId,
    orientation: status.orientation,
    screenShape: status.screenShape,
    textScale: status.textScale,
    throttle: status.throttle,
    onionSkin: status.onionSkin,
    loading: status.loading,
    cssWidth: status.cssWidth,
    cssHeight: status.cssHeight,
    viewMode: status.viewMode,
    panes: status.panes,
    tabId: status.tabId,
    tabIndex: status.tabIndex,
    width,
    height,
    settled,
    navigated,
    inlined: image.inlined,
    warnings,
    pngPath,
    ...(launched ? { launched: true } : {}),
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }, image.block],
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
      `Pass either \`preset\` (list ids with obsrv_presets) or custom \`width\` + \`height\`, never both; either can be ` +
      `rotated with \`orientation: "landscape"\`, which is how you check a phone's landscape layout. ` +
      `Returns structured metadata (applied viewport, profile, \`settled\`, warnings, and \`pngPath\` — the PNG ` +
      `kept in a per-call temp dir) plus the PNG as an inline image when it is within the 1.5 MiB cap ` +
      `(\`inlined: true\`); larger captures (typically fullPage) stay on disk, with \`inlined: false\` and a ` +
      `warning naming the path.\n\n` +
      `Live drive: \`mode: "auto"\` (the default) drives the *visible* app — the user watches the URL load and the ` +
      `preset flip — and launches the app if it is not running (\`launched: true\` on that call). The returned PNG ` +
      `is the app window as they see it (\`mode: "live"\` in the result; \`mode: "headless"\` otherwise, with ` +
      `\`why\` naming the reason). \`capture: "pane"\` crops a live capture to just the target pane (headless ` +
      `renders ignore it with a note). Custom width/height and \`fullPage\` always render headlessly (with a ` +
      `note); \`waitMs\` is ignored in live mode. \`mode: "live"\` errors when the app is not reachable, naming ` +
      `why; \`mode: "headless"\` never touches it. Note: although this tool is annotated read-only (it renders and ` +
      `captures), a live snap steers ` +
      `the open app window — navigating it and flipping its preset in front of the user — as its means of ` +
      `capture; that visible steering is the point of live mode.\n\n` +
      `A live snap only navigates when the app is showing a different URL; the result's \`navigated\` says which ` +
      `happened. Navigating is a fresh load, so it starts at the top of the page — to photograph a scrolled or ` +
      `panned state, use obsrv_drive with \`capture\` instead, which never navigates unless you ask it to.\n\n` +
      `Tabs: the app can hold several sessions open as tabs, and a live snap always acts on the one in front — this ` +
      `tool takes no parameter to pick a different one, and the user can change it at any moment. The result names ` +
      `it (\`tabId\`, \`tabIndex\`); compare across calls if you need to know it did not move. Use obsrv_drive to ` +
      `open, front or close tabs (its \`tab\` and \`closeTab\` inputs).`,
    inputSchema: snapInputShape,
    outputSchema: snapOutputShape,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  async (input: SnapToolInput & { mode?: SnapMode }): Promise<CallToolResult> => {
    const badScheme = urlSchemeError(input.url)
    if (badScheme) return toolError(badScheme)

    // The live path first (spec §14 "Live drive"): drives a reachable app,
    // launches an absent one under auto/live, and is never attempted under
    // headless. planSnapPath decides whether to try; ensureLive reconciles
    // that against reality (an already-live app, a decline, or a launch).
    const requestedMode = input.mode ?? 'auto'
    const plan = planSnapPath(input, requestedMode, process.env, process.platform)
    const resolved = await ensureLive(plan)
    if (resolved.path === 'live') return liveSnap(resolved.app, input, resolved.notes, resolved.launched)
    if (requestedMode === 'live') return toolError(liveModeError(resolved.why, resolved.notes))
    const liveNotes = resolved.notes
    const why = resolved.why

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
    const image = await inlineImage(pngPath, 'The captured PNG', 'retry without fullPage / with a smaller preset for an inline image')
    const structured = {
      ...meta,
      mode: 'headless',
      why,
      inlined: image.inlined,
      warnings: [...cliWarnings, ...liveNotes, ...(image.note === null ? [] : [image.note]), ...queued(run)],
      pngPath,
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }, image.block],
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
      content.push((await inlineImage(files.target, 'target.png', '')).block)
      content.push({ type: 'text', text: 'reference.png (the 2x render downsampled onto the 1x grid):' })
      content.push((await inlineImage(files.reference, 'reference.png', '')).block)
    }
    const structured = { ...metrics, ...(queued(run).length > 0 ? { notes: queued(run) } : {}) }
    content[0] = { type: 'text', text: JSON.stringify(structured, null, 2) }
    return { content, structuredContent: structured }
  },
)

const auditInputShape = {
  url: z
    .string()
    .min(1)
    .optional()
    .describe('Headless: required. Live: the app is navigated there first when given; omitted, the page it is showing is audited.'),
  mode: z
    .enum(['auto', 'headless', 'live'])
    .optional()
    .describe(
      "auto (default): a running Obsrv with agent control on is audited — the page the user is looking at, on the " +
        "screen and text scale in force — else a headless load of `url`. 'live' requires the app; 'headless' never touches it.",
    ),
  preset: z
    .enum(PRESET_IDS)
    .optional()
    .describe('Screen preset id (list them with obsrv_presets). Mutually exclusive with width/height. Default: 1080p-24.'),
  orientation: orientationField,
  width: z.number().int().min(1).optional().describe('Custom CSS viewport width in px. Needs height; mutually exclusive with preset.'),
  height: z.number().int().min(1).optional().describe('Custom CSS viewport height in px. Needs width.'),
  deviceScaleFactor: z.number().min(1).optional().describe('Raster density for custom dims (default 1).'),
  diagonalInches: z
    .number()
    .min(0.1)
    .optional()
    .describe('Panel diagonal in inches, for custom dims. Without it there are no millimetres and no findings.'),
  textScale: z
    .number()
    .min(MIN_TEXT_SCALE)
    .max(MAX_TEXT_SCALE)
    .optional()
    .describe(
      'Browser zoom as reflow, e.g. 1.5 for a user at 150% (default 1). The page lays out in 1/textScale of the CSS ' +
        'viewport at textScale times the density — what a larger-text setting or a Windows panel at 150% does — ' +
        'so every millimetre grows with it.',
    ),
  throttle: throttleField,
  tapMm: z
    .number()
    .min(0)
    .optional()
    .describe(`Flag interactive elements whose shorter side is under this many mm. Default ${DEFAULT_TAP_MM} (provisional).`),
  textMm: z
    .number()
    .min(0)
    .optional()
    .describe(`Flag text whose font size is under this many mm. Default ${DEFAULT_TEXT_MM} (provisional).`),
  walk: walkField,
  waitMs: z.number().int().min(0).optional().describe('Extra settle time after load, in ms, for late layout. Default 0.'),
  timeoutMs: z.number().int().min(1).optional().describe(`Load budget in ms. Default ${DEFAULT_TIMEOUT_MS}.`),
}

const auditGroupShape = z.object({
  count: z.number(),
  under: z.number().nullable().describe('Below the threshold; null when there was no diagonal to measure with.'),
  smallestPx: z.number().nullable(),
  smallestMm: z.number().nullable(),
})

const auditGroupRowShape = z.object({
  kind: z.enum(['small-target', 'small-text']),
  key: z.string().describe("What the members share: a control's CSS box, or a font size."),
  count: z.number(),
  exemplar: z.object({ element: z.string(), text: z.string(), rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }), mm: z.number() }),
  elements: z.array(z.string()).describe('Up to five distinct elements in the group.'),
})

const auditOutputShape = {
  mode: z.enum(['headless', 'live']),
  why: z
    .enum(['requested', 'headless-only', 'no-display', 'declined', 'launch-timeout'])
    .optional()
    .describe(
      'Only when mode is headless: why. requested (you asked), headless-only (custom dimensions), no-display ' +
        '(nowhere for a window), declined (the user turned agent control off in the app — ask them), launch-timeout ' +
        '(the app was launched but did not answer in time; the next call will likely find it).',
    ),
  launched: z.boolean().optional().describe('True on the one call that launched the Obsrv app. Tell the user once: a window has opened.'),
  walked: walkedField,
  url: z.string().describe('The page audited: the argument (headless) or what the app reports showing (live).'),
  preset: z.string().describe("Headless: preset id or 'custom'. Live: the app's preset."),
  tabId: z.string().optional().describe('Live: the tab that was measured.'),
  tabIndex: z.number().optional(),
  cssWidth: z.number(),
  cssHeight: z.number(),
  deviceScaleFactor: z.number(),
  textScale: z.number().optional().describe('Browser zoom as reflow the page was measured at. Present only when a scale other than 1 was applied.'),
  throttle: z.string().optional().describe('Only when `throttle` was given: the conditions the page loaded under.'),
  pageHeight: z.number().describe('The page\'s full height in CSS px; rects are page coordinates, so the audit covers all of it.'),
  ppi: z.number().nullable().describe('Device pixels per inch of the screen; null for custom dims without a diagonal.'),
  thresholds: z.object({ tapMm: z.number(), textMm: z.number() }),
  summary: z.object({ targets: auditGroupShape, text: auditGroupShape }),
  findings: z
    .array(
      z.object({
        kind: z.enum(['small-target', 'small-text']),
        element: z.string().describe('tag#id.first-class'),
        text: z.string(),
        rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
        mm: z.number().describe('The shorter side of a target, or the font size of text, in mm on this screen.'),
        cssWidth: z.number().optional(),
        cssHeight: z.number().optional(),
        fontSizePx: z.number().optional(),
      }),
    )
    .describe('Smallest first; at most 200 listed, the rest counted in truncated.findings.'),
  groups: z
    .array(auditGroupRowShape)
    .describe('The findings grouped by kind and size over every one counted: forty footer links of one height are one group with count 40. Quote a group, not its members.'),
  truncated: z.object({ findings: z.number(), targets: z.number(), text: z.number() }),
  warnings: z.array(z.string()),
  notes: z.array(z.string()),
}

type AuditHandlerInput = Omit<AuditToolInput, 'url'> & { url?: string | undefined; mode?: 'auto' | 'headless' | 'live'; walk?: boolean }

async function liveAudit(app: LiveApp, input: AuditHandlerInput, notes: string[], launched: boolean): Promise<CallToolResult> {
  const { info } = app
  try {
    if (input.url !== undefined) {
      await controlCall(info, 'navigate', { url: input.url.trim() }, DEFAULT_TIMEOUT_MS + 10_000)
    }
    // The person watching sees the page pass before the number arrives; on a
    // page that mounts sections on scroll, the number is of the whole page.
    let walked: Walked | undefined
    if (input.walk !== false) {
      const w = await walkPage(walkDeps(info))
      walked = w.walked
      notes.push(...w.notes)
    }
    const payload = {
      ...(input.tapMm !== undefined ? { tapMm: input.tapMm } : {}),
      ...(input.textMm !== undefined ? { textMm: input.textMm } : {}),
    }
    const answer = await controlCall(info, 'audit', payload, LIVE_AUDIT_TIMEOUT_MS)
    const status = parseControlStatus(await controlCall(info, 'status', {}, LIVE_APPLY_TIMEOUT_MS))
    if (!status) return toolError('the running app answered `status` with something this server could not parse')
    for (const k of ['preset', 'orientation', 'textScale', 'throttle', 'waitMs', 'timeoutMs'] as const) {
      if (input[k] !== undefined) notes.push(`\`${k}\` is headless-only and was ignored in live mode; the app's own ${k === 'preset' ? 'screen' : k} was used.`)
    }
    // The app answers with the CLI's own result plus the screen it
    // measured on. `textScale` and `throttle` keep the headless contract:
    // present only when something other than the default was in force.
    const { ok: _ok, textScale, ...measured } = answer
    const structured = {
      mode: 'live',
      url: status.url,
      preset: status.presetId,
      tabId: status.tabId,
      tabIndex: status.tabIndex,
      ...(walked !== undefined ? { walked } : {}),
      ...(typeof textScale === 'number' && textScale !== 1 ? { textScale } : {}),
      ...(status.throttle !== 'none' ? { throttle: status.throttle } : {}),
      ...measured,
      notes,
      ...(launched ? { launched: true } : {}),
    }
    return { content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }], structuredContent: structured }
  } catch (e) {
    return toolError(`the running app refused the audit: ${e instanceof Error ? e.message : String(e)}`)
  }
}

server.registerTool(
  'obsrv_audit',
  {
    title: 'Measure tap targets and text in millimetres on a target screen',
    description:
      `Load a URL on a target screen and measure, in millimetres on that screen, every interactive element ` +
      `(links styled as controls, buttons, form controls, interactive ARIA roles, focusable elements) and every ` +
      `element with text of its own. A 24 CSS px control is 6.6 mm on a 24" 1080p and 4.5 mm on a 6.5" phone; ` +
      `a CSS-pixel rule cannot say which of those a thumb can hit, and this can.\n\n` +
      `Returns per-group counts and smallest sizes, plus findings under the thresholds (\`tapMm\`, default 7 — ` +
      `between Apple's 44pt and WCAG 2.5.8's 24 CSS px — and \`textMm\`, default 2 — roughly 11px on a phone, 7px ` +
      `on a 1080p monitor; both provisional and stated in the output), smallest first. Inline links in running ` +
      `text are exempt from the target rule, as in WCAG 2.5.8. Layout is measured, not pixels: no panel profile ` +
      `applies, hidden and zero-size elements are skipped, and text over images is measured like any other. ` +
      `Findings are informational — apply your own thresholds.\n\n` +
      `Phone presets get the mobile UA and viewport semantics, so a page's mobile layout is what gets measured. ` +
      `Custom \`width\`/\`height\` need \`diagonalInches\` for any millimetres at all.\n\n` +
      `auto mode audits a running Obsrv with agent control on — the page the user is looking at, on the screen and ` +
      `text scale in force, in whatever state it has been driven into (clicked, a menu open) — though the walk ` +
      `returns the page to the top and may close a menu, so pass \`walk: false\` to measure a driven scroll ` +
      `position or an open menu as it stands — launching the app if it is not running (\`launched: true\` on that ` +
      `call), and falling back to a headless load of ` +
      `\`url\` when the live app is not available (\`why\` names the reason). 'live' requires the app; 'headless' ` +
      `never touches it. A live audit names the tab it measured (\`tabId\`, \`tabIndex\`). Live or headless, it walks ` +
      `the page a screenful at a time to the end and back before measuring — live so the user sees it look, both so ` +
      `lazy images load and late sections mount (\`walked\` in the result); \`walk: false\` measures without moving.`,
    inputSchema: auditInputShape,
    outputSchema: auditOutputShape,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  async (input: AuditHandlerInput): Promise<CallToolResult> => {
    if (input.url !== undefined) {
      const badScheme = urlSchemeError(input.url)
      if (badScheme) return toolError(badScheme)
    }
    const requestedMode = input.mode ?? 'auto'
    const custom = input.width !== undefined || input.height !== undefined || input.deviceScaleFactor !== undefined || input.diagonalInches !== undefined
    const plan = planLive(
      requestedMode,
      custom ? ['custom dimensions are headless-only (live mode audits the screen in force); audited headlessly.'] : [],
      [],
      process.env,
      process.platform,
    )
    const resolved = await ensureLive(plan)
    if (resolved.path === 'live') return liveAudit(resolved.app, input, resolved.notes, resolved.launched)
    if (requestedMode === 'live') return toolError(liveModeError(resolved.why, resolved.notes))
    const why = resolved.why
    const notes = resolved.notes
    if (input.url === undefined || input.url.trim().length === 0) {
      return toolError('headless obsrv_audit needs `url`; without one it can only audit a running Obsrv with agent control on (mode: live).')
    }
    let args: string[]
    try {
      args = buildAuditArgs({ ...input, url: input.url.trim() })
    } catch (e) {
      if (e instanceof UsageError) return toolError(e.message)
      throw e
    }
    // One load per audit, no capture.
    const killAfterMs = killBudgetMs(1, input.timeoutMs ?? DEFAULT_TIMEOUT_MS, input.waitMs ?? 0)
    const run = await runCli(args, killAfterMs)
    if (run.killed || run.code !== 0) return cliFailure('audit', run, killAfterMs)
    const result = extractTrailingJson(run.stdout)
    if (!result) return toolError(`obsrv audit exited 0 but printed unparseable JSON: ${stderrTail(run.stdout)}`)
    const structured = { mode: 'headless', why, ...result, notes: [...notes, ...queued(run)] }
    return { content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }], structuredContent: structured }
  },
)

const lintInputShape = {
  url: z
    .string()
    .min(1)
    .optional()
    .describe('Headless: required. Live: the app is navigated there first when given; omitted, the page it is showing is linted.'),
  mode: z
    .enum(['auto', 'headless', 'live'])
    .optional()
    .describe(
      "auto (default): a running Obsrv with agent control on is linted — the page the user is looking at, on the " +
        "screen, text scale and panel in force — else a headless load of `url`. 'live' requires the app; 'headless' never touches it.",
    ),
  preset: z.enum(PRESET_IDS).optional().describe('Headless: the target screen. Default: 1080p-24. Use obsrv_presets for ids.'),
  orientation: orientationField,
  width: z.number().int().min(1).optional().describe('Headless custom CSS viewport width. Needs height; mutually exclusive with preset.'),
  height: z.number().int().min(1).optional().describe('Headless custom CSS viewport height. Needs width.'),
  deviceScaleFactor: z.number().min(1).optional().describe('Headless custom dims: raster density (default 1).'),
  diagonalInches: z.number().min(0.1).optional().describe('Headless custom dims: panel diagonal (unused by the rules; accepted for symmetry).'),
  textScale: z.number().min(MIN_TEXT_SCALE).max(MAX_TEXT_SCALE).optional().describe('Headless: browser zoom as reflow; multiplies the density every rule is judged at.'),
  throttle: throttleField,
  profile: z.enum(PROFILE_IDS).optional().describe('Headless: the panel the contrast-on-panel rule is judged on. Default reference (which never adds findings).'),
  thinPx: z
    .number()
    .min(0)
    .optional()
    .describe(`Text lighter than regular (weight under 400) below this many device pixels of font size is flagged. Default ${DEFAULT_THIN_PX} (provisional).`),
  walk: walkField,
  groupsOnly: z
    .boolean()
    .optional()
    .describe('Leave the per-finding list out and answer with the groups alone: a fraction of the payload, and the summary still counts everything.'),
  waitMs: z.number().int().min(0).optional().describe('Headless: extra settle time after load, in ms. Default 0.'),
  timeoutMs: z.number().int().min(1).optional().describe(`Headless: load budget in ms. Default ${DEFAULT_TIMEOUT_MS}.`),
}

const lintRectShape = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
const lintFindingShape = z.object({
  rule: z.enum([...LINT_RULES] as [string, ...string[]]),
  element: z.string().describe('tag#id.first-class'),
  text: z.string(),
  rect: lintRectShape.describe("Page CSS px, scroll included: what obsrv_drive's highlight takes with space: 'page'."),
  message: z.string().describe('One sentence with the figures in it.'),
  kind: z.string().optional().describe('hairline: which edge (border-top, box-shadow, height, …).'),
  cssPx: z.number().optional(),
  devicePx: z.number().optional().describe('hairline: the edge in device px; thin-text: the font size in device px.'),
  fontSizePx: z.number().optional(),
  fontWeight: z.number().optional(),
  color: z.string().optional(),
  background: z.string().optional(),
  asIs: z.number().optional().describe('contrast rules: WCAG 2 contrast of the pair as stated.'),
  onPanel: z.number().optional().describe('contrast rules: the same pair through the panel profile (and the vision setting, live).'),
  threshold: z.number().optional(),
  largeText: z.boolean().optional(),
  naturalWidth: z.number().optional(),
  naturalHeight: z.number().optional(),
  drawnDevicePx: z.object({ width: z.number(), height: z.number() }).optional(),
  factor: z.number().optional().describe('image rules: how many times the image is scaled up (upscaled) or down (oversized).'),
  srcset: z.boolean().optional(),
  candidates: z.array(z.string()).optional(),
  src: z.string().optional(),
})

const lintOutputShape = {
  mode: z.enum(['headless', 'live']),
  why: z
    .enum(['requested', 'headless-only', 'no-display', 'declined', 'launch-timeout'])
    .optional()
    .describe(
      'Only when mode is headless: why. requested (you asked), headless-only (custom dimensions), no-display ' +
        '(nowhere for a window), declined (the user turned agent control off in the app — ask them), launch-timeout ' +
        '(the app was launched but did not answer in time; the next call will likely find it).',
    ),
  launched: z.boolean().optional().describe('True on the one call that launched the Obsrv app. Tell the user once: a window has opened.'),
  walked: walkedField,
  url: z.string().describe('The page linted: the argument (headless) or what the app reports showing (live).'),
  preset: z.string().describe("Headless: preset id or 'custom'. Live: the app's preset."),
  tabId: z.string().optional().describe('Live: the tab that was judged.'),
  tabIndex: z.number().optional(),
  cssWidth: z.number(),
  cssHeight: z.number(),
  deviceScaleFactor: z.number(),
  textScale: z.number().optional().describe('Present only when a scale other than 1 was in force.'),
  throttle: z.string().optional().describe('Only when a throttle was in force.'),
  profile: z.string().describe('The panel the contrast-on-panel rule was judged on.'),
  pageHeight: z.number().describe("The page's full height in CSS px; rects are page coordinates, so the lint covers all of it."),
  thresholds: z.object({ thinPx: z.number() }),
  summary: z
    .object({
      hairline: z.number(),
      'thin-text': z.number(),
      contrast: z.number(),
      'contrast-on-panel': z.number(),
      'image-upscaled': z.number(),
      'image-oversized': z.number(),
    })
    .describe('Every finding counted, listed or not.'),
  findings: z
    .array(
      lintFindingShape,
    )
    .describe('Rule by rule in a fixed order, worst first within a rule; at most 200 listed, the rest counted in truncated.findings.'),
  groups: z
    .array(
      z.object({
        rule: z.enum([...LINT_RULES] as [string, ...string[]]),
        key: z.string().describe('What the members share: a colour pair, a weight and size, an edge kind and thickness, an image asset size.'),
        count: z.number(),
        exemplar: z
          .object({ element: z.string(), text: z.string(), rect: lintRectShape, message: z.string() })
          .describe('The worst member: where it is and what it says. Its full figures are in `findings` when listed.'),
        elements: z.array(z.string()).describe('Up to five distinct elements in the group.'),
      }),
    )
    .describe(
      'The findings grouped by what they share, over every finding counted (listed or not): a page with 270 identical contrast failures is one group with count 270. Quote a group, not its members.',
    ),
  skipped: z
    .object({ textOnImages: z.number(), invisibleText: z.number() })
    .describe('Text that got no contrast verdict: over an image or gradient, or the same colour as its background (hidden by design, or broken).'),
  truncated: z.object({ findings: z.number(), text: z.number(), edges: z.number(), images: z.number() }),
  warnings: z.array(z.string()),
  notes: z.array(z.string()),
}

type LintHandlerInput = Omit<LintToolInput, 'url'> & { url?: string | undefined; mode?: 'auto' | 'headless' | 'live'; groupsOnly?: boolean; walk?: boolean }

async function liveLint(app: LiveApp, input: LintHandlerInput, notes: string[], launched: boolean): Promise<CallToolResult> {
  const { info } = app
  try {
    if (input.url !== undefined) {
      await controlCall(info, 'navigate', { url: input.url.trim() }, DEFAULT_TIMEOUT_MS + 10_000)
    }
    // The person watching sees the page pass before the number arrives; on a
    // page that mounts sections on scroll, the number is of the whole page.
    let walked: Walked | undefined
    if (input.walk !== false) {
      const w = await walkPage(walkDeps(info))
      walked = w.walked
      notes.push(...w.notes)
    }
    const payload = input.thinPx !== undefined ? { thinPx: input.thinPx } : {}
    const answer = await controlCall(info, 'lint', payload, LIVE_LINT_TIMEOUT_MS)
    const status = parseControlStatus(await controlCall(info, 'status', {}, LIVE_APPLY_TIMEOUT_MS))
    if (!status) return toolError('the running app answered `status` with something this server could not parse')
    for (const k of ['preset', 'orientation', 'textScale', 'throttle', 'profile', 'waitMs', 'timeoutMs'] as const) {
      if (input[k] !== undefined) notes.push(`\`${k}\` is headless-only and was ignored in live mode; the app's own ${k === 'preset' ? 'screen' : k} was used.`)
    }
    const { ok: _ok, textScale, ...judged } = answer
    // The app's result says nothing about its capped list (cli/lint.ts): this
    // server prints the list, so it adds the sentence — unless it is leaving
    // the list out, when there is nothing to say.
    const truncatedFindings = (judged as { truncated?: { findings?: unknown } }).truncated?.findings
    const listed = input.groupsOnly ? null : listTruncationNote(typeof truncatedFindings === 'number' ? truncatedFindings : 0)
    const liveWarnings = Array.isArray((judged as { warnings?: unknown }).warnings) ? ((judged as { warnings: unknown[] }).warnings as unknown[]) : []
    // A walk that ran out of budget left the page below its last screenful
    // as it first shipped: an image finding down there may be a placeholder.
    const liveFindings = Array.isArray((judged as { findings?: unknown }).findings) ? ((judged as { findings: LintFinding[] }).findings) : []
    const liveTextScale = typeof textScale === 'number' ? textScale : 1
    const unwalked =
      walked !== undefined && !walked.atEnd
        ? unwalkedImageNote(liveFindings, (walked.screenfuls + 1) * (status.cssHeight / liveTextScale))
        : null
    const added = [...(listed === null ? [] : [listed]), ...(unwalked === null ? [] : [unwalked])]
    const structured = {
      mode: 'live',
      url: status.url,
      preset: status.presetId,
      tabId: status.tabId,
      tabIndex: status.tabIndex,
      ...(walked !== undefined ? { walked } : {}),
      ...(typeof textScale === 'number' && textScale !== 1 ? { textScale } : {}),
      ...(status.throttle !== 'none' ? { throttle: status.throttle } : {}),
      ...judged,
      ...(input.groupsOnly ? { findings: [] } : {}),
      ...(added.length === 0 ? {} : { warnings: [...liveWarnings, ...added] }),
      notes,
      ...(launched ? { launched: true } : {}),
    }
    return { content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }], structuredContent: structured }
  } catch (e) {
    return toolError(`the running app refused the lint: ${e instanceof Error ? e.message : String(e)}`)
  }
}

server.registerTool(
  'obsrv_lint',
  {
    title: 'Lint a page for what a 1x screen and a cheap panel break',
    description:
      `Rules over the rendered page, judged on a target screen: edges under one device pixel (a 0.5px-high rule, ` +
      `a half-pixel box-shadow — sub-pixel on a 1x monitor, whole on a phone), text lighter than regular below ` +
      `\`thinPx\` device px of font size (strokes thinner than a pixel go grey and break), text whose contrast fails ` +
      `WCAG AA as stated, text that passes as stated but fails once the panel profile is applied (a budget TN ` +
      `lifts the blacks), raster images upscaled over their natural size (blurred) or far larger than drawn ` +
      `(downsampled, soft). Every finding carries the element, a page rect an obsrv_drive highlight can take with ` +
      `space: 'page', the figures, and one sentence. Chromium snaps a sub-pixel *border* to a whole device pixel, so ` +
      `borders are never findings here; a hairline drawn as an element's own height, or as a shadow, is.\n\n` +
      `Complements obsrv_audit (millimetres) and obsrv_diff (raster metrics): this is the DOM judged at the ` +
      `screen's density, so it names elements. What it cannot see — a weight that survives the rules but still ` +
      `looks grey, a gradient that bands — is what reading the obsrv_snap PNG is for.\n\n` +
      `auto mode lints a running Obsrv with agent control on — the page the user is looking at, on the screen, ` +
      `text scale and panel in force, in whatever state it has been driven into (clicked, a menu open) — though ` +
      `the walk returns the page to the top and may close a menu, so pass \`walk: false\` to measure a driven ` +
      `scroll position or an open menu as it stands — launching the app if it is not running (\`launched: true\` ` +
      `on that call), and falling back to a headless load of \`url\` when the live app ` +
      `is not available (\`why\` names the reason). 'live' requires the app; 'headless' never touches it. Findings ` +
      `are informational — apply your own thresholds. Live or headless, it walks the page a screenful at a time to ` +
      `the end and back before measuring — live so the user sees it look, both so lazy images load and are judged ` +
      `by the file that arrived rather than a placeholder (\`walked\` in the result); \`walk: false\` measures without moving.`,
    inputSchema: lintInputShape,
    outputSchema: lintOutputShape,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  async (input: LintHandlerInput): Promise<CallToolResult> => {
    if (input.url !== undefined) {
      const badScheme = urlSchemeError(input.url)
      if (badScheme) return toolError(badScheme)
    }
    const requestedMode = input.mode ?? 'auto'
    const custom = input.width !== undefined || input.height !== undefined || input.deviceScaleFactor !== undefined || input.diagonalInches !== undefined
    const plan = planLive(
      requestedMode,
      custom ? ['custom dimensions are headless-only (live mode lints the screen in force); linted headlessly.'] : [],
      [],
      process.env,
      process.platform,
    )
    const resolved = await ensureLive(plan)
    if (resolved.path === 'live') return liveLint(resolved.app, input, resolved.notes, resolved.launched)
    if (requestedMode === 'live') return toolError(liveModeError(resolved.why, resolved.notes))
    const why = resolved.why
    const notes = resolved.notes
    if (input.url === undefined || input.url.trim().length === 0) {
      return toolError('headless obsrv_lint needs `url`; without one it can only lint a running Obsrv with agent control on (mode: live).')
    }
    let args: string[]
    try {
      args = buildLintArgs({ ...input, url: input.url.trim() })
    } catch (e) {
      if (e instanceof UsageError) return toolError(e.message)
      throw e
    }
    const killAfterMs = killBudgetMs(1, input.timeoutMs ?? DEFAULT_TIMEOUT_MS, input.waitMs ?? 0)
    const run = await runCli(args, killAfterMs)
    if (run.killed || run.code !== 0) return cliFailure('lint', run, killAfterMs)
    const result = extractTrailingJson(run.stdout)
    if (!result) return toolError(`obsrv lint exited 0 but printed unparseable JSON: ${stderrTail(run.stdout)}`)
    // `groupsOnly` went to the CLI as --groups-only, which leaves the list out
    // at the source, and with it the sentence about the list's cap.
    const structured = { mode: 'headless', why, ...result, notes: [...notes, ...queued(run)] }
    return { content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }], structuredContent: structured }
  },
)

const inspectInputShape = {
  url: z
    .string()
    .min(1)
    .optional()
    .describe('Headless: required. Live: the app is navigated there first when given; omitted, the page it is showing is inspected.'),
  at: z
    .object({ x: z.number().min(0), y: z.number().min(0) })
    .optional()
    .describe('A point in CSS px of the target screen — what is drawn there. Exactly one of `at` / `selector`.'),
  selector: z.string().min(1).max(512).optional().describe('A CSS selector; its first match is inspected. Exactly one of `at` / `selector`.'),
  mode: z
    .enum(['auto', 'headless', 'live'])
    .optional()
    .describe(
      "auto (default): a running Obsrv with agent control on is inspected — the page the user is looking at, on the " +
        "screen and panel in force — else a headless load of `url`. 'live' requires the app; 'headless' never touches it.",
    ),
  preset: z.enum(PRESET_IDS).optional().describe('Headless: the target screen. Default: 1080p-24. Use obsrv_presets for ids.'),
  orientation: orientationField,
  width: z.number().int().min(1).optional().describe('Headless custom CSS viewport width. Needs height; mutually exclusive with preset.'),
  height: z.number().int().min(1).optional().describe('Headless custom CSS viewport height. Needs width.'),
  deviceScaleFactor: z.number().min(1).optional().describe('Headless custom dims: raster density (default 1).'),
  diagonalInches: z.number().min(0.1).optional().describe('Headless custom dims: panel diagonal, without which there are no millimetres.'),
  textScale: z.number().min(MIN_TEXT_SCALE).max(MAX_TEXT_SCALE).optional().describe('Headless: browser zoom as reflow (see obsrv_snap).'),
  throttle: throttleField,
  profile: z.enum(PROFILE_IDS).optional().describe('Headless: the panel the second contrast figure is measured on. Default reference.'),
  waitMs: z.number().int().min(0).optional().describe('Headless: extra settle time after load, in ms. Default 0.'),
  timeoutMs: z.number().int().min(1).optional().describe(`Headless: load budget in ms. Default ${DEFAULT_TIMEOUT_MS}.`),
}

const readoutShape = z
  .object({
    element: z.string().describe('tag#id.first-class'),
    tag: z.string(),
    id: z.string(),
    classes: z.string(),
    text: z.string().describe("The element's own text, trimmed, at most 60 characters."),
    rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).describe('Border box in CSS px of the target screen.'),
    pageRect: z
      .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
      .optional()
      .describe(
        "The same box in page CSS px, scroll included — an obsrv_audit finding's space, and what obsrv_drive's highlight takes with " +
          "space: 'page'. Absent from an app older than the field.",
      ),
    rectMm: z.object({ width: z.number(), height: z.number() }).nullable().describe('The box in millimetres on this screen; null without a diagonal.'),
    font: z.object({
      px: z.number().describe("The page's own font size in CSS px."),
      mm: z.number().nullable().describe('Cap-to-cap size on the glass: the px at this density (and text scale). Null without a diagonal.'),
      weight: z.number(),
      family: z.string(),
    }),
    color: z.string().describe('Text colour, #rrggbb.'),
    background: z.string().nullable().describe('The colour the text sits on, composited; null when an image or gradient is under it.'),
    backgroundNote: z.enum(['computed', 'image']),
    contrast: z
      .object({
        asIs: z.number().describe('WCAG 2 contrast of the pair as stated: what a reference display shows.'),
        onPanel: z.number().describe('The same pair through the panel profile (and the vision setting, live): what that screen shows.'),
        largeText: z.boolean().describe('24px+, or 18.66px+ at weight 700+: WCAG applies 3:1 instead of 4.5:1.'),
        aaThreshold: z.number(),
        passesAsIs: z.boolean(),
        passesOnPanel: z.boolean(),
        panel: z.string().describe('The profile id the onPanel figure was measured on.'),
        vision: z.string().optional().describe('Live only: the colour-vision simulation in force, if any.'),
      })
      .nullable()
      .describe('Null when the background could not be computed (an image or gradient under the text).'),
    ppi: z.number().nullable(),
  })
  .nullable()

const inspectOutputShape = {
  mode: z.enum(['headless', 'live']),
  why: z
    .enum(['requested', 'headless-only', 'no-display', 'declined', 'launch-timeout'])
    .optional()
    .describe(
      'Only when mode is headless: why. requested (you asked), headless-only (custom dimensions), no-display ' +
        '(nowhere for a window), declined (the user turned agent control off in the app — ask them), launch-timeout ' +
        '(the app was launched but did not answer in time; the next call will likely find it).',
    ),
  launched: z.boolean().optional().describe('True on the one call that launched the Obsrv app. Tell the user once: a window has opened.'),
  url: z.string().describe('The page inspected: the argument (headless) or what the app reports showing (live).'),
  preset: z.string().optional().describe("Headless: preset id or 'custom'. Live: the app's preset."),
  tabId: z.string().optional().describe('Live: the tab that was inspected.'),
  tabIndex: z.number().optional(),
  profile: z.string().describe('The panel the onPanel contrast was measured on.'),
  cssWidth: z.number().optional(),
  cssHeight: z.number().optional(),
  deviceScaleFactor: z.number().optional(),
  textScale: z.number().optional(),
  throttle: z.string().optional(),
  found: z.boolean().describe('False when nothing is at the point / the selector matched nothing; `readout` is then null.'),
  readout: readoutShape,
  notes: z.array(z.string()),
}

const reportInputShape = {
  url: urlField,
  presets: z
    .array(z.enum(PRESET_IDS))
    .min(1)
    .optional()
    .describe(`Screens to cover, by preset id (obsrv_presets lists them). Default: ${DEFAULT_REPORT_MATRIX.join(', ')}.`),
  orientation: orientationField,
  textScale: z
    .number()
    .min(MIN_TEXT_SCALE)
    .max(MAX_TEXT_SCALE)
    .optional()
    .describe(
      'Browser zoom as reflow, e.g. 1.5 for a user at 150% (default 1). The page lays out in 1/textScale of the CSS ' +
        'viewport at textScale times the density — what a larger-text setting or a Windows panel at 150% does — ' +
        'on every screen in the matrix.',
    ),
  throttle: throttleField,
  profile: profileField,
  tapMm: z.number().min(0).optional().describe(`Audit threshold for tap targets, mm. Default ${DEFAULT_TAP_MM} (provisional).`),
  textMm: z.number().min(0).optional().describe(`Audit threshold for text, mm. Default ${DEFAULT_TEXT_MM} (provisional).`),
  thinPx: z.number().min(0).optional().describe(`Lint threshold: light text under this many device px is flagged. Default ${DEFAULT_THIN_PX} (provisional).`),
  waitMs: z.number().int().min(0).optional().describe('Extra settle time after each load, in ms. Default 0.'),
  timeoutMs: z.number().int().min(1).optional().describe(`Per-render budget in ms. Default ${DEFAULT_TIMEOUT_MS}.`),
}

const reportOutputShape = {
  notes: z.array(z.string()).optional().describe('Only when there is something to say about the call itself, such as a wait for a render slot.'),
  url: z.string(),
  out: z.string().describe('The HTML file, self-contained, in a per-call temp dir. Attach it or open it; do not inline it.'),
  htmlBytes: z.number(),
  generatedAt: z.string(),
  profile: z.string(),
  thresholds: z.object({ tapMm: z.number(), textMm: z.number() }),
  throttle: z.string().optional().describe('Only when `throttle` was given: the conditions every screen rendered under.'),
  screens: z.array(
    z.object({
      preset: z.string(),
      cssWidth: z.number(),
      cssHeight: z.number(),
      deviceScaleFactor: z.number(),
      textScale: z.number().optional().describe('Present only when a scale other than 1 was applied.'),
      ppi: z.number().nullable(),
      settled: z.boolean(),
      unsettledReason: z.enum(['animating', 'timeout', 'uncovered', 'loading']).optional(),
      settledMs: z.number().nullable().optional().describe('Only when `throttle` was given: ms to paint-quiet, null if never.'),
      walked: walkedField,
      audit: z
        .object({ summary: z.object({ targets: auditGroupShape, text: auditGroupShape }), findings: z.number(), groups: z.number(), truncated: z.number() })
        .nullable(),
      lint: z
        .object({
          summary: z.object({
            hairline: z.number(),
            'thin-text': z.number(),
            contrast: z.number(),
            'contrast-on-panel': z.number(),
            'image-upscaled': z.number(),
            'image-oversized': z.number(),
          }),
          findings: z.number(),
          groups: z.number().describe('Findings grouped by what they share; the HTML lists the groups.'),
          skipped: z.object({ textOnImages: z.number(), invisibleText: z.number() }),
        })
        .nullable()
        .describe('The lint on the same loaded page, judged on the report profile; null when the page did not answer.'),
      diff: z
        .object({
          settled: z.boolean(),
          inkCoverage: z.object({ target: z.number(), reference: z.number(), delta: z.number() }),
          rows: z.object({ target: z.number(), reference: z.number(), ratio: z.number().nullable() }),
          findings: z.array(z.string()),
        })
        .nullable()
        .describe('1x screens only; null with diffSkipped saying why.'),
      diffSkipped: z.string().nullable(),
      problems: z
        .object({ featured: z.number(), belowCapture: z.number(), inPanel: z.number() })
        .optional()
        .describe(
          'Present when findings were located on the full-page overview: how many were pinned and cropped, how many sit below the captured height, and how many sit inside a panel with its own scrollbar (a sidebar, a list) that a capture of the page never shows however far it reaches. The images are in the HTML, not here.',
        ),
      warnings: z.array(z.string()),
    }),
  ),
}

server.registerTool(
  'obsrv_report',
  {
    title: 'One HTML page: a URL on a matrix of screens, rendered, audited and diffed',
    description:
      `Render a URL on several screens and write one self-contained HTML report: each screen's render at its true ` +
      `density (through the panel profile, if any), the physical-units audit (tap targets and text in millimetres ` +
      `on that screen, findings under the thresholds), and for 1x screens the 1x-vs-2x comparison against the ` +
      `display the page was probably designed on. The page is what to attach to a PR or hand to a designer: same ` +
      `page, same CSS, a different answer per screen.\n\n` +
      `Returns the file path plus a per-screen summary (audit counts, diff metrics, warnings) — the HTML is not ` +
      `inlined. Each screen costs one render, plus a 2x reference render for 1x screens; budget time accordingly ` +
      `(the default matrix is four screens, six renders). Headless-only: never drives the visible app.\n\n` +
      `Always headless: this is an artefact for delivery, not a live review — use obsrv_drive to review in the window.`,
    inputSchema: reportInputShape,
    outputSchema: reportOutputShape,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  async (input: ReportToolInput): Promise<CallToolResult> => {
    const badScheme = urlSchemeError(input.url)
    if (badScheme) return toolError(badScheme)
    const dir = await mkdtemp(join(tmpdir(), 'obsrv-mcp-'))
    let args: string[]
    try {
      args = buildReportArgs({ ...input, url: input.url.trim() }, join(dir, 'report.html'))
    } catch (e) {
      await rm(dir, { recursive: true, force: true })
      if (e instanceof UsageError) return toolError(e.message)
      throw e
    }
    // Up to two renders per screen: the screen and its 2x reference.
    const renders = 2 * (input.presets?.length ?? DEFAULT_REPORT_MATRIX.length)
    const killAfterMs = killBudgetMs(renders, input.timeoutMs ?? DEFAULT_TIMEOUT_MS, input.waitMs ?? 0)
    const run = await runCli(args, killAfterMs)
    if (run.killed || run.code !== 0) return cliFailure('report', run, killAfterMs)
    const result = extractTrailingJson(run.stdout)
    if (!result) return toolError(`obsrv report exited 0 but printed unparseable JSON: ${stderrTail(run.stdout)}`)
    const structured = { ...result, ...(queued(run).length > 0 ? { notes: queued(run) } : {}) }
    return { content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }], structuredContent: structured }
  },
)

server.registerTool(
  'obsrv_drive',
  {
    title: 'Drive the visible Obsrv app',
    description:
      `Drive the Obsrv desktop app the user is looking at: navigate it to a URL, apply a screen preset, rotate that ` +
      `screen to landscape or portrait, apply a panel profile, the target pane's 1:1/fit view or pixel-exact ` +
      `toggle — each exactly as clicking the toolbar would ` +
      `— and steer the session like a guided demo: focus the window, step history (back/forward/reload), scroll ` +
      `both panes, pan the target pane to a pixel, click the live page, and highlight a rect with a temporary ` +
      `neutral marker, all while the user watches.\n\n` +
      `Only the supplied inputs run (none = just read the current state), in this fixed order: tab → focus → url → ` +
      `preset → orientation → textScale → onionSkin → throttle → profile → viewMode → panes → vision → pixelExact → reload → back → forward → scroll → panTo → click → highlight → ` +
      `capture → closeTab. ` +
      `The result is the final status: app version, the URL showing, and the selected preset/orientation/profile/view. A ` +
      `click that navigates is reflected in that status — the call waits briefly (up to 2 s) for the commit. A ` +
      `scroll adds \`scrolled\` (the offset actually reached) and \`scroller\` ('root' or 'element'): compare ` +
      `\`scrolled\` with what you asked for rather than trusting the call's success, and use \`scroll.scrollSelector\` ` +
      `when the automatic scroll-host detection picks the wrong container. Pass \`scroll.page\` ("next" | "prev" | ` +
      `"top" | "bottom") instead of \`{ x, y }\` to walk the page a screenful at a time with no arithmetic — \`atEnd\` ` +
      `is true once the scroller can go no further down.\n\n` +
      `Coordinates: click takes CSS-viewport px of the page (the valid range is 0 up to but not including the ` +
      `viewport size); panTo and highlight take target-pane pixels (device px of the render — identical to CSS px ` +
      `on 1x presets); scroll takes page CSS px.\n\n` +
      `Pass \`capture\` to get a PNG back once the commands have run. Nothing in this tool navigates unless you ` +
      `pass \`url\`, so this is how you photograph a scrolled or panned state: scroll, then capture, in one call. ` +
      `obsrv_snap is the other way round — it points the app at a URL first, and pointing it somewhere new is a ` +
      `fresh load that starts at the top.\n\n` +
      `Tabs: the app holds several sessions as tabs, each with its own URL, screen and page state. Commands act on the ` +
      `tab in front; \`tab\` brings one there first ("new" opens it), \`closeTab\` closes one last, and the result's \`tabs\` ` +
      `lists them all. One tab per screen, left open for the user to flip through, is the natural shape of a review.\n\n` +
      `The app is launched if it is not running. If the user has turned agent control off (the AGENT chip, or Settings), ` +
      `this errors with why: "declined" — ask them, do not retry.`,
    inputSchema: driveInputShape,
    outputSchema: driveOutputShape,
    // Honest annotation: this changes what the user's window is showing.
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (input: {
    tab?: string
    url?: string
    preset?: string
    orientation?: 'portrait' | 'landscape'
    textScale?: number
    onionSkin?: number
    throttle?: string
    profile?: string
    viewMode?: '1:1' | 'fit'
    panes?: 'both' | 'target'
    pixelExact?: boolean
    vision?: 'none' | 'protan' | 'deutan' | 'tritan' | 'achromat'
    visionSeverity?: number
    focus?: boolean
    reload?: boolean
    back?: boolean
    forward?: boolean
    scroll?: { x?: number; y?: number; page?: 'next' | 'prev' | 'top' | 'bottom'; scrollSelector?: string }
    panTo?: { x: number; y: number }
    click?: { x: number; y: number }
    highlight?: { x: number; y: number; width: number; height: number; durationMs?: number; space?: 'pane' | 'page' }
    capture?: 'window' | 'pane' | 'raster'
    closeTab?: string
  }): Promise<CallToolResult> => {
    if (input.url !== undefined) {
      const badScheme = urlSchemeError(input.url)
      if (badScheme) return toolError(badScheme)
    }
    const resolved = await ensureLive(planLive('live', [], [], process.env, process.platform))
    if (resolved.path === 'headless') return toolError(`obsrv_drive needs the live app and it is not available (${resolved.why}): ${resolved.notes.join(' ')}`)
    const live = resolved.app
    try {
      // Tab first, before even `focus`: "new" opens a tab (with `url`/`preset`
      // from this call, if given — guarded below so they are not applied a
      // second time) and fronts it; an id fronts an existing one. Either way
      // the user is looking at the tab everything else in this call acts on.
      let openedWithUrl = false
      let openedWithPreset = false
      if (input.tab === 'new') {
        const payload: Record<string, unknown> = {}
        if (input.url !== undefined) {
          payload.url = input.url.trim()
          openedWithUrl = true
        }
        if (input.preset !== undefined) {
          payload.preset = input.preset
          openedWithPreset = true
        }
        await controlCall(live.info, 'openTab', payload, DEFAULT_TIMEOUT_MS + 10_000)
      } else if (input.tab !== undefined) {
        await controlCall(live.info, 'activateTab', { id: input.tab }, LIVE_APPLY_TIMEOUT_MS)
      }
      // The documented execution order: window attention first, then what is
      // showing, then how it is shown, then the in-page steering.
      if (input.focus) await controlCall(live.info, 'focusWindow', {}, LIVE_APPLY_TIMEOUT_MS)
      if (input.url !== undefined && !openedWithUrl) {
        await controlCall(live.info, 'navigate', { url: input.url.trim() }, DEFAULT_TIMEOUT_MS + 10_000)
      }
      if (input.preset !== undefined && !openedWithPreset) await controlCall(live.info, 'setPreset', { id: input.preset }, LIVE_APPLY_TIMEOUT_MS)
      // After the preset, before everything else: rotation is applied on top of
      // whichever screen is in force, so a call carrying both has to land in
      // that order or the rotation would be spent on the outgoing preset.
      if (input.orientation !== undefined) {
        await controlCall(live.info, 'setOrientation', { orientation: input.orientation }, LIVE_APPLY_TIMEOUT_MS)
      }
      if (input.textScale !== undefined) {
        await controlCall(live.info, 'setTextScale', { textScale: input.textScale }, LIVE_APPLY_TIMEOUT_MS)
      }
      if (input.onionSkin !== undefined) {
        await controlCall(live.info, 'setOnionSkin', { onionSkin: input.onionSkin }, LIVE_APPLY_TIMEOUT_MS)
      }
      if (input.throttle !== undefined) {
        await controlCall(live.info, 'setThrottle', { throttle: input.throttle }, LIVE_APPLY_TIMEOUT_MS)
      }
      if (input.profile !== undefined) await controlCall(live.info, 'setProfile', { id: input.profile }, LIVE_APPLY_TIMEOUT_MS)
      if (input.viewMode !== undefined) {
        await controlCall(live.info, 'setViewMode', { mode: input.viewMode }, LIVE_APPLY_TIMEOUT_MS)
      }
      if (input.panes !== undefined) {
        await controlCall(live.info, 'setPanes', { panes: input.panes }, LIVE_APPLY_TIMEOUT_MS)
      }
      if (input.vision !== undefined || input.visionSeverity !== undefined) {
        await controlCall(
          live.info,
          'setVision',
          { type: input.vision ?? 'none', severity: input.visionSeverity },
          LIVE_APPLY_TIMEOUT_MS,
        )
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
      let atEnd: boolean | undefined
      const warnings: string[] = []
      if (input.scroll !== undefined) {
        const r = await controlCall(live.info, 'scroll', input.scroll, LIVE_APPLY_TIMEOUT_MS)
        const at = r['scrolled']
        scrolled =
          at !== null && typeof at === 'object' && typeof (at as { x?: unknown }).x === 'number' && typeof (at as { y?: unknown }).y === 'number'
            ? { x: (at as { x: number }).x, y: (at as { y: number }).y }
            : null
        if (r['scroller'] === 'root' || r['scroller'] === 'element') scroller = r['scroller']
        atEnd = r['atEnd'] === true
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
      let highlight: { drawn: boolean; pane?: unknown } | null = null
      if (input.highlight !== undefined) {
        // A capture in the same call waits for the page to settle, up to
        // several seconds on an animating page — longer than the default
        // highlight lives. Keep it up until the shutter has fired.
        const payload =
          input.capture !== undefined
            ? { ...input.highlight, durationMs: Math.max(input.highlight.durationMs ?? HIGHLIGHT_DURATION_DEFAULT_MS, HIGHLIGHT_DURATION_MAX_MS) }
            : input.highlight
        const h = await controlCall(live.info, 'highlight', payload, LIVE_APPLY_TIMEOUT_MS)
        highlight = { drawn: h['drawn'] === true, ...(h['pane'] !== undefined ? { pane: h['pane'] } : {}) }
        if (Array.isArray(h['warnings'])) for (const w of h['warnings']) if (typeof w === 'string') warnings.push(w)
      }

      // Capture last, so the PNG shows everything the commands above did.
      // Nothing here navigates, so a scroll or pan applied in this same call
      // is still in place when the shutter fires.
      let capture: LiveCapture | null = null
      let image: Awaited<ReturnType<typeof inlineImage>> | null = null
      if (input.capture !== undefined) {
        await sleep(LIVE_CAPTURE_GRACE_MS)
        capture = await liveCapture(live.info, input.capture)
        warnings.push(...capture.warnings)
        const label =
          input.capture === 'pane' ? 'The captured target pane' : input.capture === 'raster' ? "The target's own raster" : 'The captured app window'
        image = await inlineImage(capture.pngPath, label, '')
        if (image.note !== null) warnings.push(image.note)
      }

      // closeTab last, after capture: that is what lets one call photograph a
      // tab and then close it.
      if (input.closeTab !== undefined) {
        const id =
          input.closeTab === 'current'
            ? (parseControlStatus(await controlCall(live.info, 'status', {}, LIVE_STATUS_TIMEOUT_MS))?.tabId ?? '')
            : input.closeTab
        if (id === '') return toolError('closeTab: the app did not name its tab')
        await controlCall(live.info, 'closeTab', { id }, LIVE_APPLY_TIMEOUT_MS)
      }

      const status = parseControlStatus(await controlCall(live.info, 'status', {}, LIVE_STATUS_TIMEOUT_MS))
      if (!status) return toolError('the control server returned a malformed status')
      const structured = {
        ...status,
        ...(resolved.launched ? { launched: true } : {}),
        ...(input.scroll !== undefined ? { scrolled: scrolled ?? null } : {}),
        ...(scroller !== undefined ? { scroller } : {}),
        ...(atEnd !== undefined ? { atEnd } : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
        ...(highlight !== null ? { highlight } : {}),
        ...(capture !== null ? { pngPath: capture.pngPath, width: capture.width, height: capture.height } : {}),
        ...(image !== null ? { inlined: image.inlined } : {}),
        ...(capture !== null && capture.settled !== undefined
          ? { settled: capture.settled, ...(capture.unsettledReason !== undefined ? { unsettledReason: capture.unsettledReason } : {}) }
          : {}),
      }
      const content: CallToolResult['content'] = [{ type: 'text', text: JSON.stringify(structured, null, 2) }]
      if (image !== null) content.push(image.block)
      return { content, structuredContent: structured }
    } catch (e) {
      return toolError(liveFailure(e))
    }
  },
)

type InspectHandlerInput = InspectToolInput & { mode?: 'auto' | 'headless' | 'live' }

async function liveInspect(app: LiveApp, input: InspectHandlerInput, notes: string[], launched: boolean): Promise<CallToolResult> {
  const { info } = app
  try {
    if (input.url !== undefined) {
      await controlCall(info, 'navigate', { url: input.url.trim() }, DEFAULT_TIMEOUT_MS + 10_000)
    }
    const payload = input.at !== undefined ? { x: input.at.x, y: input.at.y } : { selector: input.selector!.trim() }
    const answer = await controlCall(info, 'inspect', payload, LIVE_APPLY_TIMEOUT_MS)
    const status = parseControlStatus(await controlCall(info, 'status', {}, LIVE_APPLY_TIMEOUT_MS))
    if (!status) return toolError('the running app answered `status` with something this server could not parse')
    for (const k of ['preset', 'profile', 'textScale', 'throttle', 'waitMs', 'timeoutMs'] as const) {
      if (input[k] !== undefined) notes.push(`\`${k}\` is headless-only and was ignored in live mode; the app's own ${k === 'preset' ? 'screen' : k} was used.`)
    }
    const structured = {
      mode: 'live',
      url: status.url,
      preset: status.presetId,
      tabId: status.tabId,
      tabIndex: status.tabIndex,
      profile: status.profileId,
      cssWidth: status.cssWidth,
      cssHeight: status.cssHeight,
      textScale: status.textScale,
      throttle: status.throttle,
      found: answer.found === true,
      readout: answer.readout ?? null,
      notes,
      ...(launched ? { launched: true } : {}),
    }
    return { content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }], structuredContent: structured }
  } catch (e) {
    return toolError(`the running app refused the inspect: ${e instanceof Error ? e.message : String(e)}`)
  }
}

server.registerTool(
  'obsrv_inspect',
  {
    title: 'Inspect one element on a target screen: font in mm, colours, contrast here and on the panel',
    description:
      `The app's inspector, for agents. Name a point (\`at\`, CSS px of the target screen) or a CSS selector, and get ` +
      `the element there: tag/id/class, its text, its box in CSS px and in millimetres on that screen, its font size in ` +
      `px and in millimetres, its text colour and the background it actually sits on (walked up through translucent ` +
      `layers), and its WCAG 2 contrast twice — as stated, and as the panel profile would show it — against the ` +
      `threshold that applies to text that size (4.5:1, or 3:1 for large text). A pair that clears 4.5:1 on the ` +
      `display a page was designed on can fall under 3:1 on a budget TN panel; the second number says so.\n\n` +
      `auto mode inspects a running Obsrv with agent control on — the page the user is looking at, on the screen, ` +
      `panel and vision setting in force — launching the app if it is not running (\`launched: true\` on that ` +
      `call), and falling back to a headless load of \`url\` when the live app is not available (\`why\` names the ` +
      `reason). Headless takes the same screen options as obsrv_snap. \`found: false\` means nothing was there; it ` +
      `is not an error.`,
    inputSchema: inspectInputShape,
    outputSchema: inspectOutputShape,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  async (input: InspectHandlerInput): Promise<CallToolResult> => {
    const where = inspectWhereError(input)
    if (where) return toolError(where)
    if (input.url !== undefined) {
      const badScheme = urlSchemeError(input.url)
      if (badScheme) return toolError(badScheme)
    }
    const requestedMode = input.mode ?? 'auto'
    const custom = input.width !== undefined || input.height !== undefined || input.deviceScaleFactor !== undefined || input.diagonalInches !== undefined
    const plan = planLive(
      requestedMode,
      custom ? ['custom dimensions are headless-only (live mode inspects the screen in force); inspected headlessly.'] : [],
      [],
      process.env,
      process.platform,
    )
    const resolved = await ensureLive(plan)
    if (resolved.path === 'live') return liveInspect(resolved.app, input, resolved.notes, resolved.launched)
    if (requestedMode === 'live') return toolError(liveModeError(resolved.why, resolved.notes))
    const why = resolved.why
    const notes = resolved.notes
    let args: string[]
    try {
      args = buildInspectArgs({ ...input, ...(input.url !== undefined ? { url: input.url.trim() } : {}) })
    } catch (e) {
      if (e instanceof UsageError) return toolError(e.message)
      throw e
    }
    const killAfterMs = killBudgetMs(1, input.timeoutMs ?? DEFAULT_TIMEOUT_MS, input.waitMs ?? 0)
    const run = await runCli(args, killAfterMs)
    if (run.killed || run.code !== 0) return cliFailure('inspect', run, killAfterMs)
    const result = extractTrailingJson(run.stdout)
    if (!result) return toolError(`obsrv inspect exited 0 but printed unparseable JSON: ${stderrTail(run.stdout)}`)
    const structured = { mode: 'headless', why, ...result, notes: [...notes, ...queued(run)] }
    return { content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }], structuredContent: structured }
  },
)

server.registerTool(
  'obsrv_presets',
  {
    title: 'List screen presets, panel profiles and throttle presets',
    description:
      `List every screen preset (id, label, group, CSS dims, deviceScaleFactor, panel diagonal, derived physical ` +
      `ppi), panel profile (id, label, simulation params) and throttle preset (network conditions, CPU rate) accepted ` +
      `by obsrv_snap, obsrv_diff, obsrv_audit and obsrv_report. Read straight ` +
      `from the app's preset table — nothing is rendered. The dimensions are each preset's natural orientation ` +
      `(portrait for the mobile ones, landscape for the monitors); every preset also rotates — see the ` +
      `\`orientation\` note in the result.`,
    inputSchema: {
      group: z
        .enum(['laptop', 'desktop', 'mobile', 'laptops', 'desktops', 'phones', 'phone'])
        .optional()
        .describe(
          'Only the screen presets of this group (phones is an alias of mobile), and only them: the throttles, profiles and orientation note are left out. Omit for the whole catalog.',
        ),
    },
    outputSchema: presetsOutputShape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input: { group?: 'laptop' | 'desktop' | 'mobile' | 'laptops' | 'desktops' | 'phones' | 'phone' }): Promise<CallToolResult> => {
    const all = listCatalog()
    // A group answers with the presets alone: an agent that only needs ids
    // was paying for the throttle and profile tables every time.
    const group = input.group === undefined ? undefined : PRESET_GROUP_ALIASES[input.group]
    const catalog = group === undefined ? all : { presets: all.presets.filter(p => p.group === group) }
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
