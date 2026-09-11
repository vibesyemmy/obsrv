import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * The obsrv-dev proxy (scripts/dev-mcp.js): the one MCP server a session
 * registers for the dev lane. It runs the lane's own server in dev mode and
 * starts it again when the lane's build changes or the lane moves, replaying
 * the handshake, so a call after `npm run build` runs the new code on the
 * same connection — no session restart. Driven here with a real MCP client
 * against fake checkouts whose server answers which build it is.
 */
const ROOT = resolve(__dirname, '../..')
const PROXY = join(ROOT, 'scripts', 'dev-mcp.js')
const SDK = join(ROOT, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs')
const lane = createRequire(__filename)('../../scripts/devLane.js') as { pointLaneAt(root: string, env?: NodeJS.ProcessEnv): void }

let bump = 0
/** Writes a fake server build that answers with `mark`, stamped newer than the last one. */
function build(root: string, mark: string): void {
  const file = join(root, 'out', 'mcp', 'server.js')
  writeFileSync(
    file,
    `const { McpServer } = require(${JSON.stringify(join(SDK, 'server', 'mcp.js'))})
const { StdioServerTransport } = require(${JSON.stringify(join(SDK, 'server', 'stdio.js'))})
const MARK = ${JSON.stringify(mark)}
const text = t => ({ content: [{ type: 'text', text: t }] })
const server = new McpServer({ name: 'fake-obsrv', version: '0.0.0' })
server.registerTool('build', { description: 'which build answers' }, async () => text(MARK + ' dev=' + (process.env.OBSRV_DEV || '')))
server.registerTool('slow', { description: 'answers after 700 ms' }, async () => {
  await new Promise(r => setTimeout(r, 700))
  return text('slow ' + MARK)
})
server.registerTool('die', { description: 'exits mid-call' }, async () => process.exit(3))
server.connect(new StdioServerTransport())
`,
  )
  // Newer than the last build whatever the clock's resolution: the stamp is what the proxy compares.
  const t = Date.now() / 1000 + ++bump
  utimesSync(file, t, t)
}
function checkout(mark: string): string {
  const root = mkdtempSync(join(tmpdir(), 'obsrv-proxy-co-'))
  mkdirSync(join(root, 'bin'))
  mkdirSync(join(root, 'out', 'mcp'), { recursive: true })
  writeFileSync(join(root, 'bin', 'obsrv-mcp.js'), "require('../out/mcp/server.js')\n")
  build(root, mark)
  return root
}
const text = (r: unknown): string => (r as { content: { text: string }[] }).content[0]!.text
/** The last content block: the lane's stamp, naming the build that answered. */
const stamp = (r: unknown): string => {
  const content = (r as { content: { text: string }[] }).content
  return content[content.length - 1]!.text
}
const isError = (r: unknown): boolean => (r as { isError?: boolean }).isError === true

describe('the obsrv-dev proxy', () => {
  let home: string
  let a: string
  let b: string
  let client: Client
  let listChanged = 0
  const env = (): NodeJS.ProcessEnv => ({ OBSRV_DEV_HOME: home })

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'obsrv-proxy-home-'))
    a = checkout('A1')
    b = checkout('B1')
    lane.pointLaneAt(a, env())
    client = new Client({ name: 'proxy-test', version: '0.0.0' })
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      listChanged++
    })
    const inherited = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined))
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [PROXY], env: { ...inherited, OBSRV_DEV_HOME: home } }))
  }, 20_000)

  afterAll(async () => {
    await client?.close()
    for (const d of [home, a, b]) rmSync(d, { recursive: true, force: true })
  })

  it("answers from the lane's build, with that server in dev mode, and names the lane in the handshake", async () => {
    expect(text(await client.callTool({ name: 'build' }))).toBe('A1 dev=1')
    expect(client.getServerVersion()?.version).toContain('dev lane')
  })

  it('stamps every tool result with the build that answered: the lane, when it was built, where it is', async () => {
    // The pointer is shared by every session on the machine: `npm run lane`
    // in one moves another's obsrv-dev. The stamp is how a reader knows
    // which build answered without asking (obsrv-8d's point).
    const r = await client.callTool({ name: 'build' })
    expect(stamp(r)).toMatch(/^obsrv-dev lane: .* · server built \d/)
    expect(stamp(r)).toContain(a)
  })

  it('a new build answers the next call on the same connection, and the client is told the tools may have changed', async () => {
    const before = listChanged
    build(a, 'A2')
    expect(text(await client.callTool({ name: 'build' }))).toBe('A2 dev=1')
    await expect.poll(() => listChanged).toBeGreaterThan(before)
  })

  it('moving the lane to another checkout moves the next call with it, and that result says the lane moved', async () => {
    lane.pointLaneAt(b, env())
    const r = await client.callTool({ name: 'build' })
    expect(text(r)).toBe('B1 dev=1')
    expect(stamp(r)).toMatch(/the lane moved since this session's last call/)
    expect(stamp(r)).toContain(b)
    const again = await client.callTool({ name: 'build' })
    expect(stamp(again)).not.toMatch(/moved/)
  })

  it('a call in flight finishes on the build it started on; the next waits for it, then runs on the new one', async () => {
    const slow = client.callTool({ name: 'slow' })
    await new Promise(r => setTimeout(r, 150))
    build(b, 'B2')
    const next = client.callTool({ name: 'build' })
    expect(text(await slow)).toBe('slow B1')
    expect(text(await next)).toBe('B2 dev=1')
  })

  it('a server that dies mid-call fails that call with a sentence, and the next call starts it again', async () => {
    const died = await client.callTool({ name: 'die' })
    expect(isError(died)).toBe(true)
    expect(text(died)).toMatch(/^the dev lane's server exited .* before answering/)
    expect(text(await client.callTool({ name: 'build' }))).toBe('B2 dev=1')
  })

  it('a lane pointed at a checkout that is gone says where it pointed, and recovers when pointed again', async () => {
    const gone = checkout('G')
    lane.pointLaneAt(gone, env())
    rmSync(gone, { recursive: true, force: true })
    const r = await client.callTool({ name: 'build' })
    expect(isError(r)).toBe(true)
    expect(text(r)).toContain('no dev lane')
    expect(text(r)).toContain(gone)
    lane.pointLaneAt(a, env())
    expect(text(await client.callTool({ name: 'build' }))).toBe('A2 dev=1')
  })
})
