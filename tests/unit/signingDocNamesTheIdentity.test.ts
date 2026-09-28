import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

/**
 * `docs/signing.md` §3 tells a human what to type to produce a signed build.
 * `dist:signed` ends in `scripts/verifySigningIdentity.js`, which REFUSES when
 * `SIGNING_IDENTITY` is unset — correctly, because an unnamed target and no
 * check are the same gap. For a while the two disagreed: the script began
 * requiring the variable and §3's command block never mentioned it, so
 * following the documented steps failed at the build's last command, after
 * paying for a full notarisation round trip.
 *
 * That is the defect this test is bought by. It keys off the script's own
 * exported `IDENTITY_VAR` rather than a copy of the name, so renaming the
 * variable points here instead of silently un-documenting it.
 */
const ROOT = join(__dirname, '..', '..')
const { IDENTITY_VAR } = createRequire(__filename)('../../scripts/verifySigningIdentity.js') as { IDENTITY_VAR: string }

/** §3's first fenced block — the one a reader copies. */
function localBuildBlock(): string {
  const doc = readFileSync(join(ROOT, 'docs', 'signing.md'), 'utf8')
  const from = doc.indexOf('## 3.')
  expect(from, 'docs/signing.md has no section 3').toBeGreaterThan(-1)
  const rest = doc.slice(from)
  const open = rest.indexOf('```')
  const close = rest.indexOf('```', open + 3)
  expect(open, 'section 3 has no fenced command block').toBeGreaterThan(-1)
  expect(close).toBeGreaterThan(open)
  return rest.slice(open, close)
}

describe('the local signed build the doc describes', () => {
  it('exports every variable the build itself refuses to run without', () => {
    expect(localBuildBlock()).toContain(IDENTITY_VAR)
  })

  it('runs the script whose requirement that is', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
    // If this stops being true the test above is guarding nothing: the doc
    // would be required to export a variable no documented command reads.
    expect(pkg.scripts?.['dist:signed']).toContain('verifySigningIdentity.js')
  })

  it('says in section 3 that the build refuses without it, so nobody deletes the line as noise', () => {
    // A distinct fact from the export being present, and deliberately NOT
    // "the name appears in section 3": the first version of this test asserted
    // that, and passed with the export line deleted, because the prose beside
    // it still mentioned the name. An assertion satisfiable by neighbouring
    // text is the defect this repo keeps finding.
    const doc = readFileSync(join(ROOT, 'docs', 'signing.md'), 'utf8')
    const section3 = doc.slice(doc.indexOf('## 3.'), doc.indexOf('## 4.'))
    expect(section3).toMatch(/refuses/)
  })
})
