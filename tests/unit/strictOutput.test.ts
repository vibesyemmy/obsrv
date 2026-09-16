import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { rejectUndeclaredKeysUnderTest } from '../../src/mcp/strictOutput'

/**
 * The registration wrapper, against a stand-in server rather than a real one.
 *
 * Worth unit-testing rather than leaving to the MCP specs: the case that
 * matters most is a tool **missing from the published list**, and the e2e arms
 * poison exactly one tool, so a tool quietly dropping out of the map passes
 * every one of them. That is how the first version of this file shipped with
 * the check silently off for such a tool — the card's own subject, committed
 * inside the fix for it.
 */

interface Listed {
  name: string
  outputSchema?: unknown
}

const schemaOf = (properties: Record<string, unknown>): unknown => ({ type: 'object', properties, additionalProperties: false })

/** A server that publishes `listed` and records the handlers registered on it. */
function stand(listed: Listed[]): {
  target: { registerTool: unknown; server: unknown }
  call: (tool: string) => Promise<CallToolResult>
} {
  const registered = new Map<string, (...args: unknown[]) => Promise<CallToolResult>>()
  const target = {
    registerTool(name: unknown, _config: unknown, handler: unknown) {
      registered.set(String(name), handler as (...args: unknown[]) => Promise<CallToolResult>)
    },
    server: { _requestHandlers: new Map([['tools/list', async () => ({ tools: listed })]]) },
  }
  return { target, call: tool => registered.get(tool)!({}) }
}

const reply = (structuredContent: Record<string, unknown>): CallToolResult => ({ content: [], structuredContent })

let warnings: string[]
const warn = (line: string): void => void warnings.push(line)

beforeEach(() => {
  warnings = []
  process.env.OBSRV_STRICT_OUTPUT = '1'
})
afterEach(() => {
  delete process.env.OBSRV_STRICT_OUTPUT
  delete process.env.OBSRV_TEST_UNDECLARED_KEY
})

describe('a tool whose reply is checked', () => {
  const setUp = (listed: Listed[], config: unknown, structured: Record<string, unknown>) => {
    const s = stand(listed)
    rejectUndeclaredKeysUnderTest(s.target, warn)
    ;(s.target.registerTool as (n: unknown, c: unknown, h: unknown) => void)('obsrv_x', config, async () => reply(structured))
    return s
  }
  const published = [{ name: 'obsrv_x', outputSchema: schemaOf({ readout: schemaOf({ color: {} }) }) }]

  it('passes a reply whose every key is declared', async () => {
    const s = setUp(published, { outputSchema: {} }, { readout: { color: '#fff' } })
    await expect(s.call('obsrv_x')).resolves.toMatchObject({ structuredContent: { readout: { color: '#fff' } } })
  })

  it('fails a reply with a nested undeclared key, naming the tool and the path', async () => {
    const s = setUp(published, { outputSchema: {} }, { readout: { color: '#fff', colorPainted: '#eee' } })
    await expect(s.call('obsrv_x')).rejects.toThrow(/obsrv_x emitted 1 key.*readout\.colorPainted/s)
  })

  it('skips an error reply rather than reading it as an empty one', async () => {
    const s = stand(published)
    rejectUndeclaredKeysUnderTest(s.target, warn)
    ;(s.target.registerTool as (n: unknown, c: unknown, h: unknown) => void)('obsrv_x', { outputSchema: {} }, async () => ({
      content: [],
      isError: true,
      structuredContent: { anything: 1 },
    }))
    await expect(s.call('obsrv_x')).resolves.toMatchObject({ isError: true })
  })

  it('does nothing at all with the fence off, undeclared key and all', async () => {
    delete process.env.OBSRV_STRICT_OUTPUT
    const s = setUp(published, { outputSchema: {} }, { readout: { color: '#fff', colorPainted: '#eee' } })
    await expect(s.call('obsrv_x')).resolves.toMatchObject({ structuredContent: { readout: { colorPainted: '#eee' } } })
  })
})

describe('a tool the published list does not carry', () => {
  const register = (listed: Listed[], config: unknown) => {
    const s = stand(listed)
    rejectUndeclaredKeysUnderTest(s.target, warn)
    ;(s.target.registerTool as (n: unknown, c: unknown, h: unknown) => void)('obsrv_x', config, async () => reply({ anything: 1 }))
    return s
  }

  it('fails the call when the registration promised a schema — the check cannot run, so it must not pass', async () => {
    // The regression this test exists for: with the published list read lazily,
    // "absent from the map" covered both this case and the harmless one below,
    // so a tool that dropped out of the list was silently unchecked while every
    // e2e arm — which poisons one other tool — stayed green.
    const s = register([{ name: 'obsrv_other', outputSchema: schemaOf({}) }], { outputSchema: {} })
    await expect(s.call('obsrv_x')).rejects.toThrow(/obsrv_x declared an output schema at registration that the server does not publish/)
  })

  it('passes when the registration promised no schema, because nothing it sends is undeclared', async () => {
    const s = register([{ name: 'obsrv_other', outputSchema: schemaOf({}) }], { description: 'no output schema here' })
    await expect(s.call('obsrv_x')).resolves.toMatchObject({ structuredContent: { anything: 1 } })
  })

  it('fails every schema-declaring tool, loudly, when the list cannot be read at all', async () => {
    // A different failure from the one above — the mechanism is gone rather
    // than one tool missing — and it gets its own sentence, so a reader knows
    // whether to look at one registration or at the SDK. It still fails: a
    // check that cannot run must not report as having run.
    const s = stand([])
    ;(s.target as { server: unknown }).server = {}
    rejectUndeclaredKeysUnderTest(s.target, warn)
    ;(s.target.registerTool as (n: unknown, c: unknown, h: unknown) => void)('obsrv_x', { outputSchema: {} }, async () => reply({ a: 1 }))
    await expect(s.call('obsrv_x')).rejects.toThrow(/published tool list could not be read/)
    expect(warnings.join('\n')).toContain('strict output check DISABLED')
  })

  it('still passes a tool that promised no schema, even then', async () => {
    const s = stand([])
    ;(s.target as { server: unknown }).server = {}
    rejectUndeclaredKeysUnderTest(s.target, warn)
    ;(s.target.registerTool as (n: unknown, c: unknown, h: unknown) => void)('obsrv_x', { description: 'none' }, async () => reply({ a: 1 }))
    await expect(s.call('obsrv_x')).resolves.toMatchObject({ structuredContent: { a: 1 } })
  })
})
