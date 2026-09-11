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
// Messages are newline-delimited JSON-RPC, the MCP stdio framing.
'use strict'

const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')
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
/** The running child: { proc, root, key, inflight: Map<id, method>, replayIds: Set<id>, waiters, lastErr, exited }. */
let child = null
let replaySeq = 0
const replays = new Map()

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
  const c = { proc, root, key, inflight: new Map(), replayIds: new Set(), waiters: [], lastErr: [], exited: false }
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
  log(`running ${root} (${lane.laneLabel(root)}, server built ${new Date(lane.serverStamp(root)).toLocaleTimeString()})`)
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
      answeredInit = true
    }
    if (c.inflight.size === 0) for (const done of c.waiters.splice(0)) done()
  }
  write(msg)
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
  if (isRequest) r.child.inflight.set(msg.id, msg.method)
  send(r.child, msg)
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
