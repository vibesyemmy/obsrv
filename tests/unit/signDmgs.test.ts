import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

/**
 * electron-builder signs and notarises the `.app`; nothing in the build signs
 * the `.dmg` it ships that `.app` inside. This is the script that does —
 * `codesign` the DMG, submit it to `notarytool`, then `stapler staple` it —
 * and these are its pure success/failure rules, exercised the same way
 * `verifySigningIdentity.test.ts` exercises its sibling: a fake `run` that
 * never touches a real signing identity or a real notary round trip.
 */
const { dmgsUnder, signAndStaple } = createRequire(__filename)('../../scripts/signDmgs.js') as {
  dmgsUnder: (dir: string) => string[]
  signAndStaple: (a: {
    dmgs: string[]
    identity: string
    apiKey: string
    apiKeyId: string
    apiIssuer: string
    run: (cmd: string, args: string[]) => string
  }) => { ok: boolean; failures: string[]; dmgs: number }
}

const IDENTITY = 'Developer ID Application: Voicify Limited (NDXPR623CF)'
const CREDS = { apiKey: '/tmp/AuthKey.p8', apiKeyId: 'ABC123', apiIssuer: 'issuer-uuid' }

describe('signAndStaple', () => {
  const run = (throwOn: string[] = []) => (cmd: string) => {
    if (throwOn.includes(cmd)) throw new Error(`${cmd} failed`)
    return ''
  }

  it('signs, notarises and staples every DMG', () => {
    const r = signAndStaple({
      dmgs: ['dist/Obsrv-1.0.0-arm64.dmg', 'dist/Obsrv-1.0.0-x64.dmg'],
      identity: IDENTITY,
      ...CREDS,
      run: run(),
    })
    expect(r.ok).toBe(true)
    expect(r.failures).toEqual([])
    expect(r.dmgs).toBe(2)
  })

  it('refuses rather than skips when SIGNING_IDENTITY is unset', () => {
    const r = signAndStaple({ dmgs: ['dist/Obsrv-1.0.0.dmg'], identity: '', ...CREDS, run: run() })
    expect(r.ok).toBe(false)
    expect(r.failures.join(' ')).toContain('SIGNING_IDENTITY')
  })

  it('refuses when any Apple API credential is missing', () => {
    const r = signAndStaple({
      dmgs: ['dist/Obsrv-1.0.0.dmg'],
      identity: IDENTITY,
      apiKey: CREDS.apiKey,
      apiKeyId: '',
      apiIssuer: CREDS.apiIssuer,
      run: run(),
    })
    expect(r.ok).toBe(false)
    expect(r.failures.join(' ')).toContain('APPLE_API_KEY')
  })

  it('fails a build that produced no DMG rather than passing vacuously', () => {
    const r = signAndStaple({ dmgs: [], identity: IDENTITY, ...CREDS, run: run() })
    expect(r.ok).toBe(false)
    expect(r.failures.join(' ')).toContain('no .dmg')
  })

  it('names the DMG when codesign fails, and does not try to notarise it', () => {
    let notarised = false
    const r = signAndStaple({
      dmgs: ['dist/Obsrv-1.0.0.dmg'],
      identity: IDENTITY,
      ...CREDS,
      run: (cmd: string) => {
        if (cmd === 'codesign') throw new Error('no identity found')
        if (cmd === 'xcrun') notarised = true
        return ''
      },
    })
    expect(r.ok).toBe(false)
    expect(r.failures.join(' ')).toContain('dist/Obsrv-1.0.0.dmg')
    expect(r.failures.join(' ')).toContain('codesign failed')
    expect(notarised).toBe(false)
  })

  it('names the DMG when notarytool submit fails, and does not then staple it', () => {
    let stapled = false
    let notarizeCalls = 0
    const r = signAndStaple({
      dmgs: ['dist/Obsrv-1.0.0.dmg'],
      identity: IDENTITY,
      ...CREDS,
      run: (cmd: string, args: string[]) => {
        if (cmd === 'xcrun' && args[0] === 'notarytool') {
          notarizeCalls += 1
          throw new Error('rejected')
        }
        if (cmd === 'xcrun' && args[0] === 'stapler') stapled = true
        return ''
      },
    })
    expect(r.ok).toBe(false)
    expect(r.failures.join(' ')).toContain('notarytool submit failed')
    expect(notarizeCalls).toBe(1)
    expect(stapled).toBe(false)
  })

  it('names the DMG when stapling fails', () => {
    const r = signAndStaple({
      dmgs: ['dist/Obsrv-1.0.0.dmg'],
      identity: IDENTITY,
      ...CREDS,
      run: (cmd: string, args: string[]) => {
        if (cmd === 'xcrun' && args[0] === 'stapler') throw new Error('ticket not found')
        return ''
      },
    })
    expect(r.ok).toBe(false)
    expect(r.failures.join(' ')).toContain('stapler staple failed')
  })

  it('keeps going to the next DMG after one fails', () => {
    const r = signAndStaple({
      dmgs: ['dist/Obsrv-1.0.0-arm64.dmg', 'dist/Obsrv-1.0.0-x64.dmg'],
      identity: IDENTITY,
      ...CREDS,
      run: (cmd: string, args: string[]) => {
        if (args.includes('dist/Obsrv-1.0.0-arm64.dmg') && cmd === 'codesign') throw new Error('nope')
        return ''
      },
    })
    expect(r.ok).toBe(false)
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0]).toContain('arm64')
  })
})

describe('dmgsUnder', () => {
  it('returns an empty list for a directory with no DMGs', () => {
    expect(dmgsUnder('/nonexistent-dir-for-test')).toEqual([])
  })
})
