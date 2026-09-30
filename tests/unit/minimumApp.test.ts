import { describe, expect, it } from 'vitest'
import { MINIMUM_APP_VERSION, unsupportedAppNote } from '../../src/shared/minimumApp'

/**
 * The floor, and what it refuses.
 *
 * `chore-minimum-app-version`: five code paths existed only to speak to apps older than some field, the
 * card said a fourth such sentence would make the decision urgent, and there were six by the time
 * Opeyemi took it. His answer was *"set the floor at 0.58.0 and refuse below it."*
 */
describe('the minimum supported app version', () => {
  it('is the version the decision named, not a number this file invented', () => {
    expect(MINIMUM_APP_VERSION).toBe('0.58.0')
  })

  it('accepts the floor itself — "0.58.0 or newer" includes 0.58.0', () => {
    // The off-by-one that would silently refuse the exact version the decision
    // chose, which is the version most likely to be in the wild on that boundary.
    expect(unsupportedAppNote('0.58.0')).toBeNull()
  })

  it('accepts anything above it, including the app tonight', () => {
    for (const v of ['0.58.1', '0.59.0', '0.63.1', '1.0.0']) expect(unsupportedAppNote(v)).toBeNull()
  })

  it('refuses below it, and names BOTH versions in the sentence', () => {
    const note = unsupportedAppNote('0.41.0')
    expect(note).toContain('0.41.0')
    expect(note).toContain('0.58.0')
    // The next action has to be obvious, because the three things a reader would
    // otherwise suspect — the selector, the argument, the page — are all fine.
    expect(note).toContain('Update the app')
  })

  it('refuses a version it cannot read, rather than proceeding because it could not tell', () => {
    // "Ancient" and "answered something unparseable" want the same action, and
    // proceeding on the second is the silence that fits two facts.
    for (const v of ['', '   ', undefined]) {
      const note = unsupportedAppNote(v)
      expect(note, `an unreadable version was treated as supported: ${JSON.stringify(v)}`).not.toBeNull()
      expect(note).toContain('did not report a version')
    }
  })

  it('treats a prerelease of the floor as below it, since it predates the release', () => {
    // `0.58.0-rc.1` is not `0.58.0`: it is the build before it, and the field the
    // floor exists for may not be in it.
    expect(unsupportedAppNote('0.58.0-rc.1')).not.toBeNull()
  })

  it('says the call was refused rather than measured, so nobody reads it as a soft warning', () => {
    expect(unsupportedAppNote('0.30.0')).toContain('refused')
  })
})
