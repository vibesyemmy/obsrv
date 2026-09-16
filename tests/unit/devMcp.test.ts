import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { laneStamp } from '../../src/mcp/devLane'

/**
 * The obsrv-dev proxy (scripts/dev-mcp.js): the one MCP server a session
 * registers for the dev lane. It runs the lane's own server in dev mode and
 * starts it again when the lane's build changes or the lane moves, replaying
 * the handshake, so a call after `npm run build` runs the new code on the
 * same connection — no session restart. Driven here with a real MCP client
 * against fake checkouts whose server answers which build it is, and records
 * every message it was sent.
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
server.registerTool('noted', { description: 'stamps its structured result, as the lane server does' }, async () => ({
  ...text('noted ' + MARK),
  structuredContent: { notes: ['a note', ${JSON.stringify(laneStamp(mark, 0, root))}] },
}))
process.stdin.on('data', chunk => require('node:fs').appendFileSync(require('node:path').join(__dirname, '..', '..', 'received.jsonl'), chunk))
server.connect(new StdioServerTransport())
`,
  )
  // Newer than the last build whatever the clock's resolution: the stamp is what the proxy compares.
  const t = Date.now() / 1000 + ++bump
  utimesSync(file, t, t)
}
function checkout(mark: string): string {
  const root = mkdtempSync(join(tmpdir(), 'obsrv-proxy-co-'))
  git(root, 'init', '-q')
  mkdirSync(join(root, 'bin'))
  mkdirSync(join(root, 'out', 'mcp'), { recursive: true })
  writeFileSync(join(root, 'bin', 'obsrv-mcp.js'), "require('../out/mcp/server.js')\n")
  build(root, mark)
  return root
}
function git(root: string, ...args: string[]): void {
  execFileSync('git', ['-C', root, '-c', 'user.name=proxy-test', '-c', 'user.email=proxy-test@example.com', ...args], { stdio: 'ignore' })
}
/** The tool calls the fake build at `root` was sent, as they reached it. */
const callsTo = (root: string): { params?: { arguments?: Record<string, unknown> } }[] => {
  let raw = ''
  try {
    raw = readFileSync(join(root, 'received.jsonl'), 'utf8')
  } catch {
    return []
  }
  return raw
    .split('\n')
    .filter(l => l.trim() !== '')
    .map(l => JSON.parse(l) as { method?: string; params?: { arguments?: Record<string, unknown> } })
    .filter(m => m.method === 'tools/call')
}
/** A call that runs on whatever the lane serves: what every test not about `tree` means. */
const ANY = { tree: 'any' }
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
    expect(text(await client.callTool({ name: 'build', arguments: ANY }))).toBe('A1 dev=1')
    expect(client.getServerVersion()?.version).toContain('dev lane')
  })

  it('stamps every tool result with the build that answered: the lane, when it was built, where it is', async () => {
    // The pointer is shared by every session on the machine: `npm run lane`
    // in one moves another's obsrv-dev. The stamp is how a reader knows
    // which build answered without asking (obsrv-8d's point).
    const r = await client.callTool({ name: 'build', arguments: ANY })
    expect(stamp(r)).toMatch(/^obsrv-dev lane: .* · server built \d/)
    expect(stamp(r)).toContain(a)
  })

  it('every tool gains a required `tree`, because nothing in the proxy can tell which checkout the caller works in', async () => {
    const { tools } = await client.listTools()
    expect(tools.map(t => t.name)).toEqual(['build', 'slow', 'die', 'noted'])
    for (const t of tools) {
      expect(t.inputSchema.properties?.['tree']).toMatchObject({ type: 'string' })
      expect(t.inputSchema.required).toContain('tree')
    }
  })

  it("a call naming the lane's checkout, or a directory in it, runs there, and the build is never sent `tree`", async () => {
    expect(text(await client.callTool({ name: 'build', arguments: { tree: a } }))).toBe('A1 dev=1')
    expect(text(await client.callTool({ name: 'build', arguments: { tree: join(a, 'out', 'mcp') } }))).toBe('A1 dev=1')
    const calls = callsTo(a)
    expect(calls.length).toBeGreaterThan(1)
    for (const call of calls) expect(call.params?.arguments ?? {}).not.toHaveProperty('tree')
  })

  it('a call naming another checkout is not run: it names both, says how to point the lane, and never reaches the build', async () => {
    const before = callsTo(a).length
    const r = await client.callTool({ name: 'build', arguments: { tree: b } })
    expect(isError(r)).toBe(true)
    expect(text(r)).toContain(`meant to test ${realpathSync(b)}`)
    expect(text(r)).toContain(`serves`)
    expect(text(r)).toContain(a)
    expect(text(r)).toContain('npm run lane')
    expect(text(r)).toContain(`calls meant for ${realpathSync(a)} are then refused instead`)
    expect(callsTo(a).length).toBe(before)
  })

  it('an "any" answer says it was not compared, in the text stamp and the structured one; a compared answer does not', async () => {
    const checked = await client.callTool({ name: 'noted', arguments: { tree: a } })
    const unchecked = await client.callTool({ name: 'noted', arguments: ANY })
    const notes = (r: unknown): string[] => (r as { structuredContent: { notes: string[] } }).structuredContent.notes
    expect(stamp(checked)).not.toContain('not compared')
    expect(notes(checked)[1]).not.toContain('not compared')
    expect(stamp(unchecked)).toContain('tree "any": not compared with your checkout')
    // The real server's stamp, not a copy of its wording: the proxy finds the line to mark by its prefix,
    // so rewording laneStamp must turn this red rather than leave "any" answers unmarked (Wren's read).
    expect(notes(unchecked)).toEqual(['a note', `${laneStamp('A1', 0, a)} · tree "any": not compared with your checkout`])
  })

  it("a worktree inside the lane's checkout is another checkout, not the lane's", async () => {
    // The finding's shape: a session's worktree under .claude/worktrees sits
    // inside the checkout the lane serves, so containment would call it the lane's.
    git(a, 'commit', '-q', '--allow-empty', '-m', 'a')
    const worktree = join(a, 'nested', 'wt')
    git(a, 'worktree', 'add', '-q', '--detach', worktree)
    const r = await client.callTool({ name: 'build', arguments: { tree: worktree } })
    expect(isError(r)).toBe(true)
    expect(text(r)).toContain(`meant to test ${realpathSync(worktree)}`)
  })

  it('a call naming no checkout, or a path in none, is not run and says what to pass; "any" runs on the lane as it is', async () => {
    const none = await client.callTool({ name: 'build' })
    expect(isError(none)).toBe(true)
    expect(text(none)).toContain('names no `tree`')
    // What to pass, and not "any": a caller that never thought about trees should not be handed the one value that skips the check (Wren's read).
    expect(text(none)).toContain('git rev-parse --show-toplevel')
    expect(text(none)).not.toContain('"any"')
    for (const tree of ['obsrv', join(tmpdir(), `obsrv-proxy-nowhere-${process.pid}`)]) {
      const r = await client.callTool({ name: 'build', arguments: { tree } })
      expect(isError(r)).toBe(true)
      expect(text(r)).toContain('not an absolute path in a git checkout')
      expect(text(r)).not.toContain('"any"')
    }
    expect(text(await client.callTool({ name: 'build', arguments: ANY }))).toBe('A1 dev=1')
  })

  it('a new build answers the next call on the same connection, and the client is told the tools may have changed', async () => {
    const before = listChanged
    build(a, 'A2')
    expect(text(await client.callTool({ name: 'build', arguments: ANY }))).toBe('A2 dev=1')
    await expect.poll(() => listChanged).toBeGreaterThan(before)
  })

  it('moving the lane to another checkout moves the next call with it, and that result says the lane moved', async () => {
    lane.pointLaneAt(b, env())
    const r = await client.callTool({ name: 'build', arguments: ANY })
    expect(text(r)).toBe('B1 dev=1')
    expect(stamp(r)).toMatch(/the lane moved since this session's last call/)
    expect(stamp(r)).toContain(b)
    const again = await client.callTool({ name: 'build', arguments: ANY })
    expect(stamp(again)).not.toMatch(/moved/)
  })

  it('a call in flight finishes on the build it started on; the next waits for it, then runs on the new one', async () => {
    const slow = client.callTool({ name: 'slow', arguments: ANY })
    await new Promise(r => setTimeout(r, 150))
    build(b, 'B2')
    const next = client.callTool({ name: 'build', arguments: ANY })
    expect(text(await slow)).toBe('slow B1')
    expect(text(await next)).toBe('B2 dev=1')
  })

  it('a server that dies mid-call fails that call with a sentence, and the next call starts it again', async () => {
    const died = await client.callTool({ name: 'die', arguments: ANY })
    expect(isError(died)).toBe(true)
    expect(text(died)).toMatch(/^the dev lane's server exited .* before answering/)
    expect(text(await client.callTool({ name: 'build', arguments: ANY }))).toBe('B2 dev=1')
  })

  it('a lane pointed at a checkout that is gone says where it pointed, and recovers when pointed again', async () => {
    const gone = checkout('G')
    lane.pointLaneAt(gone, env())
    rmSync(gone, { recursive: true, force: true })
    const r = await client.callTool({ name: 'build', arguments: ANY })
    expect(isError(r)).toBe(true)
    expect(text(r)).toContain('no dev lane')
    expect(text(r)).toContain(gone)
    lane.pointLaneAt(a, env())
    expect(text(await client.callTool({ name: 'build', arguments: ANY }))).toBe('A2 dev=1')
  })
})
