// RC PROBE: version skew. The RC's MCP server against the last released app (v0.60.0 in /Applications),
// live. Every tool that has a live path, verbatim, with any -32602 recorded.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
const url = process.argv[2]
const pkg = process.argv[3]
const t0 = Date.now()
const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`
const transport = new StdioClientTransport({ command: 'npx', args: ['-y', pkg, 'mcp'], stderr: 'pipe' })
transport.stderr?.on('data', d => process.stdout.write(`[server stderr ${stamp()}] ${d}`))
const client = new Client({ name: 'rc-skew', version: '0.0.1' })
await client.connect(transport)
await client.listTools()
const calls = [
  ['obsrv_drive', {}],
  ['obsrv_snap', { url }],
  ['obsrv_inspect', { url, selector: 'h1' }],
  ['obsrv_audit', { url }],
  ['obsrv_lint', { url }],
  ['obsrv_drive', { preset: 'laptop-768', capture: 'pane' }],
]
let failures = 0
for (const [name, args] of calls) {
  console.log(`${stamp()} calling ${name} ${JSON.stringify(args)}`)
  try {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 })
    const s = r.structuredContent ?? {}
    const text = (r.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n')
    if (r.isError) failures++
    console.log(`${stamp()} ${name} isError=${r.isError === true} mode=${s.mode} launched=${s.launched} why=${s.why}${r.isError ? `\n  text=${text.slice(0, 800)}` : ''}`)
  } catch (e) {
    failures++
    console.log(`${stamp()} ${name} THREW code=${e?.code} ${String(e?.message ?? e).slice(0, 800)}`)
  }
}
console.log(`SKEW RESULT: ${failures} of ${calls.length} calls failed`)
await client.close()
