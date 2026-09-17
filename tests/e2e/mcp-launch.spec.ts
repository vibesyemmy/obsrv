import { test, expect, type ElectronApplication } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONTROL_FILE_NAME } from '../../src/shared/control'
import { launchApp } from './launch'

/**
 * The MCP server when a launch does not produce a live app. Two sentences in
 * `ensureLive` (`src/mcp/control.ts`) that no reply had ever carried
 * (docs/note-inventory.md, c5): the launch that exits into a profile already
 * in use, and the consent nobody answers.
 *
 * WHY THIS CAN RUN AT ALL, since the harness must never launch a real Obsrv.
 * It doesn't. The server runs in DEV LANE mode (`OBSRV_DEV=1`), where
 * `scripts/devLane.js`'s `appLaunch` targets the CHECKOUT's own build
 * (`out/main/index.js`) and passes `--user-data-dir=<OBSRV_DEV_HOME>/profile`.
 * Pointing `OBSRV_DEV_HOME` at a temp directory gives every launch here its
 * own profile, and the window it opens is titled "dev lane". So
 * `cannotLaunchReason` and `launchApp`'s own refusal stay exactly as they are
 * for every other caller, and nothing test-only was added to `src/`.
 *
 * IT OPENS A REAL WINDOW, so it is CI-only unless asked for by name, like the
 * desk-taking specs — and a local run needs Opeyemi's separate yes.
 */

const ROOT = resolve(__dirname, '../..')
const MCP_BIN = resolve(ROOT, 'bin/obsrv-mcp.js')
const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href
const CALL_TIMEOUT_MS = 120_000

test.describe.configure({ timeout: 180_000 })

test.skip(
  !process.env['CI'] && !process.env['OBSRV_E2E_LAUNCH'],
  'launches the dev-lane app and opens its window: runs on CI, or locally with OBSRV_E2E_LAUNCH=1',
)

let lane: string
let app: ElectronApplication | undefined

/**
 * The lane's home, and the assertion that it is not the developer's.
 * `devHome()` falls back to `~/.obsrv-dev` when `OBSRV_DEV_HOME` is unset
 * (`scripts/devLane.js:22-29`), so a spec that forgot to pass it — or a
 * refactor that dropped it from the env below — would drive the real dev lane
 * and its window, and nothing in the run would say so (Wren's catch).
 */
function laneHome(): string {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'obsrv-lane-'))
  expect(dir.startsWith(realpathSync(tmpdir())), 'this spec must not run against the real dev lane').toBe(true)
  return dir
}

const serverEnv = (extra: Record<string, string>): Record<string, string> => {
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined))
  // OBSRV_TEST is deliberately NOT set: it refuses every launch, which is the
  // point of the guard. The lane keeps the launch off the installed app.
  delete env['OBSRV_TEST']
  expect(extra['OBSRV_DEV_HOME'], 'every server here must be given a lane of its own').toBeTruthy()
  return { ...env, OBSRV_DEV: '1', ...extra }
}

async function connect(extra: Record<string, string>): Promise<Client> {
  const client = new Client({ name: 'obsrv-mcp-launch-spec', version: '0.0.0' })
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [MCP_BIN], cwd: ROOT, env: serverEnv(extra) }))
  // Cache the output schemas before any call, so replies are validated (see
  // the same note in mcp.spec.ts).
  await client.listTools()
  return client
}

const snap = (client: Client): Promise<CallToolResult> =>
  client.callTool({ name: 'obsrv_snap', arguments: { url: FIXTURE, preset: 'laptop-768' } }, undefined, {
    timeout: CALL_TIMEOUT_MS,
  }) as Promise<CallToolResult>

test.beforeEach(() => {
  lane = laneHome()
})

test.afterEach(async () => {
  await app?.close().catch(() => undefined)
  app = undefined
  rmSync(lane, { recursive: true, force: true })
})

