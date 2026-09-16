#!/usr/bin/env node
// obsrv-dev: the MCP server a session registers for the dev lane (README,
// "Developing: the dev lane"). A proxy: it runs the lane's own server —
// `<checkout>/bin/obsrv-mcp.js`, in dev mode — as a child and passes the
// protocol through. When the lane's server build changes (`npm run build`
// rewrote out/mcp/server.js) or the lane moves to another checkout, it starts
// that child again before the next call, replays the session's handshake to
// it, and tells the client the tools may have changed. A call made after a
// build therefore runs the build, on the same connection: no session restart.
//
// A call already running when the build changes finishes on the child it
// started on; the next waits for it, then runs on the new one. A child that
// exits mid-call fails that call with a sentence, and the next call starts it
// again. With no lane — nothing pointed yet, or pointed at a checkout that is
// gone — the proxy still answers the handshake, lists no tools and fails each
// call saying where the lane points and how to set it, and starts the lane's
// server the moment there is one.
//
// The lane is one pointer shared by every session on the machine, so
// `npm run lane` in one session moves every other session's obsrv-dev. Every
// tool result therefore ends with a line naming the build that answered —
// branch, commit, when the server was built, where — and the first result
// after a move says the lane moved, from where. The handshake's version
// names the lane too.
//
// A stamp still leaves the comparison to whoever reads it, and twice nobody
// made it: a session testing its branch from a worktree was answered by the
// lane's checkout instead (bug-lane-serves-another-tree). Nothing here can
// make it either, because nothing here knows the caller's tree. So every tool
// gains a required `tree`, the checkout the call is meant to test, and a call
// naming another checkout is not run. "any" runs on whatever the lane serves.
//
// Messages are newline-delimited JSON-RPC, the MCP stdio framing.
'use strict'

const { spawn, spawnSync } = require('node:child_process')
const { existsSync, realpathSync } = require('node:fs')
const { isAbsolute, join } = require('node:path')
const lane = require('./devLane.js')

const REPLAY_ID = 'obsrv-dev-lane-replay'
const REPLAY_TIMEOUT_MS = 20_000

const write = msg => process.stdout.write(`${JSON.stringify(msg)}\n`)
const log = line => process.stderr.write(`obsrv-dev: ${line}\n`)

/** The client's `initialize` request, replayed to every child after the first. */
let initRequest = null
/** Whether the client has sent `notifications/initialized`. */
let initialized = false
/** Whether the client has had an answer to `initialize`, from a child or from here. */
let answeredInit = false
/** The running child: { proc, root, key, tree, label, built, inflight: Map<id, method>, replayIds: Set<id>, waiters, lastErr, exited }. */
let child = null
let replaySeq = 0
const replays = new Map()
/** The lane that answered this session's last tool call: { root, label }, or null before the first. */
let lastAnswered = null

/**
 * The argument the proxy adds to every tool. Nothing in this process can tell
 * which tree the session calling works in: its working directory and
 * CLAUDE_PROJECT_DIR are the project the session opened, whichever worktree it
 * works in afterwards (four sessions read on 2026-09-16, including one working
 * in a worktree inside that project).
 */
const TREE = 'tree'
const ANY_TREE = 'any'
const TREE_PROPERTY = {
  type: 'string',
  description:
    'The checkout this call is meant to test: the top of the working tree you are working in, as ' +
    '`git rev-parse --show-toplevel` prints it there. obsrv-dev runs one checkout for the whole machine, and a ' +
    `call naming another is not run rather than answered by the lane's build. "${ANY_TREE}" runs on whatever the lane serves.`,
}

/** A tool as a client sees it through the proxy: its own arguments, and `tree`, required. */
function withTree(tool) {
  const schema = tool.inputSchema || { type: 'object' }
  const required = Array.isArray(schema.required) ? schema.required.filter(k => k !== TREE) : []
  return {
    ...tool,
    inputSchema: { ...schema, properties: { ...(schema.properties || {}), [TREE]: TREE_PROPERTY }, required: [...required, TREE] },
  }
}

