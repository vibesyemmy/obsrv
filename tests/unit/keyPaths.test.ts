import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { emittedKeyPaths, schemaKeyPaths, undeclaredKeyPaths } from '../../src/shared/keyPaths'

/**
 * The comparison that both `scripts/schema-emit-sweep.js` and the server's
 * `OBSRV_TEST` check run. Two things here decide whether it is worth having at
 * all, and both are tested against the real conversion rather than a hand-made
 * schema: that it sees a key nested inside an object or an array, and that it
 * does not cry wolf on an object whose key names are free.
 */

const declared = (shape: z.ZodRawShape): Set<string> =>
  schemaKeyPaths(z.toJSONSchema(z.object(shape), { io: 'output', unrepresentable: 'any' }))

describe('emittedKeyPaths', () => {
  it('names every key, dotted through objects and [] through arrays', () => {
    const paths = emittedKeyPaths({ a: 1, b: { c: { d: 2 } }, e: [{ f: 3 }], g: null })
    // `e[]` itself is not a path: an array element is not a key, so the array
    // is named once and its elements' keys are named under it.
    expect([...paths].sort()).toEqual(['a', 'b', 'b.c', 'b.c.d', 'e', 'e[].f', 'g'])
  })

  it('is not confused by a primitive, an empty array or an empty object', () => {
    expect([...emittedKeyPaths('text')]).toEqual([])
    expect([...emittedKeyPaths({ a: [], b: {} }).values()].sort()).toEqual(['a', 'b'])
  })
})

describe('the comparison finds a key where the real instances hid', () => {
  it('finds one nested inside an object — where colorPainted was', () => {
    // The actual defect: `readout.colorPainted` emitted, `readoutShape` not
    // declaring it. A top-level check passes this, which is why there isn't one.
    const shape = { found: z.boolean(), readout: z.object({ color: z.string() }) }
    const emitted = emittedKeyPaths({ found: true, readout: { color: '#fff', colorPainted: '#eee' } })
    expect(undeclaredKeyPaths(emitted, declared(shape))).toEqual(['readout.colorPainted'])
  })

  it('finds one inside an array element', () => {
    const shape = { groups: z.array(z.object({ kind: z.string() })) }
    const emitted = emittedKeyPaths({ groups: [{ kind: 'text' }, { kind: 'image', size: 12 }] })
    expect(undeclaredKeyPaths(emitted, declared(shape))).toEqual(['groups[].size'])
  })

  it('says nothing when every emitted key is declared, including optional ones left out', () => {
    const shape = { a: z.string(), b: z.number().optional(), c: z.object({ d: z.string() }) }
    const emitted = emittedKeyPaths({ a: 'x', c: { d: 'y' } })
    expect(undeclaredKeyPaths(emitted, declared(shape))).toEqual([])
  })

  it('counts a key declared in any branch of a union as declared', () => {
    // `readout` is nullable on several tools, so the reply's shape is a union
    // and its keys live in one branch only.
    const shape = { readout: z.union([z.object({ element: z.string() }), z.null()]) }
    const emitted = emittedKeyPaths({ readout: { element: 'p#grey' } })
    expect(undeclaredKeyPaths(emitted, declared(shape))).toEqual([])
  })
})

describe('what it deliberately does not flag', () => {
  it('allows free key names under a record, and everything below them', () => {
    // A false red here would be a suite failing on a reply every client
    // accepts — the way a check gets switched off.
    const shape = { byId: z.record(z.string(), z.object({ n: z.number() })) }
    const emitted = emittedKeyPaths({ byId: { anything: { n: 1 }, other: { n: 2 } } })
    expect(undeclaredKeyPaths(emitted, declared(shape))).toEqual([])
  })

  it('allows anything under an object that admits unnamed keys', () => {
    const open = { meta: { type: 'object', additionalProperties: true } }
    const emitted = emittedKeyPaths({ meta: { whatever: { deeper: 1 } } })
    expect(undeclaredKeyPaths(emitted, schemaKeyPaths({ type: 'object', properties: open }))).toEqual([])
  })

  it('opens everything when the ROOT admits unnamed keys', () => {
    // Unreachable on today's shapes — every tool's root is
    // `additionalProperties: false` — and a false red the day one is not,
    // which is the kind of latent wrong answer that surfaces as "the check is
    // broken" long after anyone remembers why.
    const emitted = emittedKeyPaths({ anything: { deeper: 1 } })
    expect(undeclaredKeyPaths(emitted, schemaKeyPaths({ type: 'object', additionalProperties: true }))).toEqual([])
  })

  it('still flags a sibling of an open object, so openness does not leak outwards', () => {
    const s = { type: 'object', properties: { meta: { type: 'object', additionalProperties: true }, named: { type: 'string' } } }
    const emitted = emittedKeyPaths({ meta: { free: 1 }, named: 'x', extra: 2 })
    expect(undeclaredKeyPaths(emitted, schemaKeyPaths(s))).toEqual(['extra'])
  })
})
