import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { DEFAULT_TIMEOUT_MS } from '../cli/args'
import { PANEL_PROFILES, SCREEN_PRESETS } from '../shared/presets'
import {
  MAX_INLINE_IMAGE_BYTES,
  UsageError,
  buildDiffArgs,
  buildSnapArgs,
  extractTrailingJson,
  killBudgetMs,
  listCatalog,
  shouldInlineImage,
  stderrTail,
  urlSchemeError,
  type DiffToolInput,
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
}

const snapOutputShape = {
  out: z.string().describe('PNG path the CLI wrote (same file as pngPath).'),
  preset: z.string().describe('Preset id, or "custom" for width/height runs.'),
  cssWidth: z.number().describe('Applied CSS viewport width.'),
  cssHeight: z.number().describe('Applied CSS viewport height (grown under fullPage).'),
  deviceScaleFactor: z.number(),
  profile: z.string(),
  settled: z.boolean().describe('False: the page never went paint-quiet (e.g. animation) and the capture is best-effort.'),
  warnings: z.array(z.string()),
  pngPath: z.string().describe('Absolute path of the captured PNG (kept in a per-call temp dir).'),
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
      `captures (typically fullPage) stay on disk with a note.`,
    inputSchema: snapInputShape,
    outputSchema: snapOutputShape,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  async (input: SnapToolInput): Promise<CallToolResult> => {
    const badScheme = urlSchemeError(input.url)
    if (badScheme) return toolError(badScheme)
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

    const structured = { ...meta, pngPath }
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
      `1x presets only (e.g. laptop-768, 1080p-24): dense presets (phones) and CSS viewports over 2048px are ` +
      `refused with an explanatory error — use obsrv_snap for those.`,
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
