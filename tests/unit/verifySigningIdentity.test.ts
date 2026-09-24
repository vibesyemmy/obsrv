import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

/**
 * The local signed build asserts what it was signed AS.
 *
 * `docs/signing.md` §3's warning is not theoretical: the first build anyone ran
 * after it was written signed as `Restack Dev` and **reported success**, because
 * `codesign` and `spctl` both accept a wrong-account signature. `ci.yml` has
 * asserted the identity since `#397`; `npm run dist:signed` on a desk asserted
 * nothing, which is where that build happened.
 *
 * The authority text below is the shape `codesign -dv --verbose=4` actually
 * prints — several `Authority=` lines, leaf first — so the wrong-identity case is
 * the real failure rather than a synthetic string.
 */
const {
  identityVerdict,
  gatekeeperVerdict,
  verify,
  IDENTITY_VAR,
} = createRequire(__filename)('../../scripts/verifySigningIdentity.js') as {
  identityVerdict: (authority: string, expected: string) => { ok: boolean; reason?: string }
  gatekeeperVerdict: (verdict: string) => { ok: boolean; reason?: string }
  verify: (a: {
    apps: string[]
    dmgs: string[]
    expected: string
    run: (cmd: string, args: string[]) => string
  }) => { ok: boolean; failures: string[]; apps: number; dmgs: number }
  IDENTITY_VAR: string
}

const WANTED = 'Developer ID Application: Voicify Limited (NDXPR623CF)'
const RIGHT = [
  'Executable=/Users/x/dist/mac/Obsrv.app/Contents/MacOS/Obsrv',
  `Authority=${WANTED}`,
  'Authority=Developer ID Certification Authority',
  'Authority=Apple Root CA',
  'TeamIdentifier=NDXPR623CF',
].join('\n')
/** What the build that shipped wrong actually printed. */
const WRONG = [
  'Executable=/Users/x/dist/mac/Obsrv.app/Contents/MacOS/Obsrv',
  'Authority=Restack Dev',
  'TeamIdentifier=not set',
].join('\n')
const NOTARIZED = 'dist/mac/Obsrv.app: accepted\nsource=Notarized Developer ID\norigin=' + WANTED

describe('identityVerdict', () => {
  it('accepts the authority that names the expected identity', () => {
    expect(identityVerdict(RIGHT, WANTED).ok).toBe(true)
  })
  it('rejects the Restack Dev signature that reported success, and says what it found', () => {
    const v = identityVerdict(WRONG, WANTED)
    expect(v.ok).toBe(false)
    // The reason has to name BOTH, or the reader cannot tell a wrong identity
    // from a missing one.
    expect(v.reason).toContain('Restack Dev')
    expect(v.reason).toContain(WANTED)
  })
  it('rejects an unset expectation rather than passing vacuously', () => {
    // `ci.yml` fails rather than skips for the same reason: an unnamed target and
    // no check are the same silent gap.
    const v = identityVerdict(RIGHT, '')
    expect(v.ok).toBe(false)
    expect(v.reason).toContain(IDENTITY_VAR)
  })
  it('rejects output with no Authority line at all, and says so', () => {
    const v = identityVerdict('code object is not signed at all', WANTED)
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('no Authority line at all')
  })
})

describe('gatekeeperVerdict', () => {
  it('accepts a notarized Developer ID verdict', () => {
    expect(gatekeeperVerdict(NOTARIZED).ok).toBe(true)
  })
  it('rejects a signature that verifies but was never notarised', () => {
    // This one shows the damaged-app dialog on a machine that has never been
    // online — the failure a user meets rather than a builder.
    const v = gatekeeperVerdict('dist/mac/Obsrv.app: accepted\nsource=Developer ID')
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('notarized')
  })
})

describe('verify', () => {
  const run = (out: Record<string, string>, throwOn: string[] = []) => (cmd: string, args: string[]) => {
    if (throwOn.includes(cmd)) throw new Error(`${cmd} failed`)
    return out[cmd] ?? ''
  }

  it('passes a build signed and notarised as the expected identity', () => {
    const r = verify({
      apps: ['dist/mac/Obsrv.app'],
      dmgs: ['dist/Obsrv-1.0.0.dmg'],
      expected: WANTED,
      run: run({ codesign: RIGHT, spctl: NOTARIZED, xcrun: 'The validate action worked!' }),
    })
    expect(r.failures).toEqual([])
    expect(r.ok).toBe(true)
  })

  it('fails the wrong identity and names the bundle', () => {
    const r = verify({
      apps: ['dist/mac/Obsrv.app'],
      dmgs: ['dist/Obsrv-1.0.0.dmg'],
      expected: WANTED,
      run: run({ codesign: WRONG, spctl: NOTARIZED, xcrun: 'ok' }),
    })
    expect(r.ok).toBe(false)
    expect(r.failures.join(' ')).toContain('dist/mac/Obsrv.app')
    expect(r.failures.join(' ')).toContain('Restack Dev')
  })

  it('fails a build that produced nothing rather than passing vacuously', () => {
    // The case a green check would be worst for: nothing was verified, and
    // without this the run reports success having checked zero bundles.
    const r = verify({ apps: [], dmgs: [], expected: WANTED, run: run({}) })
    expect(r.ok).toBe(false)
    expect(r.failures.join(' ')).toContain('no .app bundle')
    expect(r.failures.join(' ')).toContain('no .dmg')
  })

  it('fails an unstapled DMG, because a stapled signature is what an offline machine needs', () => {
    const r = verify({
      apps: ['dist/mac/Obsrv.app'],
      dmgs: ['dist/Obsrv-1.0.0.dmg'],
      expected: WANTED,
      run: run({ codesign: RIGHT, spctl: NOTARIZED }, ['xcrun']),
    })
    expect(r.ok).toBe(false)
    expect(r.failures.join(' ')).toContain('not stapled')
  })

  it('reports a bundle codesign cannot read rather than skipping it', () => {
    const r = verify({
      apps: ['dist/mac/Obsrv.app'],
      dmgs: ['dist/Obsrv-1.0.0.dmg'],
      expected: WANTED,
      run: run({ spctl: NOTARIZED, xcrun: 'ok' }, ['codesign']),
    })
    expect(r.ok).toBe(false)
    expect(r.failures.join(' ')).toContain('codesign could not read it')
  })
})
