/**
 * Which keys a reply actually carries, and which keys a JSON Schema allows —
 * as two sets of dotted paths that can be subtracted.
 *
 * This is the check that found `colorPainted`, and the reason it lives here
 * rather than in the sweep script alone: three undeclared keys shipped in one
 * week (`obsrv_inspect`'s `colorPainted`, `obsrv_drive`'s three status keys,
 * live `obsrv_snap`'s `onionSkin` and `loading`), and every one was found by a
 * person reading an error days or months later. `scripts/schema-emit-sweep.js`
 * compares these two sets on the paths its calls exercise; the server compares
 * them on every reply it sends under `OBSRV_TEST`. One definition, so the two
 * cannot drift into disagreeing about what "declared" means.
 *
 * Paths are dotted, with `[]` for array element (`readout.notes[]`,
 * `groups[].kind`), so a key nested inside an object or an array is named the
 * same way by both walkers. **Nesting is the point**: `colorPainted` sits
 * inside `readout`, and `drive`'s three sit inside a spread status, so a check
 * that only looked at top-level keys would have passed every instance it was
 * written for.
 */

/** Every key path a value carries, following objects and array elements. */
export function emittedKeyPaths(value: unknown, path = '', out = new Set<string>()): Set<string> {
  if (value === null || typeof value !== 'object') return out
  if (Array.isArray(value)) {
    for (const item of value) emittedKeyPaths(item, `${path}[]`, out)
    return out
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const p = path ? `${path}.${k}` : k
    out.add(p)
    emittedKeyPaths(v, p, out)
  }
  return out
}

/**
 * Every key path a JSON Schema declares, following `properties`, `items` and
 * the composition branches. A union is flattened rather than resolved: a key
 * declared in any branch counts as declared, because this answers "could this
 * key legitimately appear here", not "is this document valid" — the client's
 * validator answers the second, and this has to stay the weaker of the two so
 * it never fails a reply a client would accept.
 */
export function schemaKeyPaths(schema: unknown, path = '', out = new Set<string>()): Set<string> {
  if (schema === null || typeof schema !== 'object') return out
  const s = schema as Record<string, unknown>
  for (const branch of ['anyOf', 'oneOf', 'allOf']) {
    const b = s[branch]
    if (Array.isArray(b)) for (const sub of b) schemaKeyPaths(sub, path, out)
  }
  if (s.items !== undefined) schemaKeyPaths(s.items, `${path}[]`, out)
  // An object that admits keys it does not name — `additionalProperties: true`,
  // or a record whose values have a schema but whose key names are free — says
  // nothing about which names appear, so everything below it is declared by
  // construction. Marked open rather than walked: flagging a record's own keys
  // would be a false red on a reply every client accepts, and a check that
  // cries wolf in a suite with flakes is a check that gets switched off.
  if (s.additionalProperties !== undefined && s.additionalProperties !== false) out.add(path === '' ? '*' : `${path}.*`)
  if (s.properties !== null && typeof s.properties === 'object') {
    for (const [k, sub] of Object.entries(s.properties as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k
      out.add(p)
      schemaKeyPaths(sub, p, out)
    }
  }
  return out
}

/**
 * The emitted paths a schema does not declare, in the order they were found.
 * Empty means agreement on the paths this reply exercises — never that the
 * schema and the emitter agree everywhere, since a field emitted only on
 * another code path is invisible here. That limit is why this runs on every
 * reply the suite produces rather than on one sample.
 *
 * A path under an open object (`additionalProperties: true`) is allowed, and
 * so is everything below it.
 */
export function undeclaredKeyPaths(emitted: Set<string>, declared: Set<string>): string[] {
  // `*` is the root itself being open, which opens everything below it; any
  // other marker opens one subtree. Spelled apart because `''.*` would have
  // matched nothing and made a root-level open object a FALSE RED — unreachable
  // on today's shapes, which are all `additionalProperties: false`, and wrong
  // the day one is not.
  const open = [...declared].filter(p => p === '*' || p.endsWith('.*')).map(p => (p === '*' ? '' : p.slice(0, -2)))
  return [...emitted].filter(
    p => !declared.has(p) && !open.some(o => o === '' || p === o || p.startsWith(`${o}.`) || p.startsWith(`${o}[`)),
  )
}
