import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * `dist:signed` is the whole release gate, so the chaining is the gate.
 *
 * Until this change `ci.yml` carried its own `codesign`/`spctl`/`stapler` block
 * after the build, so the script being chained or not was a local convenience.
 * That block is gone — two copies of a release gate is one copy that can drift,
 * and the drift it produced was real: `#466` chained the script into
 * `dist:signed` without adding `SIGNING_IDENTITY` to the step that runs it, so
 * the first signed release would have built, notarised, and then failed at the
 * last command of the build.
 *
 * With the shell copy removed, deleting one line from `package.json` would
 * silently remove every identity assertion from the release and leave a green
 * log. These three facts are what stop that: the script is chained, it exists,
 * and it runs AFTER electron-builder rather than before it — verifying first
 * would assert against whatever the previous build left in `dist/`.
 */
const ROOT = join(__dirname, '..', '..')
const VERIFIER = 'scripts/verifySigningIdentity.js'
const SIGN_DMGS = 'scripts/signDmgs.js'

const distSigned = (): string => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>
  }
  const script = pkg.scripts?.['dist:signed']
  expect(script, 'package.json has no dist:signed script').toBeTruthy()
  return script as string
}

describe('dist:signed chains the identity assertion', () => {
  it('runs the verifier', () => {
    expect(distSigned()).toContain(`node ${VERIFIER}`)
  })

  it('names a verifier that is actually in the tree', () => {
    expect(existsSync(join(ROOT, VERIFIER))).toBe(true)
  })

  it('runs it after electron-builder, not before', () => {
    const script = distSigned()
    const built = script.indexOf('electron-builder')
    const verified = script.indexOf(VERIFIER)
    expect(built, 'dist:signed does not run electron-builder').toBeGreaterThanOrEqual(0)
    expect(verified).toBeGreaterThan(built)
  })
})

/**
 * electron-builder's `notarize` option never touches the `.dmg` it wraps the
 * signed `.app` in — only `signDmgs.js` signs, notarises and staples the DMG
 * itself. `verifySigningIdentity.js`'s "every .dmg must be stapled" rule
 * asserts that happened, so it has to run AFTER signDmgs, not before it: a
 * build that forgot this line would staple nothing and still read as a pass
 * if the verifier ran first and saw no DMG yet, or never ran at all if the
 * line were simply deleted and nothing noticed.
 */
describe('dist:signed chains the DMG signer', () => {
  it('runs signDmgs.js', () => {
    expect(distSigned()).toContain(`node ${SIGN_DMGS}`)
  })

  it('names a signer that is actually in the tree', () => {
    expect(existsSync(join(ROOT, SIGN_DMGS))).toBe(true)
  })

  it('runs it after electron-builder and before the verifier', () => {
    const script = distSigned()
    const built = script.indexOf('electron-builder')
    const signed = script.indexOf(SIGN_DMGS)
    const verified = script.indexOf(VERIFIER)
    expect(built, 'dist:signed does not run electron-builder').toBeGreaterThanOrEqual(0)
    expect(signed).toBeGreaterThan(built)
    expect(verified).toBeGreaterThan(signed)
  })
})
