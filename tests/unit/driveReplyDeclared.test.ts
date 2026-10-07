import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseControlStatus } from '../../src/shared/control'
import { DRIVE_DROPPED_STATUS_KEYS, driveReplyStatus } from '../../src/mcp/driveReply'

/**
 * **Every key the app's `status` can carry is either declared by `obsrv_drive`'s
 * published output schema or dropped on purpose.**
 *
 * The class this closes, measured rather than imagined: `#592` removed
 * `orientation` from `driveOutputShape` and left the handler spreading
 * `...status`, so every live drive call emitted a key the schema refused. Each
 * output schema is `additionalProperties: false`, so a client that has called
 * `tools/list` gets `-32602` on every call — the tool is unusable for it. The
 * suite caught it with **29 e2e failures**; nothing cheaper did, because the
 * unit guards read schemas and the shape check reads `tools/list`, and neither
 * ever built a reply. This test builds one.
 *
 * Read from the **built** server's `tools/list`, not from the zod, for the
 * reason `scripts/public-shape.js` gives: "declared" means what a client holds.
 *
 * **What it does not check:** that the handler calls `driveReplyStatus`. Put
 * `...status` back and this still passes — **measured, not assumed**. The
 * wiring is `tests/unit/driveReplyWired.test.ts`'s job, which drives the built
 * server against a stub control server and goes red on exactly that mutant
 * while this file stays green. This one makes the *set relation* a unit-level
 * fact, so a new field on the app's status costs one red unit test instead of
 * 29 red e2e tests half an hour later.
 */

const SERVER = resolve(__dirname, '../../out/mcp/server.js')

/** A status with every field `parseControlStatus` accepts, so no key is missed. */
const FULL_RAW = {
  version: '0.63.1',
  url: 'https://example.com/',
  presetId: '1080p-24',
  profileId: 'reference',
  viewMode: '1:1',
  mode: 'url',
  panes: 'both',
  tabId: 't1',
  tabIndex: 0,
  orientation: 'landscape',
  textScale: 1,
  throttle: 'none',
  onionSkin: 0,
  loading: false,
  error: { code: -6, description: 'ERR_FILE_NOT_FOUND', url: 'file:///nope' },
  cssWidth: 1920,
  cssHeight: 1080,
  deviceScaleFactor: 2,
  screenShape: 'landscape',
  visionType: 'none',
  visionSeverity: 1,
  tabs: [{ id: 't1', url: 'https://example.com/', title: 'Example', presetId: '1080p-24', active: true }],
}

async function declaredDriveKeys(): Promise<string[]> {
  const client = new Client({ name: 'drive-reply-declared', version: '0' }, { capabilities: {} })
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env, OBSRV_TEST: '1' } })
  await client.connect(transport)
  try {
    const { tools } = await client.listTools()
    const drive = tools.find(t => t.name === 'obsrv_drive')
    expect(drive, 'obsrv_drive is not published').toBeDefined()
    const schema = drive?.outputSchema as { properties?: Record<string, unknown> } | undefined
    return Object.keys(schema?.properties ?? {})
  } finally {
    await client.close()
  }
}

describe("obsrv_drive's reply cannot carry a key its published schema refuses", () => {
  it('builds before it can be read', () => {
    expect(existsSync(SERVER), `${SERVER} is missing — run npm run build`).toBe(true)
  })

  it('the status fixture is complete, or this test checks less than it claims', () => {
    // A field added to `parseControlStatus` and not to FULL_RAW would be absent
    // from the comparison below and invisible to it — the fixture is the half
    // of this check that can rot quietly.
    const status = parseControlStatus(FULL_RAW)
    expect(status, 'FULL_RAW is not a valid status').not.toBeNull()
    expect(Object.keys(status ?? {}).length).toBeGreaterThan(18)
    for (const key of Object.keys(status ?? {})) expect(FULL_RAW, `${key} is produced but not in FULL_RAW`).toHaveProperty(key)
  })

  it('every key the reply spreads is declared, and the dropped ones are exactly the documented list', async () => {
    const declared = await declaredDriveKeys()
    // Non-vacuity: a schema read that came back empty would make the subset
    // check below trivially true in the wrong direction.
    expect(declared.length, 'the published drive schema declares almost nothing — the read failed').toBeGreaterThan(10)
    const status = parseControlStatus(FULL_RAW)
    expect(status).not.toBeNull()
    const spread = Object.keys(driveReplyStatus(status!))
    const undeclared = spread.filter(k => !declared.includes(k))
    expect(undeclared, `the drive reply would carry keys the schema refuses: ${undeclared.join(', ')}`).toEqual([])
    // And the other direction: what was dropped is what the register says was
    // dropped, so removing a key from the schema without dropping it here (the
    // #592 defect) or dropping one the schema still declares both fail.
    const dropped = Object.keys(status!).filter(k => !spread.includes(k))
    expect(dropped.sort()).toEqual([...DRIVE_DROPPED_STATUS_KEYS].sort())
    for (const key of DRIVE_DROPPED_STATUS_KEYS) {
      expect(declared, `${key} is dropped from the reply but still declared by the schema`).not.toContain(key)
    }
  })
})
