#!/usr/bin/env node
// Plain-Node launcher for the Obsrv MCP server (stdio transport): checks for
// the compiled entry and runs it in-process so stdin/stdout stay the protocol
// channel. Register with an MCP client as `node /path/to/bin/obsrv-mcp.js`.
//
// Prerequisites: `npm install` and `npm run build` in the Obsrv repo — the
// launcher runs the *built* out/mcp/server.js, never the TypeScript sources.
'use strict'

const { existsSync } = require('node:fs')
const { join } = require('node:path')

const serverEntry = join(__dirname, '..', 'out', 'mcp', 'server.js')
if (!existsSync(serverEntry)) {
  console.error('obsrv-mcp: out/mcp/server.js is missing — run `npm run build` in the Obsrv repo first')
  process.exit(1)
}

require(serverEntry)