/** The top of the git working tree `path` is in, through symlinks; null when it is in none. */
function toplevel(path) {
  const r = spawnSync('git', ['-C', path, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' })
  if (r.status !== 0) return null
  try {
    return realpathSync(r.stdout.trim())
  } catch {
    return null
  }
}

/**
 * Why a call may not run on child `c`'s lane, or null when it may. Checkouts
 * compare by their tops, not by one path containing the other: a worktree can
 * sit inside the checkout it came from, and is not that checkout.
 */
function treeRefusal(tree, c) {
  const serves = `the dev lane serves ${c.label} at ${c.root}`
  if (tree === ANY_TREE) return null
  if (typeof tree !== 'string' || tree.trim() === '')
    return (
      `not run: this call names no \`${TREE}\`, the checkout it is meant to test. The dev lane serves ${c.label} at ` +
      `${c.root}, one checkout for the whole machine, and obsrv-dev cannot tell which tree you work in: pass the top ` +
      `of your working tree as \`${TREE}\`, or "${ANY_TREE}" to run on that checkout as it is`
    )
  const named = isAbsolute(tree) ? toplevel(tree) : null
  if (named === null)
    return (
      `not run: \`${TREE}\` is ${JSON.stringify(tree)}, which is not an absolute path in a git checkout on this machine. ` +
      `Pass the top of your working tree, or "${ANY_TREE}"; ${serves}`
    )
  if (named === c.tree) return null
  return (
    `not run: this call is meant to test ${named}, but ${serves}, and that build would have answered it. ` +
    `\`npm run lane\` in ${named} points the lane there, for every session on this machine; ` +
    `${TREE}: "${ANY_TREE}" runs this call on ${c.root} as it is`
  )
}

/** The lane as it stands: its checkout and a key that changes with every server build; root null when there is none. */
function currentLane() {
  const root = lane.laneCheckout()
  if (root === null || !existsSync(join(root, 'bin', 'obsrv-mcp.js'))) return { root: null, key: null }
  return { root, key: `${root}\n${lane.serverStamp(root)}` }
}

function noLaneSentence() {
  const target = lane.laneTarget()
  return target === null
    ? 'no dev lane: nothing is pointed at yet — run `npm run lane` in the checkout to test, and the next call runs its build'
    : `no dev lane: ${lane.pointerPath()} points at ${target}, which is gone or has no bin/obsrv-mcp.js — ` +
        'run `npm run lane` in a checkout to point the lane there'
}

/** An error to a client request: a tool result for a tool call, which the model reads; a JSON-RPC error otherwise. */
function answerError(id, method, text) {
  if (method === 'tools/call') write({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: true } })
  else write({ jsonrpc: '2.0', id, error: { code: -32603, message: text } })
}

/** The answers the proxy gives itself while there is no lane to ask. */
function answerLocally(msg) {
  switch (msg.method) {
    case 'initialize':
      answeredInit = true
      return write({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: (msg.params && msg.params.protocolVersion) || '2025-06-18',
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: 'obsrv-dev', version: '0.0.0-no-lane' },
          instructions: noLaneSentence(),
        },
      })
    case 'tools/list':
      return write({ jsonrpc: '2.0', id: msg.id, result: { tools: [] } })
    case 'ping':
      return write({ jsonrpc: '2.0', id: msg.id, result: {} })
    default:
      return answerError(msg.id, msg.method, noLaneSentence())
  }
}

function send(c, msg) {
  if (!c.exited) c.proc.stdin.write(`${JSON.stringify(msg)}\n`)
}

