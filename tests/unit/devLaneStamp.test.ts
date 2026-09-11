import { describe, expect, it } from 'vitest'
import { laneStamp, stampField, withStamp } from '../../src/mcp/devLane'

/**
 * Which build answered, in the part of a tool result a client shows. Claude
 * Code shows a tool's structured content and not its text blocks, and a
 * client validates structured content against the output schema it listed —
 * every obsrv schema says `additionalProperties: false`, so a new key would
 * fail every call of a session that listed the tools before it existed. The
 * stamp goes into a field the schema already declares: `notes`, else
 * `warnings`. The lane is one pointer shared by every session, so this is
 * how a session sees that another moved it (obsrv-8d's point).
 */
describe('the dev lane stamp in structured results', () => {
  it('goes into notes when the tool declares them, else warnings, else nowhere', () => {
    expect(stampField({ notes: 1, warnings: 1 })).toBe('notes')
    expect(stampField({ warnings: 1 })).toBe('warnings')
    expect(stampField({ presets: 1 })).toBeNull()
    expect(stampField(undefined)).toBeNull()
  })

  it('is appended to that field, which is created when absent; an error or a result with no structured content is left alone', () => {
    const s = 'obsrv-dev lane: x'
    expect(withStamp({ structuredContent: { notes: ['a'] } }, 'notes', s).structuredContent).toEqual({ notes: ['a', s] })
    expect(withStamp({ structuredContent: { url: 'u' } }, 'warnings', s).structuredContent).toEqual({ url: 'u', warnings: [s] })
    const failed = { isError: true, structuredContent: { notes: [] } }
    expect(withStamp(failed, 'notes', s)).toBe(failed)
    const plain = { content: [] }
    expect(withStamp(plain, 'notes', s)).toBe(plain)
  })

  it('names the branch and commit, when the server was built, and the checkout', () => {
    expect(laneStamp('topic @ abc1234', Date.parse('2026-09-11T20:18:45'), '/wt')).toMatch(/^obsrv-dev lane: topic @ abc1234 · server built \d.* · \/wt$/)
  })
})
