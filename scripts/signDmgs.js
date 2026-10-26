#!/usr/bin/env node
/**
 * Signs, notarises and staples every DMG electron-builder produced.
 *
 * `--config.mac.notarize=true` only notarises the `.app` bundle: dmg-builder
 * never calls `@electron/notarize` on the `.dmg` it wraps around it. A build
 * that trusted the `notarize` option alone shipped an `.app` that opens clean
 * on a machine that has never been online, inside a `.dmg` that still shows
 * Gatekeeper's "can't verify the developer" dialog on first launch, because
 * the DMG container itself was never signed, submitted, or stapled.
 *
 * Run after electron-builder and before `verifySigningIdentity.js` in
 * `dist:signed` — stapling is what that check's "every .dmg must be stapled"
 * rule is asserting actually happened.
 */
const { readdirSync } = require('node:fs')
const { join } = require('node:path')
const { runCaptured } = require('./lib/run')

/** Every `*.dmg` directly under `dist/`, as `verifySigningIdentity.js` finds them. */
function dmgsUnder(dir) {
  try {
    return readdirSync(dir)
      .filter(e => e.endsWith('.dmg'))
      .map(e => join(dir, e))
  } catch {
    return []
  }
}

/**
 * The whole operation, over an injected runner so it is testable without a
 * real signing identity or a round trip to Apple's notary service.
 */
function signAndStaple({ dmgs, identity, apiKey, apiKeyId, apiIssuer, run }) {
  const failures = []
  if (!identity) failures.push('SIGNING_IDENTITY is not set — nothing to sign the DMG as')
  if (!apiKey || !apiKeyId || !apiIssuer) {
    failures.push('APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER must all be set to notarize the DMG')
  }
  if (dmgs.length === 0) failures.push('no .dmg was found under dist/ to sign')
  if (failures.length > 0) return { ok: false, failures, dmgs: dmgs.length }

  for (const dmg of dmgs) {
    try {
      run('codesign', ['--force', '--sign', identity, dmg])
    } catch (e) {
      failures.push(`${dmg}: codesign failed (${e instanceof Error ? e.message : String(e)})`)
      continue
    }
    try {
      run('xcrun', [
        'notarytool', 'submit', dmg,
        '--key', apiKey,
        '--key-id', apiKeyId,
        '--issuer', apiIssuer,
        '--wait',
      ])
    } catch (e) {
      failures.push(`${dmg}: notarytool submit failed (${e instanceof Error ? e.message : String(e)})`)
      continue
    }
    try {
      run('xcrun', ['stapler', 'staple', dmg])
    } catch (e) {
      failures.push(`${dmg}: stapler staple failed (${e instanceof Error ? e.message : String(e)})`)
    }
  }
  return { ok: failures.length === 0, failures, dmgs: dmgs.length }
}

module.exports = { dmgsUnder, signAndStaple }

if (require.main === module) {
  const identity = process.env.SIGNING_IDENTITY ?? ''
  const apiKey = process.env.APPLE_API_KEY ?? ''
  const apiKeyId = process.env.APPLE_API_KEY_ID ?? ''
  const apiIssuer = process.env.APPLE_API_ISSUER ?? ''
  const result = signAndStaple({
    dmgs: dmgsUnder('dist'),
    identity,
    apiKey,
    apiKeyId,
    apiIssuer,
    run: runCaptured,
  })
  if (!result.ok) {
    console.error('DMG signing: failed.')
    for (const f of result.failures) console.error(`  - ${f}`)
    process.exit(1)
  }
  console.log(`DMG signing: ${result.dmgs} DMG(s) signed, notarised and stapled.`)
}
