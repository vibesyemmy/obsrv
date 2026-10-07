import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { startStubApp, type StubApp } from './stubControlApp'

/**
 * **Turning the live screen works against an app that has `setRotation` and
 * against one that does not — both directions of the version skew.**
 *
 * `setOrientation` named the preset's STORED form, so `'landscape'` produced a
 * portrait screen on every preset stored landscape (`bug-orientation-name`).
 * `setRotation { rotate }` replaces it. **Opeyemi's shape: rename and keep the
 * old name accepted this release**, because the MCP server ships on npm and the
 * app ships as a DMG and they update independently:
 *
 *  - **older pinned server, newer app** — the app still accepts
 *    `setOrientation`. Removing it was measured against a stub and the user's
 *    error read "the app was closed or Agent control was toggled off", which is
 *    false (room #4101).
 *  - **newer server, older app** — this file. Every DMG in the wild answers
 *    `400 unknown command` to `setRotation`, so the client falls back. Raised by
 *    Wren before it was built (#4189), who asked for exactly these two stubs.
 *
 * The third case is the one a fallback makes easy to get wrong: a 400 that is
 * **not** an unknown command must surface rather than be re-sent under the other
 * name, or a payload bug in our own client turns into a silent retry.
 */

const SERVER = resolve(__dirname, '../../out/mcp/server.js')

let app: StubApp | null = null
afterEach(async () => {
  await app?.close()
  app = null
})

async function driveRotate(controlFile: string, rotate = true): Promise<{ isError: boolean; structured: Record<string, unknown>; text: string }> {
  const client = new Client({ name: 'set-rotation-skew', version: '0' }, { capabilities: {} })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: { ...process.env, OBSRV_CONTROL_FILE: controlFile },
  })
  await client.connect(transport)
  try {
    const r = (await client.callTool({ name: 'obsrv_drive', arguments: { rotate } })) as {
      isError?: boolean
      structuredContent?: Record<string, unknown>
      content?: { text?: string }[]
    }
    return { isError: r.isError === true, structured: r.structuredContent ?? {}, text: (r.content ?? []).map(b => b.text ?? '').join(' ') }
  } finally {
    await client.close()
  }
}

describe('rotating the live screen across the app/server version skew', () => {
  it('builds before it can be read', () => {
    expect(existsSync(SERVER), `${SERVER} is missing — run npm run build`).toBe(true)
  })

  it('an app that has `setRotation` is sent it, and only it', async () => {
    app = await startStubApp()
    const r = await driveRotate(app.controlFile)
    expect(r.isError, r.text.slice(0, 300)).toBe(false)
    expect(r.structured['rotated']).toBe(true)
    expect(app.orientation(), 'the stub was not actually rotated').toBe('landscape')
    expect(app.seen).toContain('setRotation')
    // The deprecated name must not be sent to an app that did not need it:
    // a client that sent both would hide a broken `setRotation` behind the alias.
    expect(app.seen, `commands: ${app.seen.join(', ')}`).not.toContain('setOrientation')
  })

  it('an app that predates `setRotation` still rotates, through the deprecated name', async () => {
    app = await startStubApp({ unknown: ['setRotation'] })
    const r = await driveRotate(app.controlFile)
    expect(r.isError, r.text.slice(0, 300)).toBe(false)
    expect(r.structured['rotated']).toBe(true)
    // The rotation actually landed, which is the point — not merely that a
    // second command was sent.
    expect(app.orientation(), 'the fallback did not rotate the stub').toBe('landscape')
    expect(app.seen.filter(c => c === 'setRotation' || c === 'setOrientation')).toEqual(['setRotation', 'setOrientation'])
  })

  it('the fallback carries `rotate: false` too, and does not just ask for the rotated screen', async () => {
    // **The mutant this exists for, found by Idris on the pushed head (#4201):**
    // a fallback that ignores `rotate` and always sends `orientation:
    // 'landscape'` passed every other test here, because each of them only ever
    // asks for `rotate: true`. Against an older app that would answer
    // `obsrv_drive { rotate: false }` with a ROTATED screen — a wrong answer the
    // caller cannot detect, which is the whole class this release is about.
    // Both directions through the deprecated name, so neither value is merely
    // "the state it was already in".
    app = await startStubApp({ unknown: ['setRotation'] })

    const on = await driveRotate(app.controlFile, true)
    expect(on.isError, on.text.slice(0, 300)).toBe(false)
    expect(app.orientation()).toBe('landscape')

    const off = await driveRotate(app.controlFile, false)
    expect(off.isError, off.text.slice(0, 300)).toBe(false)
    expect(app.orientation(), 'the fallback asked for a rotated screen when none was wanted').toBe('portrait')
    expect(off.structured['rotated']).toBe(false)
    // Every turn went through the deprecated name, since the stub has no `setRotation`.
    expect(app.seen.filter(c => c === 'setOrientation').length).toBe(2)
  })

  it('a 400 that is not an unknown command is NOT retried under the other name', async () => {
    app = await startStubApp({ badPayload: ['setRotation'] })
    const r = await driveRotate(app.controlFile)
    expect(r.isError, 'a payload error was swallowed').toBe(true)
    expect(r.text).toContain('setRotation payload must be')
    expect(app.seen, `commands: ${app.seen.join(', ')}`).not.toContain('setOrientation')
    expect(app.orientation()).toBe('portrait')
  })
})
