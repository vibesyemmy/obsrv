#!/usr/bin/env node
// Every MCP tool's emitted keys against the keys its own schema allows.
//
// `obsrv_inspect` returned `colorPainted`, a field `readoutShape` does not
// list, on a schema that is `additionalProperties: false` — so the server
// rejected its own correct reply with `-32602` and a retry hid it
// (`bug-inspect-readout-schema`). That instance was found by reading one error
// message. Nothing had compared the full set of fields each tool emits against
// what each tool's schema allows, which is what this does.
//
//   node scripts/schema-emit-sweep.js [--url <fixture url>]
//
// It drives the real MCP server over stdio, exactly as a client does, so the
// server's own validation is the check: a tool whose reply carries a key its
// schema forbids fails with -32602 naming the path, and one whose reply
// validates is compared key-by-key anyway, because a field that is merely
// UNDECLARED-and-absent today is the same defect waiting for the branch that
// emits it.
//
// WHAT THIS CANNOT SEE, stated because a sweep that reports nothing is worth
// what its coverage is worth: a field emitted only on a code path this call
// does not take. `colorPainted` itself is conditional. So a clean run means
// "no violation on the paths these calls exercise", never "the schemas and the
// emitters agree".
'use strict'

const { spawn } = require('node:child_process')
const { resolve, join } = require('node:path')
const { pathToFileURL } = require('node:url')

const root = resolve(__dirname, '..')
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 || args[i + 1] === undefined ? fallback : args[i + 1]
}
const URL_ = flag('url', pathToFileURL(join(root, 'tests', 'fixtures', 'audit.html')).href)

/** One JSON-RPC conversation with the server on its stdio. */
function client() {
  const child = spawn(process.execPath, [join(root, 'bin', 'obsrv-mcp.js')], {
    env: { ...process.env, OBSRV_HEADLESS: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let buf = ''
  const waiting = new Map()
  child.stdout.on('data', d => {
    buf += String(d)
    let i
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      const done = waiting.get(msg.id)
      if (done) {
        waiting.delete(msg.id)
        done(msg)
      }
    }
  })
  let id = 0
  const send = (method, params) =>
    new Promise(done => {
      const mine = ++id
      waiting.set(mine, done)
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: mine, method, params })}\n`)
    })
  return { send, stop: () => child.kill('SIGTERM'), stderr: child.stderr }
}

/** Every key path a JSON value carries, so nesting is compared and not just the top level. */
const keysOf = (v, path = '', out = new Set()) => {
  if (v === null || typeof v !== 'object') return out
  if (Array.isArray(v)) {
    v.forEach(x => keysOf(x, `${path}[]`, out))
    return out
  }
  for (const [k, x] of Object.entries(v)) {
    const p = path ? `${path}.${k}` : k
    out.add(p)
    keysOf(x, p, out)
  }
  return out
}

/** Every key path a JSON Schema declares, following properties and items. */
const schemaKeys = (s, path = '', out = new Set()) => {
  if (!s || typeof s !== 'object') return out
  for (const branch of ['anyOf', 'oneOf', 'allOf']) if (Array.isArray(s[branch])) s[branch].forEach(x => schemaKeys(x, path, out))
  if (s.items) schemaKeys(s.items, `${path}[]`, out)
  if (s.properties) {
    for (const [k, sub] of Object.entries(s.properties)) {
      const p = path ? `${path}.${k}` : k
      out.add(p)
      schemaKeys(sub, p, out)
    }
  }
  return out
}

/** Minimal arguments per tool: enough to get a reply, nothing that changes the shape. */
const callFor = url => ({
  obsrv_presets: {},
  obsrv_snap: { url, preset: 'laptop-768', mode: 'headless' },
  obsrv_audit: { url, preset: 'android-65', mode: 'headless' },
  obsrv_lint: { url, preset: 'android-65', mode: 'headless' },
  obsrv_inspect: { url, preset: 'android-65', mode: 'headless', selector: 'body' },
  obsrv_diff: { url, preset: 'laptop-768' },
  obsrv_report: { url, presets: ['laptop-768'] },
  // obsrv_drive is deliberately absent: it launches and drives the visible app,
  // which is a different surface and not headless-safe in a sweep.
})

async function main() {
  const c = client()
  await c.send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'schema-emit-sweep', version: '1' } })
  const listed = await c.send('tools/list', {})
  const tools = listed.result?.tools ?? []
  const calls = callFor(URL_)
  const rows = []

  for (const tool of tools) {
    const params = calls[tool.name]
    if (params === undefined) {
      rows.push({ tool: tool.name, status: 'skipped', detail: 'not exercised by this sweep' })
      continue
    }
    const reply = await c.send('tools/call', { name: tool.name, arguments: params })
    if (reply.error) {
      rows.push({ tool: tool.name, status: 'REJECTED BY ITS OWN SCHEMA', detail: String(reply.error.message).slice(0, 300) })
      continue
    }
    const structured = reply.result?.structuredContent
    if (!structured) {
      rows.push({ tool: tool.name, status: 'no structuredContent', detail: '' })
      continue
    }
    const emitted = keysOf(structured)
    const allowed = schemaKeys(tool.outputSchema ?? {})
    const undeclared = [...emitted].filter(k => !allowed.has(k))
    rows.push({
      tool: tool.name,
      status: undeclared.length ? 'EMITS UNDECLARED KEYS' : 'ok',
      detail: undeclared.slice(0, 12).join(', '),
      emitted: emitted.size,
      allowed: allowed.size,
    })
  }

  c.stop()
  for (const r of rows) {
    process.stdout.write(`${r.tool.padEnd(16)} ${r.status.padEnd(28)} ${r.detail}\n`)
  }
  const bad = rows.filter(r => r.status !== 'ok' && r.status !== 'skipped')
  process.stdout.write(`\n${bad.length} tool(s) with a schema/emit disagreement, ${rows.length} examined.\n`)
  process.stdout.write('A clean line means no violation on the paths THESE calls exercise — not that the schemas and the emitters agree.\n')
  process.exit(0)
}

main().catch(e => {
  process.stderr.write(`schema-emit-sweep: ${e && e.stack ? e.stack : e}\n`)
  process.exit(1)
})
