import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const { listTools } = createRequire(__filename)('../../scripts/public-shape.js') as {
  listTools: () => Promise<{ name: string; outputSchema?: Schema }[]>
}

/**
 * A live reply is built by the app, and the app an MCP server drives can be
 * older than the server. The plugin pins `getobsrv@<version>` and moves with
 * the plugin; `Obsrv.app` is updated by hand. So a key the app computes, which
 * the published output schema *requires*, fails every live call against an app
 * released before that key existed — the SDK checks the server's own reply
 * against the output shape and answers -32602 before any client sees it.
 *
 * That is what `readout.colorPainted` did on its way into 0.61.0: required, so
 * a 0.61.0 server refused every live `obsrv_inspect` that found an element on
 * a 0.60.0 app. The fields before it follow a convention — optional, with a
 * description saying "Absent from an app older than the field" — and this
 * holds the published schemas to it. One direction only: plenty of optional
 * keys are optional for other reasons, and say so.
 *
 * Reads the BUILT server, like `publicShape.test.ts`.
 */

interface Schema {
  type?: string | string[]
  properties?: Record<string, Schema>
  required?: string[]
  items?: Schema
  anyOf?: Schema[]
  oneOf?: Schema[]
  allOf?: Schema[]
  description?: string
}

const OLDER_APP = 'Absent from an app older than the field'

/** Every property in a schema, with the object schema that declares it. */
function eachProperty(schema: Schema | undefined, path: string, visit: (path: string, key: string, owner: Schema, prop: Schema) => void): void {
  if (schema === undefined || schema === null || typeof schema !== 'object') return
  for (const branch of [schema.anyOf, schema.oneOf, schema.allOf]) for (const sub of branch ?? []) eachProperty(sub, path, visit)
  if (schema.items !== undefined) eachProperty(schema.items, `${path}[]`, visit)
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    const at = path ? `${path}.${key}` : key
    visit(at, key, schema, prop)
    eachProperty(prop, at, visit)
  }
}

describe('a key only a newer app sends is not required of an older one', () => {
  it("obsrv_inspect's readout does not require colorPainted, and still requires color", async () => {
    const inspect = (await listTools()).find(t => t.name === 'obsrv_inspect')
    expect(inspect?.outputSchema, 'obsrv_inspect publishes no output schema').toBeDefined()
    const owners: Schema[] = []
    eachProperty(inspect!.outputSchema, '', (at, _key, owner) => {
      if (at === 'readout.colorPainted') owners.push(owner)
    })
    // Found exactly where it is declared, so the `required` read below is the
    // readout's own list and not some other object's.
    expect(owners, 'readout.colorPainted is not in the published schema at all').toHaveLength(1)
    const required = owners[0]?.required ?? []
    expect(required, 'the readout lists nothing as required, so this reads the wrong object').toContain('color')
    expect(required).not.toContain('colorPainted')
  })

  it(`every key described "${OLDER_APP}" is optional, on every tool`, async () => {
    const tools = await listTools()
    const described: string[] = []
    const requiredAnyway: string[] = []
    for (const tool of tools) {
      eachProperty(tool.outputSchema, '', (at, key, owner, prop) => {
        if (!(prop.description ?? '').includes(OLDER_APP)) return
        described.push(`${tool.name} ${at}`)
        if (owner.required?.includes(key)) requiredAnyway.push(`${tool.name} ${at}`)
      })
    }
    // pageRect, layoutScale, deviceScaleFactor, error and colorPainted at
    // least: a reading that finds none has not read the schemas.
    expect(described.length, 'no published key says it is absent from an older app').toBeGreaterThanOrEqual(5)
    expect(requiredAnyway, 'described as absent from an older app, but required').toEqual([])
  })
})