function startChild(root, key) {
  const proc = spawn(process.execPath, [join(root, 'bin', 'obsrv-mcp.js')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, OBSRV_DEV: '1' },
  })
  const c = {
    proc,
    root,
    key,
    tree: toplevel(root) || root,
    label: lane.laneLabel(root),
    built: new Date(lane.serverStamp(root)).toLocaleTimeString(),
    inflight: new Map(),
    replayIds: new Set(),
    waiters: [],
    lastErr: [],
    exited: false,
  }
  proc.stdout.setEncoding('utf8')
  proc.stderr.setEncoding('utf8')
  let buffer = ''
  proc.stdout.on('data', chunk => {
    buffer += chunk
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
      const line = buffer.slice(0, i)
      buffer = buffer.slice(i + 1)
      if (line.trim() !== '') fromChild(c, line)
    }
  })
  proc.stderr.on('data', chunk => {
    process.stderr.write(chunk)
    c.lastErr = [...c.lastErr, ...chunk.split('\n').filter(l => l.trim() !== '')].slice(-3)
  })
  proc.stdin.on('error', () => undefined) // EPIPE once the child is gone; its exit says the rest
  proc.on('error', err => onChildExit(c, null, null, err.message))
  proc.on('exit', (code, signal) => onChildExit(c, code, signal))
  log(`running ${root} (${c.label}, server built ${c.built})`)
  return c
}

function fromChild(c, line) {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    process.stdout.write(`${line}\n`)
    return
  }
  if (typeof msg.id === 'string' && msg.id.startsWith(REPLAY_ID)) {
    const settle = replays.get(msg.id)
    replays.delete(msg.id)
    c.replayIds.delete(msg.id)
    if (settle) settle(msg.error === undefined)
    return
  }
  if (msg.method === undefined && msg.id !== undefined && c.inflight.has(msg.id)) {
    const method = c.inflight.get(msg.id)
    c.inflight.delete(msg.id)
    if (method === 'initialize' && msg.result) {
      // Promise the client list-changed notifications: they are how a rebuilt server's tools reach it.
      const caps = msg.result.capabilities || {}
      msg.result.capabilities = { ...caps, tools: { ...(caps.tools || {}), listChanged: true } }
      const info = msg.result.serverInfo || {}
      msg.result.serverInfo = { ...info, version: `${info.version || '?'} (dev lane: ${c.label})` }
      answeredInit = true
    }
    if (method === 'tools/list' && msg.result && Array.isArray(msg.result.tools)) {
      msg.result.tools = msg.result.tools.map(withTree)
    }
    if (method === 'tools/call' && msg.result && Array.isArray(msg.result.content)) {
      msg.result.content = [...msg.result.content, { type: 'text', text: stampFor(c) }]
    }
    if (c.inflight.size === 0) for (const done of c.waiters.splice(0)) done()
  }
  write(msg)
}

/** The line a tool result ends with: which build answered, and whether the lane moved since the last one. */
function stampFor(c) {
  const line = `obsrv-dev lane: ${c.label} · server built ${c.built} · ${c.root}`
  const moved = lastAnswered !== null && lastAnswered.root !== c.root ? lastAnswered : null
  lastAnswered = { root: c.root, label: c.label }
  return moved === null
    ? line
    : `${line} — the lane moved since this session's last call, from ${moved.root} (${moved.label}): ` +
        '`npm run lane` in any checkout moves it for every session'
}

function onChildExit(c, code, signal, error) {
  if (c.exited) return
  c.exited = true
  const how = error ? `could not start: ${error}` : signal ? `on ${signal}` : `with code ${code}`
  const said = c.lastErr.length > 0 ? ` (its last words: ${c.lastErr.join(' | ').slice(0, 300)})` : ''
  for (const [id, method] of c.inflight) {
    answerError(id, method, `the dev lane's server exited ${how} before answering${said}; the next call starts it again from ${c.root}`)
  }
  c.inflight.clear()
  for (const done of c.waiters.splice(0)) done()
  // Only this child's own handshake: the old child's exit during a restart
  // must not fail the new one's.
  for (const id of c.replayIds) {
    const settle = replays.get(id)
    replays.delete(id)
    if (settle) settle(false)
  }
  c.replayIds.clear()
  if (child === c) child = null
}

