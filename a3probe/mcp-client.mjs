// RC PROBE: a first MCP session on a cold machine against a release-candidate tarball, verbatim.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
const url = process.argv[2]
const pkg = process.argv[3]
const t0 = Date.now()
const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`
const transport = new StdioClientTransport({ command: 'npx', args: ['-y', pkg, 'mcp'], stderr: 'pipe' })
transport.stderr?.on('data', d => process.stdout.write(`[server stderr ${stamp()}] ${d}`))
const client = new Client({ name: 'rc-stranger', version: '0.0.1' })
await client.connect(transport)
const tools = await client.listTools()
console.log(`${stamp()} connected, ${tools.tools.length} tools: ${tools.tools.map(t => t.name).join(', ')}`)
for (const [name, args] of [['obsrv_presets', {}], ['obsrv_snap', { url, preset: 'laptop-768' }], ['obsrv_audit', { url, preset: 'laptop-768' }], ['obsrv_lint', { url }], ['obsrv_snap', { url, preset: 'laptop-768', mode: 'headless' }]]) {
  console.log(`${stamp()} calling ${name} ${JSON.stringify(args)}`)
  try {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 600_000 })
    const s = r.structuredContent ?? {}
    const text = (r.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n')
    console.log(`${stamp()} ${name} isError=${r.isError === true} mode=${s.mode} launched=${s.launched} why=${s.why}\n  notes=${JSON.stringify(s.notes ?? [])}\n  warnings=${JSON.stringify(s.warnings ?? [])}${r.isError ? `\n  text=${text.slice(0, 600)}` : ''}`)
  } catch (e) {
    console.log(`${stamp()} ${name} THREW: ${e?.message ?? e}`)
  }
}
await client.close()
