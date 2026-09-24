#!/usr/bin/env node
/**
 * What a locally signed build was signed AS, asserted rather than assumed.
 *
 * **The defect this closes.** `docs/signing.md` §3 warns that electron-builder
 * can pick the wrong identity, and that warning is not theoretical: the first
 * build anyone ran after it was written signed with `identityName=Restack Dev`
 * and **reported success**. `codesign` and `spctl` both accept an ad-hoc or
 * wrong-account signature happily, so "it signed" is the answer that was true
 * then and wrong.
 *
 * **Why it exists separately from CI.** `ci.yml`'s release job already asserts
 * this (the "Verify the signing identity" step). `npm run dist:signed` on a desk
 * asserted nothing — which is exactly where the wrong-identity build happened,
 * and where it can happen again: a machine with both a Developer ID identity and
 * a local one gives `CSC_IDENTITY_AUTO_DISCOVERY` two candidates and no way to
 * tell which was meant. Opeyemi's keychain held exactly that pair on 2026-09-24.
 *
 * **The rules are CI's, deliberately.** Identity equality, Gatekeeper reporting a
 * notarized Developer ID build, `stapler validate` on every DMG, and **zero
 * artefacts treated as a failure** rather than a vacuous pass. Two surfaces
 * asserting different things is how one ships what the other would have caught.
 *
 * **Known duplication, named rather than left to be discovered.** These rules now
 * exist twice: here, and as inline bash in `ci.yml`. That is a drift risk. The
 * fix is for the workflow to call this file, which is deliberately NOT done in
 * the same change that introduces it — rewriting a working release gate and
 * introducing its replacement at once means a failure has two possible causes.
 */
const { execFileSync } = require('node:child_process')
const { readdirSync, statSync } = require('node:fs')
const { join } = require('node:path')

/** The exact authority line a build must carry, from the environment. */
const IDENTITY_VAR = 'SIGNING_IDENTITY'

/**
 * Whether `codesign`'s output names the expected identity.
 *
 * Substring, not equality, because `codesign -dv` prints several `Authority=`
 * lines — the leaf, the intermediate, the root — and the leaf is the one that
 * carries the entity. Compared literally: a pattern would let a partial entity
 * name match a different account.
 */
function identityVerdict(authority, expected) {
  if (!expected) {
    return {
      ok: false,
      reason:
        `${IDENTITY_VAR} is not set, so there is nothing to assert this build's identity against. ` +
        'Set it to the exact codesign authority line (see docs/signing.md) — an unnamed target and no check are the same silent gap.',
    }
  }
  if (!authority.includes(expected)) {
    const found = authority
      .split('\n')
      .filter(l => l.startsWith('Authority='))
      .join(' | ')
    return { ok: false, reason: `signed as [${found || 'no Authority line at all'}], which does not contain '${expected}'` }
  }
  return { ok: true }
}

/**
 * Whether Gatekeeper accepts it as a notarized Developer ID build.
 *
 * The same string `ci.yml` greps for. A signature that verifies but was never
 * notarised still shows the damaged-app dialog on a machine that has never been
 * online, which is the failure a user meets rather than a builder.
 */
function gatekeeperVerdict(verdict) {
  return verdict.includes('source=Notarized Developer ID')
    ? { ok: true }
    : { ok: false, reason: `Gatekeeper did not report a notarized Developer ID build: ${verdict.split('\n')[0] ?? '(no output)'}` }
}

/** Every `*.app` under `dist/`, to the depth electron-builder stages them at. */
function appsUnder(dir, depth = 3) {
  const out = []
  const walk = (d, left) => {
    let entries = []
    try {
      entries = readdirSync(d)
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(d, e)
      if (e.endsWith('.app')) {
        out.push(p)
        continue
      }
      if (left > 0 && statSync(p).isDirectory()) walk(p, left - 1)
    }
  }
  walk(dir, depth)
  return out
}

/** Every `*.dmg` directly under `dist/`, as `ci.yml` looks for them. */
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
 * The whole check, over injected runners so it is testable without a build.
 *
 * `run(cmd, args)` returns that command's combined output; a throw is the
 * command's own failure and is reported as such rather than swallowed.
 */
function verify({ apps, dmgs, expected, run }) {
  const failures = []
  if (apps.length === 0) failures.push('no .app bundle was found under dist/ to verify — a signed build that produced nothing must not pass')
  for (const app of apps) {
    let authority = ''
    try {
      authority = run('codesign', ['-dv', '--verbose=4', app])
    } catch (e) {
      failures.push(`${app}: codesign could not read it (${e instanceof Error ? e.message : String(e)})`)
      continue
    }
    const id = identityVerdict(authority, expected)
    if (!id.ok) {
      failures.push(`${app}: ${id.reason}`)
      continue
    }
    let verdict = ''
    try {
      verdict = run('spctl', ['-a', '-vvv', '-t', 'install', app])
    } catch (e) {
      failures.push(`${app}: spctl refused it (${e instanceof Error ? e.message : String(e)})`)
      continue
    }
    const gate = gatekeeperVerdict(verdict)
    if (!gate.ok) failures.push(`${app}: ${gate.reason}`)
  }
  if (dmgs.length === 0) failures.push('no .dmg was found under dist/ to validate')
  for (const dmg of dmgs) {
    try {
      run('xcrun', ['stapler', 'validate', dmg])
    } catch (e) {
      failures.push(`${dmg}: not stapled (${e instanceof Error ? e.message : String(e)})`)
    }
  }
  return { ok: failures.length === 0, failures, apps: apps.length, dmgs: dmgs.length }
}

module.exports = { IDENTITY_VAR, identityVerdict, gatekeeperVerdict, appsUnder, dmgsUnder, verify }

if (require.main === module) {
  const expected = process.env[IDENTITY_VAR] ?? ''
  const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const result = verify({ apps: appsUnder('dist'), dmgs: dmgsUnder('dist'), expected, run })
  if (!result.ok) {
    console.error('signing identity: this build is NOT what it claims to be.')
    for (const f of result.failures) console.error(`  - ${f}`)
    process.exit(1)
  }
  console.log(`signing identity: ${result.apps} app bundle(s) and ${result.dmgs} DMG(s) verified as '${expected}', notarized and stapled.`)
}