test('a launch that loses the single-instance lock says the profile is in use, and renders headlessly', async () => {
  // An app already on the lane's profile, with agent control OFF and discovery
  // pointed at a file that cannot exist: to the server this is "no app", so it
  // launches — and its instance hits the lock and exits at once. That is the
  // field state the sentence describes: a process holding the profile that is
  // not answering the agent-control protocol.
  app = await launchApp([], {}, join(lane, 'profile'))
  const client = await connect({ OBSRV_DEV_HOME: lane, OBSRV_CONTROL_FILE: join(lane, 'no-such-control.json') })
  try {
    const r = await snap(client)
    expect(r.isError).toBeFalsy()
    const s = r.structuredContent as { mode: string; why?: string; warnings: string[] }
    expect(s).toMatchObject({ mode: 'headless', why: 'launch-timeout' })
    expect(s.warnings, JSON.stringify(s.warnings)).toContain(
      "the launch exited immediately without a new instance starting — Obsrv's profile is already in use by a process that is not answering the agent-control protocol (an older Obsrv version, or one still finishing its own startup); rendered headlessly.",
    )
    // It gave up on the exit rather than burning the whole budget: the reply
    // carries no waiting sentence about the launch timeout's full 12 s.
    expect(s.warnings.join(' ')).not.toMatch(/did not answer within/)
  } finally {
    await client.close()
  }
})

test('a consent nobody answers is said as that, not as an app that never came up', async () => {
  // The same app, but discovery finds its control file, which says control is
  // off and nobody has answered. `ensureLive` treats that as a knock and waits
  // the full budget, because the running app answers over discovery once a
  // human clicks — not by keeping the spawned process alive.
  app = await launchApp([], {}, join(lane, 'profile'))
  const client = await connect({ OBSRV_DEV_HOME: lane, OBSRV_CONTROL_FILE: join(lane, 'profile', CONTROL_FILE_NAME) })
  try {
    const r = await snap(client)
    expect(r.isError).toBeFalsy()
    const s = r.structuredContent as { mode: string; why?: string; warnings: string[] }
    expect(s).toMatchObject({ mode: 'headless', why: 'launch-timeout' })
    expect(s.warnings, JSON.stringify(s.warnings)).toContain(
      'Obsrv is running and was asked whether to allow agent control, but nobody answered within 12 s; rendered headlessly. Answering the prompt in Obsrv lets the next call reach it.',
    )
    // The other wording is for an app that was launched and never answered.
    // Saying that here would blame a startup that already happened.
    expect(s.warnings.join(' ')).not.toMatch(/was launched but did not answer/)
  } finally {
    await client.close()
  }
})

test('a launch that cannot resolve Electron says the app could not be launched, and launches nothing', async () => {
  // The third of the launch sentences, and the one that needs no app at all:
  // `defaultDeps.launch` throws when the target cannot be resolved, and
  // `OBSRV_ELECTRON_PKG_DIR` (bin/electronPath.js:81) is the lever — pointed at
  // a directory that is not an electron package, `resolveElectron` answers with
  // an error rather than downloading anything (measured: the installer it looks
  // for is absent, so the spawn exits 1 at once).
  //
  // Nothing is spawned here, so this arm is as safe as the headless specs; it
  // sits in this file because every other spec sets OBSRV_TEST, which refuses
  // the launch earlier and for a different reason.
  const notElectron = join(lane, 'not-an-electron-package')
  mkdirSync(notElectron)
  const client = await connect({ OBSRV_DEV_HOME: lane, OBSRV_ELECTRON_PKG_DIR: notElectron })
  try {
    const r = await snap(client)
    expect(r.isError).toBeFalsy()
    const s = r.structuredContent as { mode: string; why?: string; warnings: string[] }
    expect(s).toMatchObject({ mode: 'headless', why: 'launch-timeout' })
    const said = s.warnings.find(w => w.startsWith('the Obsrv app could not be launched'))
    expect(said, JSON.stringify(s.warnings)).toBeDefined()
    // The whole sentence, with the resolver's own reason inside it: an agent
    // reading this needs to know it was Electron and not the app.
    expect(said).toMatch(/^the Obsrv app could not be launched \(.*electron.*\); rendered headlessly\.$/)
    // No app was started, so nothing says one was.
    expect(s.warnings.join(' ')).not.toMatch(/profile is already in use|nobody answered|did not answer/)
  } finally {
    await client.close()
  }
})