/** Replays the session's handshake to a new child, swallowing its answer; false when the child never gave one. */
function replay(c) {
  const id = `${REPLAY_ID}:${++replaySeq}`
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      replays.delete(id)
      c.replayIds.delete(id)
      resolve(false)
    }, REPLAY_TIMEOUT_MS)
    replays.set(id, ok => {
      clearTimeout(timer)
      resolve(ok)
    })
    c.replayIds.add(id)
    send(c, { ...initRequest, id })
  })
}

/**
 * The child that runs the lane as it stands, started (again) when the build
 * or the lane changed: `{ child }`, `{ local: true }` with no lane, or
 * `{ error }` when the lane's server would not start.
 */
async function ready(msg) {
  const now = currentLane()
  if (now.root === null) return { local: true }
  if (child !== null && child.key === now.key) return { child }
  if (child !== null && child.inflight.size > 0) {
    // Calls in flight finish on the child they started on; then look again.
    await new Promise(done => child.waiters.push(done))
    return ready(msg)
  }
  const restarting = answeredInit
  if (child !== null) {
    const old = child
    child = null
    old.proc.kill('SIGTERM')
  }
  const c = startChild(now.root, now.key)
  child = c
  if (msg.method !== 'initialize' && initRequest !== null) {
    const ok = await replay(c)
    if (!ok || c.exited) {
      const said = c.lastErr.length > 0 ? `: ${c.lastErr.join(' | ').slice(0, 300)}` : ''
      if (!c.exited) c.proc.kill('SIGTERM')
      if (child === c) child = null
      return { error: `the dev lane's server at ${now.root} did not start${said} — run npm run build there, and the next call tries again` }
    }
    if (initialized) send(c, { jsonrpc: '2.0', method: 'notifications/initialized' })
  }
  if (restarting && initialized) write({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })
  return { child: c }
}

async function handle(msg) {
  if (msg.method === undefined) {
    // An answer to something the server asked the client: the server that asked is the running one.
    if (child !== null) send(child, msg)
    return
  }
  const isRequest = msg.id !== undefined
  if (msg.method === 'initialize') initRequest = msg
  if (msg.method === 'notifications/initialized') initialized = true
  const r = await ready(msg)
  if (r.local) {
    if (isRequest) answerLocally(msg)
    return
  }
  if (r.error !== undefined) {
    if (isRequest) answerError(msg.id, msg.method, r.error)
    return
  }
  let forward = msg
  if (msg.method === 'tools/call') {
    const args = (msg.params && msg.params.arguments) || {}
    const refused = treeRefusal(args[TREE], r.child)
    if (refused !== null) {
      if (isRequest) answerError(msg.id, msg.method, refused)
      return
    }
    // The lane's server never declared `tree`, so it never sees it.
    const own = { ...args }
    delete own[TREE]
    forward = { ...msg, params: { ...msg.params, arguments: own } }
  }
  if (isRequest) r.child.inflight.set(msg.id, msg.method)
  send(r.child, forward)
}

// One message at a time, in order: a restart waits for what is in flight,
// and whatever arrives meanwhile queues behind it rather than racing it.
let chain = Promise.resolve()
function fromClient(line) {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  chain = chain.then(() => handle(msg)).catch(e => log(`a message was dropped: ${e && e.message ? e.message : e}`))
}

process.stdin.setEncoding('utf8')
let inbound = ''
process.stdin.on('data', chunk => {
  inbound += chunk
  for (let i = inbound.indexOf('\n'); i >= 0; i = inbound.indexOf('\n')) {
    const line = inbound.slice(0, i)
    inbound = inbound.slice(i + 1)
    if (line.trim() !== '') fromClient(line)
  }
})
const shutDown = () => {
  if (child !== null && !child.exited) child.proc.kill('SIGTERM')
  process.exit(0)
}
process.stdin.on('end', shutDown)
process.on('SIGTERM', shutDown)
process.on('SIGINT', shutDown)
